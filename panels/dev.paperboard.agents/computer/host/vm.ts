// Scratch prototype: boot the agent's computer, a Debian VM under QEMU.
//
//   bun computer/host/vm.ts [--state DIR] [--memory MB] [--disk GB]
//
// First boot copies nothing: the disk is a thin overlay on Debian's cloud
// image, and cloud-init pulls its setup (packages, the guest agent, Helium)
// from a loopback-only seed server that lives just as long as setup does.
// The guest agent is reachable only on 127.0.0.1 through QEMU's forwarding,
// with a bearer token. state.json (0600) records the port and token for the
// MCP bridge. Ctrl-C stops QEMU and waits for it to exit.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
    options: {
        state: { type: "string", default: "/var/tmp/pb-computer/vm" },
        memory: { type: "string", default: "4096" },
        disk: { type: "string", default: "32" },
        base: { type: "string", default: "/var/tmp/pb-computer/dl/debian-13-genericcloud-amd64.qcow2" },
        helium: { type: "string", default: "/var/tmp/pb-computer/dl/helium-bin_0.20.1.1-1_amd64.deb" },
    },
});

const STATE = resolve(values.state!);
const GUEST = resolve(import.meta.dir, "../guest");
const DISK = join(STATE, "disk.qcow2");
const STATE_FILE = join(STATE, "state.json");
const GUEST_PORT = 7070;

mkdirSync(STATE, { recursive: true, mode: 0o700 });

async function run(argv: string[]) {
    const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) throw new Error(`${argv[0]} exited ${code}: ${err.trim()}`);
    return out;
}

function freePort(): Promise<number> {
    return new Promise((ok, fail) => {
        const s = createServer();
        s.once("error", fail);
        s.listen(0, "127.0.0.1", () => {
            const port = (s.address() as { port: number }).port;
            s.close(() => ok(port));
        });
    });
}

const firstBoot = !existsSync(DISK);
const token = firstBoot ? randomBytes(32).toString("hex") : JSON.parse(readFileSync(STATE_FILE, "utf8")).token;
if (firstBoot) await run(["qemu-img", "create", "-q", "-f", "qcow2", "-F", "qcow2", "-b", resolve(values.base!), DISK, `${values.disk}G`]);

// ------------------------------------------------------------- first-boot seed

const PACKAGES = [
    "xvfb", "xdotool", "x11-utils", "python3-xlib", "python3-pil", "python3-gi", "gir1.2-atspi-2.0",
    "at-spi2-core", "dbus-daemon", "python3-websocket", "fonts-dejavu-core", "fonts-liberation2",
    "fonts-noto-color-emoji", "mousepad", "galculator", "nftables", "curl", "ca-certificates",
];

function userData(seed: string) {
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
      StandardOutput=journal+console
      StandardError=journal+console
      Restart=always
      RestartSec=2
      [Install]
      WantedBy=multi-user.target
  # the host's loopback is 10.0.2.2 from in here; the agent never gets to see it
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

async function startSeed() {
    const files: Record<string, () => Response> = {
        "/meta-data": () => new Response("instance-id: paperboard-computer\nlocal-hostname: computer\n"),
        "/vendor-data": () => new Response(""),
        "/agent.py": () => new Response(Bun.file(join(GUEST, "agent.py"))),
        "/session.sh": () => new Response(Bun.file(join(GUEST, "session.sh"))),
        "/helium.deb": () => new Response(Bun.file(resolve(values.helium!))),
    };
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/user-data") return new Response(userData(`http://10.0.2.2:${server.port}`));
            return files[path]?.() ?? new Response("not found", { status: 404 });
        },
    });
    return server;
}

// ------------------------------------------------------------- boot

const port = await freePort();
const seed = firstBoot ? await startSeed() : null;
const argv = [
    "qemu-system-x86_64",
    "-machine", "q35,accel=kvm",
    "-cpu", "host",
    "-smp", "4",
    "-m", values.memory!,
    "-drive", `if=virtio,file=${DISK},format=qcow2,discard=unmap`,
    "-netdev", `user,id=n0,hostfwd=tcp:127.0.0.1:${port}-:${GUEST_PORT}`,
    "-device", "virtio-net-pci,netdev=n0",
    "-device", "virtio-balloon",
    "-display", "none",
    "-monitor", "none",
    "-serial", `file:${join(STATE, "console.log")}`,
    ...(seed ? ["-smbios", `type=1,serial=ds=nocloud;s=http://10.0.2.2:${seed.port}/`] : []),
];
const qemu = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" });
writeFileSync(STATE_FILE, JSON.stringify({ port, token, pid: qemu.pid }), { mode: 0o600 });
chmodSync(STATE_FILE, 0o600);

let stopping = false;
const stop = async () => {
    if (stopping) return;
    stopping = true;
    qemu.kill("SIGTERM");
    await qemu.exited;
    seed?.stop(true);
    console.log("computer stopped");
    process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`${firstBoot ? "first boot (setup can take a few minutes)" : "booting"}; agent will be on 127.0.0.1:${port}`);
const started = Date.now();
const READY_TIMEOUT_MS = (firstBoot ? 20 : 3) * 60_000;
let lastError = "no answer yet";
for (;;) {
    if (qemu.exitCode !== null) throw new Error(`qemu exited early (${qemu.exitCode}); see ${join(STATE, "console.log")}`);
    if (Date.now() - started > READY_TIMEOUT_MS) {
        await stop();
        throw new Error(`the computer never became ready (${lastError}); see ${join(STATE, "console.log")}`);
    }
    try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
        if (r.ok) break;
        lastError = `health answered ${r.status}`;
    } catch (e) {
        // still booting or installing: remember why, and poll again until the deadline
        lastError = e instanceof Error ? e.message : String(e);
    }
    await Bun.sleep(2000);
}
seed?.stop(true);
console.log(`computer ready after ${Math.round((Date.now() - started) / 1000)} s`);
await qemu.exited;
