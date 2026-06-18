import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PortsViewPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Ports View',
            icon_name: 'network-transmit-receive-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Scanning',
        });
        page.add(group);

        // Update interval (seconds).
        const intervalRow = new Adw.SpinRow({
            title: 'Update Interval',
            subtitle: 'How often to scan for listening ports (seconds)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 300,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('update-interval'),
            }),
        });
        intervalRow.connect('notify::value', () => {
            settings.set_int('update-interval', intervalRow.get_value());
        });
        group.add(intervalRow);

        // Include UDP.
        const udpRow = new Adw.SwitchRow({
            title: 'Include UDP',
            subtitle: 'Show UDP sockets in addition to TCP',
        });
        settings.bind('include-udp', udpRow, 'active', 0);
        group.add(udpRow);

        // Only network-exposed ports.
        const exposedRow = new Adw.SwitchRow({
            title: 'Only network-exposed ports',
            subtitle: 'Hide ports bound only to the loopback interface',
        });
        settings.bind('only-exposed', exposedRow, 'active', 0);
        group.add(exposedRow);

        // Watched port range — a range of interest grouped at the top of the menu.
        const watchGroup = new Adw.PreferencesGroup({
            title: 'Watched range',
            description: 'Group a range of ports you care about at the top of the menu',
        });
        page.add(watchGroup);

        const watchRow = new Adw.SwitchRow({
            title: 'Watch a port range',
        });
        settings.bind('watch-enabled', watchRow, 'active', 0);
        watchGroup.add(watchRow);

        const lowRow = new Adw.SpinRow({
            title: 'Range start',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 65535,
                step_increment: 1,
                page_increment: 100,
                value: settings.get_int('watch-low'),
            }),
        });
        lowRow.connect('notify::value', () => {
            settings.set_int('watch-low', lowRow.get_value());
        });
        settings.bind('watch-enabled', lowRow, 'sensitive', 0);
        watchGroup.add(lowRow);

        const highRow = new Adw.SpinRow({
            title: 'Range end',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 65535,
                step_increment: 1,
                page_increment: 100,
                value: settings.get_int('watch-high'),
            }),
        });
        highRow.connect('notify::value', () => {
            settings.set_int('watch-high', highRow.get_value());
        });
        settings.bind('watch-enabled', highRow, 'sensitive', 0);
        watchGroup.add(highRow);

        const noteGroup = new Adw.PreferencesGroup({
            title: 'Note',
        });
        page.add(noteGroup);

        const noteRow = new Adw.ActionRow({
            title: 'Process visibility',
            subtitle: 'Process names are only shown for your own processes. ' +
                'Ports owned by other users (e.g. root) appear with “—”. ' +
                'Run GNOME Shell as that user, or inspect with sudo ss -tulnp, to see them.',
        });
        noteRow.set_activatable(false);
        noteGroup.add(noteRow);
    }
}
