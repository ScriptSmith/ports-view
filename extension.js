import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_UPDATE_INTERVAL = 30; // seconds
const MAX_VISIBLE_ROWS = 200;       // hard cap so a runaway host can't build a giant menu
const CLK_TCK = 100;                // USER_HZ — 100 on effectively all modern Linux

// Pull all process (name, pid) pairs out of an ss "users:((...))" field.
const PROC_RE = /\("([^"]+)",pid=(\d+)/g;

const PortsViewIndicator = GObject.registerClass(
class PortsViewIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Ports View');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._timeoutId = null;
        this._scanning = false;
        this._ports = [];        // last parsed result
        this._systemUptime = null;

        // Panel: a network icon plus a live count of the user's own listening ports.
        this._box = new St.BoxLayout({
            style_class: 'ports-view-box',
        });
        this.add_child(this._box);

        this._icon = new St.Icon({
            icon_name: 'network-transmit-receive-symbolic',
            style_class: 'system-status-icon ports-view-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._icon);

        this._countLabel = new St.Label({
            text: '–',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'ports-view-count',
        });
        this._box.add_child(this._countLabel);

        this._buildMenu();

        // Refresh the list when the menu opens (without disrupting it while open).
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._renderList();
                this._scan(true);
            }
        });

        // React to preference changes immediately.
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._restartLoop();
            this._scan(true);
        });

        this._startLoop();
        this._scan(true);
    }

    _buildMenu() {
        // Header summarising the current count.
        this._headerItem = new PopupMenu.PopupMenuItem('Scanning ports…');
        this._headerItem.setSensitive(false);
        this._headerItem.label.add_style_class_name('ports-view-header');
        this.menu.addMenuItem(this._headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Scrolling section that holds the grouped port list.
        this._listSection = new PopupMenu.PopupMenuSection();
        const scroll = new St.ScrollView({
            style_class: 'ports-view-scroll',
            overlay_scrollbars: false,
        });
        // Reserve a gutter for the vertical scrollbar (so an open submenu's
        // background doesn't paint over it) and never scroll horizontally.
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scroll.set_child(this._listSection.actor);
        this.menu.box.add_child(scroll);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh — re-scan and rebuild even while the menu is open.
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        refreshItem.connect('activate', () => this._scan(true));
        this.menu.addMenuItem(refreshItem);

        // Settings.
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settingsItem);
    }

    _startLoop() {
        const interval = this._settings.get_int('update-interval') || DEFAULT_UPDATE_INTERVAL;
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._scan(false);
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _restartLoop() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._startLoop();
    }

    // Spawn `ss` asynchronously and hand its output to the parser.
    _scan(forceListRender) {
        if (this._scanning) {
            return;
        }
        this._scanning = true;

        // -t TCP, -u UDP, -l listening, -n numeric, -p processes, -H no header.
        // Always request both families: with a single family ss drops the Netid
        // column and every subsequent column shifts. UDP is filtered in _parse.
        const argv = ['ss', '-tulnpH'];

        let proc;
        try {
            proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            this._scanning = false;
            this._setError(e.message || 'failed to launch ss');
            return;
        }

        proc.communicate_utf8_async(null, null, (p, res) => {
            this._scanning = false;
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                if (!p.get_successful()) {
                    this._setError((stderr || '').trim() || 'ss exited with an error');
                    return;
                }
                this._ports = this._parse(stdout || '');
                this._renderBadge();
                if (forceListRender || !this.menu.isOpen) {
                    this._renderList();
                }
            } catch (e) {
                this._setError(e.message || 'failed to read ss output');
            }
        });
    }

    // Turn raw `ss` output into a sorted list of per-port records.
    _parse(text) {
        const onlyExposed = this._settings.get_boolean('only-exposed');
        const includeUdp = this._settings.get_boolean('include-udp');
        const byKey = new Map();

        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            if (!line) {
                continue;
            }

            const fields = line.split(/\s+/);
            if (fields.length < 5) {
                continue;
            }

            const proto = fields[0].toLowerCase();           // tcp / udp
            if (!includeUdp && proto !== 'tcp') {
                continue;
            }
            const local = fields[4];                          // address:port
            const portIdx = local.lastIndexOf(':');
            if (portIdx < 0) {
                continue;
            }

            const port = parseInt(local.slice(portIdx + 1), 10);
            if (!Number.isFinite(port)) {
                continue;
            }

            const address = local.slice(0, portIdx).replace(/^\[|\]$/g, '');
            const exposed = !this._isLoopback(address);
            if (onlyExposed && !exposed) {
                continue;
            }

            // Collect the owning process(es), if visible to us. Unprivileged ss
            // only reports a process for sockets the current user owns, so the
            // presence of a process is what marks a port as "yours".
            const procs = new Map();
            PROC_RE.lastIndex = 0;
            let m;
            while ((m = PROC_RE.exec(line)) !== null) {
                procs.set(m[2], m[1]); // pid -> name
            }

            // Group all sockets that share a port number into one row.
            const key = `${port}`;
            let rec = byKey.get(key);
            if (!rec) {
                rec = {
                    port,
                    protocols: new Set(),
                    addresses: new Set(),
                    procs: new Map(),
                    exposed: false,
                };
                byKey.set(key, rec);
            }
            rec.protocols.add(proto);
            rec.addresses.add(address);
            rec.exposed = rec.exposed || exposed;
            for (const [pid, name] of procs) {
                rec.procs.set(pid, name);
            }
        }

        return Array.from(byKey.values()).sort((a, b) => a.port - b.port);
    }

    _isLoopback(address) {
        if (!address) {
            return false;
        }
        return address === '::1' || address.startsWith('127.');
    }

    _isOwned(rec) {
        return rec.procs.size > 0;
    }

    _setError(message) {
        console.error(`Ports View: ${message}`);
        this._countLabel.set_text('!');
        this._headerItem.label.set_text(`Error: ${message}`);
        this._listSection.removeAll();
    }

    // The badge counts only the user's own ports.
    _renderBadge() {
        const owned = this._ports.filter(rec => this._isOwned(rec)).length;
        this._countLabel.set_text(`${owned}`);
    }

    _renderList() {
        this._systemUptime = this._readSystemUptime();
        this._listSection.removeAll();

        const ports = this._ports;
        const ownedCount = ports.filter(rec => this._isOwned(rec)).length;
        this._headerItem.label.set_text(
            ownedCount === 1 ? '1 of your ports in use' : `${ownedCount} of your ports in use`
        );

        if (ports.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('No listening ports');
            empty.setSensitive(false);
            this._listSection.addMenuItem(empty);
            return;
        }

        // Partition into Watched (range of interest), Your ports, Other ports.
        const watchEnabled = this._settings.get_boolean('watch-enabled');
        const lo = Math.min(this._settings.get_int('watch-low'), this._settings.get_int('watch-high'));
        const hi = Math.max(this._settings.get_int('watch-low'), this._settings.get_int('watch-high'));
        const inWatch = rec => watchEnabled && rec.port >= lo && rec.port <= hi;

        const watched = ports.filter(inWatch);
        const rest = ports.filter(rec => !inWatch(rec));
        const yours = rest.filter(rec => this._isOwned(rec));
        const others = rest.filter(rec => !this._isOwned(rec));

        let rendered = 0;
        rendered += this._addGroup(`Watched ${lo}–${hi}`, watched, rendered);
        rendered += this._addGroup('Your ports', yours, rendered);
        rendered += this._addGroup('Other ports', others, rendered);
    }

    // Render one titled group; returns how many rows it added.
    _addGroup(title, ports, alreadyRendered) {
        if (ports.length === 0) {
            return 0;
        }

        const header = new PopupMenu.PopupMenuItem(`${title} (${ports.length})`);
        header.setSensitive(false);
        header.label.add_style_class_name('ports-view-group');
        this._listSection.addMenuItem(header);

        let added = 0;
        for (const rec of ports) {
            if (alreadyRendered + added >= MAX_VISIBLE_ROWS) {
                const more = new PopupMenu.PopupMenuItem(`…and ${ports.length - added} more`);
                more.setSensitive(false);
                this._listSection.addMenuItem(more);
                break;
            }
            this._listSection.addMenuItem(this._makePortSubmenu(rec));
            added++;
        }
        return added;
    }

    // Each port is an expandable submenu: a summary line plus per-process
    // metadata and (for the user's own processes) Stop / Kill actions.
    _makePortSubmenu(rec) {
        const protoText = Array.from(rec.protocols).sort().join('/');
        const owned = this._isOwned(rec);

        let procSummary;
        if (owned) {
            procSummary = Array.from(rec.procs.entries())
                .map(([pid, name]) => this._procDisplayName(pid, name))
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(', ');
        } else {
            procSummary = '—';
        }

        const submenu = new PopupMenu.PopupSubMenuMenuItem('', false);
        submenu.label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        submenu.label.add_style_class_name('ports-view-row-label');

        const portColor = rec.exposed ? '#f5a623' : '#7fc97f';
        const markup =
            `<span foreground="${portColor}"><b>${rec.port}</b></span>` +
            `  <span size="smaller">${GLib.markup_escape_text(protoText, -1)}</span>` +
            `   ${GLib.markup_escape_text(procSummary, -1)}`;
        submenu.label.clutter_text.set_markup(markup);

        // Per-process metadata + actions.
        if (owned) {
            for (const [pid, name] of rec.procs) {
                this._addProcessDetails(submenu.menu, pid, name);
            }
        } else {
            this._addMeta(submenu.menu, 'Process not visible (owned by another user)');
        }

        // Listening details, shared by all owners of this port.
        this._addMeta(submenu.menu, `Protocol: ${protoText}`);
        this._addMeta(submenu.menu, `Address: ${Array.from(rec.addresses).join(', ')}`);
        this._addMeta(submenu.menu, rec.exposed ? 'Reachable: network-exposed' : 'Reachable: loopback only');

        const copyItem = new PopupMenu.PopupMenuItem('Copy port number');
        copyItem.connect('activate', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, `${rec.port}`);
        });
        submenu.menu.addMenuItem(copyItem);

        return submenu;
    }

    _addProcessDetails(menu, pid, name) {
        const meta = this._readProcMeta(pid);
        const dispName = this._procDisplayName(pid, name);

        const head = new PopupMenu.PopupMenuItem(`${dispName} — pid ${pid}`);
        head.setSensitive(false);
        head.label.add_style_class_name('ports-view-proc-head');
        menu.addMenuItem(head);

        if (meta.uptimeSecs != null) {
            this._addMeta(menu, `Uptime: ${this._formatUptime(meta.uptimeSecs)} (started ${this._formatStarted(meta.uptimeSecs)})`);
        }
        if (meta.cwd) {
            this._addMeta(menu, `Dir: ${meta.cwd}`);
        }
        if (meta.exe) {
            this._addMeta(menu, `Exe: ${meta.exe}`);
        }
        if (meta.cmdline) {
            this._addMeta(menu, `Cmd: ${meta.cmdline}`);
        }

        const stopItem = new PopupMenu.PopupMenuItem('Stop (SIGTERM)');
        stopItem.connect('activate', () => this._signalProcess(pid, 'TERM'));
        menu.addMenuItem(stopItem);

        const killItem = new PopupMenu.PopupMenuItem('Kill (SIGKILL)');
        killItem.label.add_style_class_name('ports-view-danger');
        killItem.connect('activate', () => this._signalProcess(pid, 'KILL'));
        menu.addMenuItem(killItem);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    // An informational, non-interactive, ellipsized row.
    _addMeta(menu, text) {
        const item = new PopupMenu.PopupMenuItem(text);
        item.setSensitive(false);
        item.label.add_style_class_name('ports-view-meta');
        item.label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        menu.addMenuItem(item);
    }

    _signalProcess(pid, signal) {
        try {
            Gio.Subprocess.new(
                ['kill', `-${signal}`, `${pid}`],
                Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            console.error(`Ports View: failed to send SIG${signal} to ${pid}: ${e.message}`);
        }
        // Give the process a moment to exit, then refresh the list.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._scan(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _readSystemUptime() {
        try {
            const [ok, bytes] = GLib.file_get_contents('/proc/uptime');
            if (ok) {
                const text = new TextDecoder().decode(bytes);
                const secs = parseFloat(text.split(/\s+/)[0]);
                if (Number.isFinite(secs)) {
                    return secs;
                }
            }
        } catch (e) {
            // Non-fatal: uptime just won't be shown.
        }
        return null;
    }

    // A fuller process name than ss's 15-char comm: the basename of argv[0].
    _procDisplayName(pid, fallback) {
        try {
            const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/cmdline`);
            if (ok) {
                const argv0 = new TextDecoder().decode(bytes).split('\0')[0];
                const base = argv0 ? argv0.split('/').pop() : '';
                if (base) {
                    return base;
                }
            }
        } catch (e) { /* fall back to ss name */ }
        return fallback;
    }

    // Read whatever process metadata is readable from /proc for this pid.
    _readProcMeta(pid) {
        const meta = {};

        try {
            const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/cmdline`);
            if (ok) {
                const s = new TextDecoder().decode(bytes).replace(/\0/g, ' ').trim();
                if (s) {
                    meta.cmdline = s;
                }
            }
        } catch (e) { /* not readable */ }

        try {
            meta.exe = GLib.file_read_link(`/proc/${pid}/exe`);
        } catch (e) { /* not readable for other users */ }

        try {
            meta.cwd = GLib.file_read_link(`/proc/${pid}/cwd`);
        } catch (e) { /* not readable for other users */ }

        if (this._systemUptime != null) {
            try {
                const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`);
                if (ok) {
                    const stat = new TextDecoder().decode(bytes);
                    // The comm field can contain spaces/parens, so split after the last ')'.
                    const after = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
                    const startTicks = parseInt(after[19], 10); // starttime (field 22)
                    if (Number.isFinite(startTicks)) {
                        const secs = this._systemUptime - startTicks / CLK_TCK;
                        if (secs >= 0) {
                            meta.uptimeSecs = secs;
                        }
                    }
                }
            } catch (e) { /* not readable */ }
        }

        return meta;
    }

    _formatUptime(secs) {
        let s = Math.floor(secs);
        const d = Math.floor(s / 86400); s %= 86400;
        const h = Math.floor(s / 3600); s %= 3600;
        const m = Math.floor(s / 60); s %= 60;
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${s}s`;
    }

    _formatStarted(uptimeSecs) {
        const start = new Date(Date.now() - uptimeSecs * 1000);
        const now = new Date();
        const hh = start.getHours().toString().padStart(2, '0');
        const mm = start.getMinutes().toString().padStart(2, '0');
        const time = `${hh}:${mm}`;
        if (start.toDateString() === now.toDateString()) {
            return time;
        }
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `${days[start.getDay()]} ${time}`;
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});

export default class PortsViewExtension extends Extension {
    enable() {
        this._indicator = new PortsViewIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
