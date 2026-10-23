// What goes into the agent's computer on its first boot.
//
// The VM is Debian's own cloud image plus an overlay disk. cloud-init reads
// its setup from a seed server the service runs on loopback for the length
// of the install only (QEMU's user network shows the host's loopback to the
// guest as 10.0.2.2); after that the guest's firewall drops everything to
// 10.0.2.2, so the agent can reach the internet but never this machine.

import AGENT_PY from "../../computer/guest/agent.py" with { type: "text" };
import SESSION_SH from "../../computer/guest/session.sh" with { type: "text" };

export const GUEST_FILES = { "agent.py": AGENT_PY, "session.sh": SESSION_SH } as const;

/** The guest agent's port inside the VM; QEMU forwards a loopback port to it. */
export const GUEST_PORT = 7070;

// Pinned in this code: the hash is the authority, the URL only a location.
// TODO: host both on origami once the computer image has its own release.
export const BASE_IMAGE = {
    url: "https://cloud.debian.org/images/cloud/trixie/20261021-2638/debian-13-genericcloud-amd64-20261021-2638.qcow2",
    sha256: "d3a5c93cc98b34651421e0fa3a37db428f07355a3bc4cf46d6fbeb001f258e90",
    file: "base.qcow2",
} as const;

export const BROWSER_DEB = {
    url: "https://github.com/imputnet/helium-linux/releases/download/0.20.1.1/helium-bin_0.20.1.1-1_amd64.deb",
    sha256: "1cba59a53031b866216d85780c9068d71e318a25e19602752d9e3a45e193fa5e",
    file: "helium.deb",
} as const;

const PACKAGES = [
    "xvfb", "xdotool", "x11-utils", "python3-xlib", "python3-pil", "python3-gi", "gir1.2-atspi-2.0",
    "at-spi2-core", "dbus-daemon", "python3-websocket", "fonts-dejavu-core", "fonts-liberation2",
    "fonts-noto-color-emoji", "mousepad", "galculator", "nftables", "curl", "ca-certificates",
];

/** cloud-init user-data: the agent user, its display and hands, the firewall. */
export function userData(seed: string, token: string): string {
    return `#cloud-config
hostname: computer
users:
  - name: agent
    shell: /bin/bash
    lock_passwd: true
package_update: true
packages: ${JSON.stringify(PACKAGES)}
write_files:
  - path: /etc/paperboard/token
    permissions: "0640"
    content: ${JSON.stringify(token)}
  - path: /etc/systemd/system/paperboard-computer.service
    content: |
      [Unit]
      Description=The agent's display and hands
      After=network-online.target
      [Service]
      User=agent
      ExecStart=/bin/sh /opt/paperboard/session.sh
      # the journal rotates; the serial console is a host file that would only grow
      StandardOutput=journal
      StandardError=journal
      Restart=always
      RestartSec=2
      [Install]
      WantedBy=multi-user.target
  - path: /etc/nftables.conf
    content: |
      flush ruleset
      table inet paperboard {
        chain output {
          type filter hook output priority 0;
          ct state established,related accept
          ip daddr 10.0.2.2 drop
        }
      }
runcmd:
  - [mkdir, -p, /opt/paperboard]
  - [curl, -fsS, -o, /opt/paperboard/agent.py, "${seed}/agent.py"]
  - [curl, -fsS, -o, /opt/paperboard/session.sh, "${seed}/session.sh"]
  - [curl, -fsS, -o, /tmp/helium.deb, "${seed}/helium.deb"]
  - [sh, -c, "DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/helium.deb && rm /tmp/helium.deb"]
  - [chown, "root:agent", /etc/paperboard/token]
  # the agent's own computer: its hands run as it and it may update them (the VM is the boundary)
  - [chown, -R, "agent:agent", /opt/paperboard]
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, nftables, paperboard-computer]
`;
}

export const META_DATA = "instance-id: paperboard-computer\nlocal-hostname: computer\n";
