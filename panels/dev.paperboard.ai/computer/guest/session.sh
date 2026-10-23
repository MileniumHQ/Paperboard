#!/bin/sh
# The agent's display and hands: a bare X server (no window manager or desktop),
# an accessibility bus so apps expose their controls, and the agent service.
# systemd runs this as the `agent` user and stops the whole group together.
set -eu
export DISPLAY=:1
Xvfb :1 -screen 0 1280x800x24 -nolisten tcp &
i=0
while [ ! -e /tmp/.X11-unix/X1 ]; do
    i=$((i + 1))
    [ "$i" -gt 100 ] && { echo "Xvfb did not start" >&2; exit 1; }
    sleep 0.1
done
exec dbus-run-session -- sh -c '
    /usr/libexec/at-spi-bus-launcher --launch-immediately &
    exec python3 /opt/paperboard/agent.py
'
