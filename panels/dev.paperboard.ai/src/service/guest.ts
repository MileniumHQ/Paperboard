// What goes into the agent's computer on its first boot.
//
// The VM is Debian's own cloud image plus an overlay disk. cloud-init reads
// its setup from a seed server the service runs on loopback for the length
// of the install only (QEMU's user network shows the host's loopback to the
// guest as 10.0.2.2). It's the agent's own computer, so the agent has sudo:
// no rule inside the guest can keep it from this machine. That boundary is
// passt, outside it: every boot after setup has no route to the host's loopback.

import AGENT_PY from "../../computer/guest/agent.py" with { type: "text" };
import SESSION_SH from "../../computer/guest/session.sh" with { type: "text" };

import { createHash } from "node:crypto";

export const GUEST_FILES = { "agent.py": AGENT_PY, "session.sh": SESSION_SH } as const;
type GuestFile = keyof typeof GUEST_FILES;

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest();

/** What the guest agent reports on /health when it runs these files: agent.py works it out the same way. */
export const GUEST_VERSION = createHash("sha256")
    .update(sha256(Buffer.from(AGENT_PY, "utf8")))
    .update(sha256(Buffer.from(SESSION_SH, "utf8")))
    .digest("hex");

const GUEST_DIR = "/opt/paperboard";

/**
 * The guest's shell command that replaces its files with these and restarts
 * its agent, for a computer set up by an older version. Built only from the
 * files above (base64, so nothing in them is read by the shell), never from
 * input. The agent is the shell's parent; systemd restarts the whole session
 * on the new files, which closes the apps open on the computer.
 */
export function updateCommand(): string {
    const put = (name: GuestFile) => `printf %s '${Buffer.from(GUEST_FILES[name], "utf8").toString("base64")}' | base64 -d > ${GUEST_DIR}/${name}.new`;
    return [
        put("agent.py"),
        put("session.sh"),
        `python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read())' ${GUEST_DIR}/agent.py.new`,
        `mv ${GUEST_DIR}/session.sh.new ${GUEST_DIR}/session.sh`,
        `mv ${GUEST_DIR}/agent.py.new ${GUEST_DIR}/agent.py`,
        "{ (sleep 0.5; kill $PPID) >/dev/null 2>&1 & }",
        "echo updated",
    ].join(" && ");
}

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
    "fonts-noto-color-emoji", "mousepad", "galculator", "curl", "ca-certificates",
];

/**
 * apt, installing without questions and printing its own progress (dlstatus: and pmstatus: lines) on the
 * console, where the host reads it for the setup's percentages. An argv list, written as JSON (valid YAML).
 */
const apt = (...args: string[]) =>
    JSON.stringify(["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-o", "APT::Status-Fd=1", "-o", "DPkg::Lock::Timeout=300", "-o", "Dpkg::Options::=--force-confold", "-y", ...args]);

/** The agent and its sudo, the same in setup and in the migration to it. Naming users also skips Debian's default one. */
const AGENT_USER = `users:
  - name: agent
    shell: /bin/bash
    lock_passwd: true
write_files:
  - path: /etc/sudoers.d/90-paperboard-agent
    permissions: "0440"
    content: |
      agent ALL=(ALL) NOPASSWD:ALL
`;

/** cloud-init user-data: the agent user, its display and hands. */
export function userData(seed: string, token: string): string {
    return `#cloud-config
hostname: computer
${AGENT_USER}  - path: /etc/paperboard/token
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
runcmd:
  - ${apt("update")}
  - ${apt("install", ...PACKAGES)}
  - [mkdir, -p, /opt/paperboard]
  - [curl, -fsS, -o, /opt/paperboard/agent.py, "${seed}/agent.py"]
  - [curl, -fsS, -o, /opt/paperboard/session.sh, "${seed}/session.sh"]
  - [curl, -fsS, -o, /tmp/helium.deb, "${seed}/helium.deb"]
  - ${apt("install", "/tmp/helium.deb")}
  - [rm, -f, /tmp/helium.deb]
  # tells the setup's progress the browser is in
  - [curl, -fsS, -o, /dev/null, "${seed}/progress/browser"]
  - [chown, "root:agent", /etc/paperboard/token]
  # the agent's own computer: its hands run as it and it may update them (the VM is the boundary)
  - [chown, -R, "agent:agent", /opt/paperboard]
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, paperboard-computer]
`;
}

export const META_DATA = "instance-id: paperboard-computer\nlocal-hostname: computer\n";

/**
 * A computer set up before the agent had sudo: a new instance id runs cloud-init once more, which gives
 * the agent sudo and retires the guest firewall that stood in for passt. Its seed is a disk, since that
 * firewall drops the seed server's address.
 */
export const SUDO_MIGRATION = {
    metaData: "instance-id: paperboard-computer-sudo\nlocal-hostname: computer\n",
    userData: `#cloud-config
${AGENT_USER}runcmd:
  - [systemctl, disable, --now, nftables]
`,
} as const;
