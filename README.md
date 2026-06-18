# Ports View — GNOME Shell Extension

A GNOME Shell extension that shows a count of **your** listening ports in the top
bar, and on click lists every listening port on the host together with the
process attached to it.

## Features

- **Panel badge**: a network icon with a live count of the listening ports owned
  by your user.
- **Grouped popup**:
  - **Watched range** — an optional range of ports you care about, floated to
    the top (configure in Settings).
  - **Your ports** — ports owned by your user, with the attached process.
  - **Other ports** — ports owned by other users (e.g. root). The port and
    address are shown; the process name is not visible without privileges.
- **Per-port submenu**: expand any port to see its process metadata — uptime and
  start time, working directory, executable path, and full command line — plus
  **Stop (SIGTERM)** and **Kill (SIGKILL)** actions for your own processes, and a
  *Copy port number* item.
- **Exposure colouring**: ports reachable off-box (bound to `0.0.0.0`/`::`/an IP)
  are orange; loopback-only ports are green.
- **Configurable**: scan interval (default 30s), include/exclude UDP, hide
  loopback-only ports, and the watched port range.

## How it works

Each scan runs `ss -tulnpH` and parses the output. Running unprivileged, `ss`
only attaches a process to sockets your user owns — that is exactly what
distinguishes *your ports* from *other ports*, and what the panel badge counts.
Ports owned by other users still appear (so nothing is hidden), but show `—` for
the process. To see those, inspect with `sudo ss -tulnp`.

## Install

```bash
./install.sh
gnome-extensions enable ports-view@local   # after a session restart on Wayland
```

On Wayland you must log out and back in for the shell to pick up a newly
installed extension. On X11 you can reload with Alt+F2 → `r`.

Configure with:

```bash
gnome-extensions prefs ports-view@local
```

## Notes

- Process uptime assumes `USER_HZ` of 100, which is true on effectively all
  modern Linux systems.
- Stop/Kill act only on your own processes (no privilege escalation).
