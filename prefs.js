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

        // Watched ranges — when enabled, the menu only lists ports inside these
        // ranges. Any number of ranges can be added.
        const watchGroup = new Adw.PreferencesGroup({
            title: 'Watched ranges',
            description: 'When enabled, the menu only lists ports within these ranges',
        });
        page.add(watchGroup);

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Add a range',
            css_classes: ['flat'],
        });
        watchGroup.set_header_suffix(addButton);

        const watchRow = new Adw.SwitchRow({
            title: 'Restrict menu to watched ranges',
        });
        settings.bind('watch-enabled', watchRow, 'active', 0);
        watchGroup.add(watchRow);

        // Read/write the ranges setting as "low-high" strings.
        const getRanges = () => settings.get_strv('watch-ranges').map(entry => {
            const [a, b] = entry.split('-').map(n => parseInt(n, 10));
            return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0];
        });
        const setRanges = ranges =>
            settings.set_strv('watch-ranges', ranges.map(([lo, hi]) => `${lo}-${hi}`));

        const makeSpin = value => new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 65535,
                step_increment: 1,
                page_increment: 100,
                value,
            }),
            valign: Gtk.Align.CENTER,
        });

        // Track the dynamically added range rows so we can rebuild them.
        let rangeRows = [];

        const rebuildRanges = () => {
            for (const row of rangeRows) {
                watchGroup.remove(row);
            }
            rangeRows = [];

            getRanges().forEach(([lo, hi], index) => {
                const row = new Adw.ActionRow({ title: `Range ${index + 1}` });

                const startSpin = makeSpin(lo);
                const endSpin = makeSpin(hi);
                const dash = new Gtk.Label({ label: '–', valign: Gtk.Align.CENTER });
                const removeButton = new Gtk.Button({
                    icon_name: 'list-remove-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Remove this range',
                    css_classes: ['flat'],
                });

                const writeThisRange = () => {
                    const ranges = getRanges();
                    if (index < ranges.length) {
                        ranges[index] = [startSpin.get_value_as_int(), endSpin.get_value_as_int()];
                        setRanges(ranges);
                    }
                };
                startSpin.connect('value-changed', writeThisRange);
                endSpin.connect('value-changed', writeThisRange);
                removeButton.connect('clicked', () => {
                    const ranges = getRanges();
                    ranges.splice(index, 1);
                    setRanges(ranges);
                    rebuildRanges();
                });

                row.add_suffix(startSpin);
                row.add_suffix(dash);
                row.add_suffix(endSpin);
                row.add_suffix(removeButton);

                settings.bind('watch-enabled', row, 'sensitive', 0);

                watchGroup.add(row);
                rangeRows.push(row);
            });
        };

        addButton.connect('clicked', () => {
            const ranges = getRanges();
            ranges.push([3000, 3999]);
            setRanges(ranges);
            rebuildRanges();
        });
        settings.bind('watch-enabled', addButton, 'sensitive', 0);

        rebuildRanges();

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
