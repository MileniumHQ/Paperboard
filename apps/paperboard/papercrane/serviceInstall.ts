// `papercrane install-service` / `uninstall-service`: run the daemon under
// the computer's service manager so it starts with the computer and comes
// back after a crash.
//
//   Linux    systemd unit, per user (~/.config/systemd/user) or system-wide
//            (/etc/systemd/system, as an unprivileged account)
//   macOS    launchd job, a LaunchAgent (per user) or a LaunchDaemon
//   Windows  not automated; prints how to do it by hand
//
// Every service runs with --headless and is told to stop only the daemon
// process (systemd KillMode=process, launchd AbandonProcessGroup): game
// servers and other workloads run in detached supervisors that must outlive
// a daemon restart, and the next daemon adopts them (see onSignal in
// index.ts). Uninstalling stops and removes the service, never the data.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { EXIT, type ServiceTarget } from "./cli";

export interface InstallRequest {
    target: ServiceTarget;
    serve: { port?: number; host?: string; dataDir?: string };
    runAs?: string;
}

interface Account {
    name: string;
    uid: number;
    home: string;
}

interface Plan {
    // what the service is called in the manager's own commands
    unit: string;
    file: string;
    contents: string;
    // run in order after the file is written
    commands: string[][];
    dataDir: string;
    logs: string[];
    // how to read the PID the manager started, for the readiness check
    mainPid: () => number | null;
    notes: string[];
}

const READY_TIMEOUT_MS = 20_000;

// The binary the service runs. From source (`bun papercrane/main.ts`) the
// runtime is bare bun, which cannot re-invoke itself as a supervisor, so
// only a compiled papercrane can be a service.
function daemonExecutable(): string {
    const main = (globalThis as { Bun?: { main?: string } }).Bun?.main ?? "";
    const compiled = main.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(main);
    if (!compiled) {
        throw new Error("install-service needs the compiled papercrane binary (this is a source checkout). Build it with `bun build --compile ./papercrane/main.ts --outfile papercrane` and run that.");
    }
    return process.execPath;
}

function run(command: string[], what = command.join(" ")): string {
    const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
    if (result.error) throw new Error(`Could not run ${what}: ${result.error.message}`);
    if (result.status !== 0) {
        const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
        throw new Error(`${what} failed (exit ${result.status})${detail ? `:\n${detail}` : ""}`);
    }
    return result.stdout ?? "";
}

function tryRun(command: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
    if (result.error) throw new Error(`Could not run ${command.join(" ")}: ${result.error.message}`);
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function isRoot(): boolean {
    return typeof process.getuid === "function" && process.getuid() === 0;
}

function currentAccount(): Account {
    const info = os.userInfo();
    return { name: info.username, uid: info.uid, home: info.homedir };
}

function lookupAccount(name: string): Account {
    if (process.platform === "darwin") {
        const uid = tryRun(["id", "-u", name]);
        if (uid.status !== 0) throw new Error(`There is no user named ${name} on this computer.`);
        const home = /NFSHomeDirectory:\s*(\S.*)$/m.exec(run(["dscl", ".", "-read", `/Users/${name}`, "NFSHomeDirectory"]))?.[1]?.trim();
        if (!home) throw new Error(`Could not find the home folder of ${name}.`);
        return { name, uid: Number(uid.stdout.trim()), home };
    }
    const entry = tryRun(["getent", "passwd", name]);
    if (entry.status !== 0) throw new Error(`There is no user named ${name} on this computer.`);
    const fields = entry.stdout.trim().split(":");
    return { name, uid: Number(fields[2]), home: fields[5] };
}

// the account a system service runs as: --run-as, else whoever ran sudo.
// Panels run code with the daemon's rights, so root is only by request.
function systemAccount(runAs: string | undefined): Account {
    const name = runAs ?? process.env.SUDO_USER;
    if (!name) {
        throw new Error("Say which account runs the daemon with --run-as <user>. (Run with sudo from your own account and it defaults to you; --run-as root works but gives every panel root.)");
    }
    return lookupAccount(name);
}

function requireScopeRights(target: ServiceTarget): void {
    if (target.dryRun) return;
    if (target.scope === "system" && !isRoot()) {
        throw new Error("A --system service needs root. Run it again with sudo.");
    }
    if (target.scope === "user" && isRoot()) {
        throw new Error("This is running as root, which would install the service for root. Add --system to install a system service, or run it as your own user.");
    }
}

// ── systemd ─────────────────────────────────────────────────────────────

// systemd's ExecStart is not a shell: quote with its own rules, and double
// the specifier (%) and variable ($) characters it would expand
function systemdArg(arg: string): string {
    const escaped = arg.replace(/%/g, "%%").replace(/\$/g, "$$$$");
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(escaped)) return escaped;
    return `"${escaped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function systemdUnitText(execStart: string[], scope: "user" | "system", account: Account | null, dataDir: string): string {
    return [
        `# Written by papercrane install-service. Remove it with papercrane uninstall-service.`,
        `# Paperboard data: ${dataDir}`,
        `[Unit]`,
        `Description=Paperboard server daemon`,
        `Documentation=https://paperboard.dev`,
        ...(scope === "system" ? [`After=network-online.target`, `Wants=network-online.target`] : []),
        ``,
        `[Service]`,
        `Type=simple`,
        ...(account ? [`User=${account.name}`] : []),
        `ExecStart=${execStart.map(systemdArg).join(" ")}`,
        `Restart=on-failure`,
        `RestartSec=5`,
        `# Stop only the daemon: game servers and other workloads keep running`,
        `# through a restart, and the next daemon adopts them.`,
        `KillMode=process`,
        `# A workload the kernel ends for memory is the daemon's to report: by`,
        `# default systemd would stop the daemon too, before it could say why.`,
        `OOMPolicy=continue`,
        ``,
        `[Install]`,
        `WantedBy=${scope === "system" ? "multi-user.target" : "default.target"}`,
        ``,
    ].join("\n");
}

function systemdPlan(request: InstallRequest, execStart: (dataDir?: string) => string[]): Plan {
    const { target } = request;
    const unit = `${target.name}.service`;
    const ctl = target.scope === "user" ? ["systemctl", "--user"] : ["systemctl"];
    const account = target.scope === "system" ? systemAccount(request.runAs) : null;
    const owner = account ?? currentAccount();
    const dataDir = request.serve.dataDir ?? path.join(owner.home, ".paperboard");
    const file = target.scope === "user"
        ? path.join(process.env.XDG_CONFIG_HOME || path.join(owner.home, ".config"), "systemd", "user", unit)
        : path.join("/etc/systemd/system", unit);
    const journal = target.scope === "user" ? `journalctl --user -u ${target.name} -f` : `journalctl -u ${target.name} -f`;
    const notes: string[] = [];
    if (target.scope === "user") {
        const linger = tryRun(["loginctl", "show-user", owner.name, "--property=Linger", "--value"]);
        if (linger.stdout.trim() !== "yes") {
            notes.push(
                "A user service starts when you sign in and stops when your last session ends.",
                `To keep it running on a headless computer, run: sudo loginctl enable-linger ${owner.name}`,
                "(or install a system service instead: sudo papercrane install-service --system)",
            );
        }
    }
    return {
        unit,
        file,
        contents: systemdUnitText(execStart(request.serve.dataDir), target.scope, account, dataDir),
        commands: [[...ctl, "daemon-reload"], [...ctl, "enable", unit], [...ctl, "restart", unit]],
        dataDir,
        logs: [journal, `${ctl.join(" ")} status ${target.name}`],
        mainPid: () => {
            const pid = Number(tryRun([...ctl, "show", "--property=MainPID", "--value", unit]).stdout.trim());
            return Number.isInteger(pid) && pid > 0 ? pid : null;
        },
        notes,
    };
}

// ── launchd ─────────────────────────────────────────────────────────────

function xml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function launchdLabel(name: string): string {
    return `dev.paperboard.${name}`;
}

function launchdPlistText(label: string, programArguments: string[], logFile: string, account: Account | null, dataDir: string): string {
    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
        `<!-- Written by papercrane install-service. Remove it with papercrane uninstall-service. -->`,
        `<!-- Paperboard data: ${xml(dataDir)} -->`,
        `<plist version="1.0">`,
        `<dict>`,
        `    <key>Label</key>`,
        `    <string>${xml(label)}</string>`,
        `    <key>ProgramArguments</key>`,
        `    <array>`,
        ...programArguments.map((arg) => `        <string>${xml(arg)}</string>`),
        `    </array>`,
        ...(account ? [`    <key>UserName</key>`, `    <string>${xml(account.name)}</string>`] : []),
        `    <key>RunAtLoad</key>`,
        `    <true/>`,
        `    <!-- restart after a crash, not after a clean stop -->`,
        `    <key>KeepAlive</key>`,
        `    <dict>`,
        `        <key>SuccessfulExit</key>`,
        `        <false/>`,
        `    </dict>`,
        `    <!-- stop only the daemon: game servers and other workloads keep running -->`,
        `    <!-- through a restart, and the next daemon adopts them -->`,
        `    <key>AbandonProcessGroup</key>`,
        `    <true/>`,
        `    <key>StandardOutPath</key>`,
        `    <string>${xml(logFile)}</string>`,
        `    <key>StandardErrorPath</key>`,
        `    <string>${xml(logFile)}</string>`,
        `</dict>`,
        `</plist>`,
        ``,
    ].join("\n");
}

function launchdPlan(request: InstallRequest, execStart: (dataDir?: string) => string[]): Plan & { logDir: string; owner: Account; domain: string; label: string } {
    const { target } = request;
    const label = launchdLabel(target.name);
    const account = target.scope === "system" ? systemAccount(request.runAs) : null;
    const owner = account ?? currentAccount();
    const dataDir = request.serve.dataDir ?? path.join(owner.home, ".paperboard");
    // a LaunchDaemon starts outside any login, so it names its data
    // directory instead of trusting HOME
    const programArguments = execStart(account ? dataDir : request.serve.dataDir);
    const logDir = target.scope === "user" ? path.join(owner.home, "Library", "Logs", "Paperboard") : "/Library/Logs/Paperboard";
    const logFile = path.join(logDir, `${target.name}.log`);
    const file = target.scope === "user"
        ? path.join(owner.home, "Library", "LaunchAgents", `${label}.plist`)
        : path.join("/Library/LaunchDaemons", `${label}.plist`);
    const domain = target.scope === "user" ? `gui/${owner.uid}` : "system";
    return {
        unit: label,
        label,
        domain,
        owner,
        logDir,
        file,
        contents: launchdPlistText(label, programArguments, logFile, account, dataDir),
        // bootstrap starts it (RunAtLoad); a loaded old job is booted out first
        commands: [["launchctl", "bootstrap", domain, file]],
        dataDir,
        logs: [`tail -f ${logFile}`, `launchctl print ${domain}/${label}`],
        mainPid: () => {
            const printed = tryRun(["launchctl", "print", `${domain}/${label}`]);
            const pid = Number(/^\s*pid = (\d+)/m.exec(printed.stdout)?.[1]);
            return Number.isInteger(pid) && pid > 0 ? pid : null;
        },
        notes: target.scope === "user"
            ? ["A LaunchAgent runs while you are signed in to this Mac. To run it with nobody signed in, install a system service instead: sudo papercrane install-service --system"]
            : [],
    };
}

function launchdLoaded(domain: string, label: string): boolean {
    return tryRun(["launchctl", "print", `${domain}/${label}`]).status === 0;
}

// ── Windows ─────────────────────────────────────────────────────────────

function windowsInstructions(): string {
    const exe = process.execPath;
    return [
        "install-service cannot set up a Windows service yet. To start the daemon when you sign in, run this in a terminal opened with Run as administrator:",
        "",
        `  schtasks /Create /TN "Paperboard server daemon" /SC ONLOGON /RL LIMITED /TR "\\"${exe}\\" --headless"`,
        "",
        "Remove it with:",
        "",
        `  schtasks /Delete /TN "Paperboard server daemon"`,
    ].join("\n");
}

// ── readiness ───────────────────────────────────────────────────────────

interface Ready {
    pid: number;
    listen: string | null;
}

// The service is installed only once the daemon the manager started has
// written its handshake: same PID, so an old daemon's file never counts.
async function waitForDaemon(plan: Plan): Promise<Ready> {
    const handshake = path.join(plan.dataDir, "local", "crane.json");
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const { formatListenAddress } = await import("./tui");
    for (;;) {
        const pid = plan.mainPid();
        if (pid !== null && fs.existsSync(handshake)) {
            try {
                const record = JSON.parse(fs.readFileSync(handshake, "utf8"));
                if (record?.pid === pid) {
                    const l = record.listen;
                    return { pid, listen: l && typeof l.host === "string" ? formatListenAddress(l.host, l.port, l.secure === true) : null };
                }
            } catch (err) {
                // written atomically, so a parse failure is a real problem
                throw new Error(`${handshake} could not be read: ${(err as Error).message}`);
            }
        }
        if (Date.now() > deadline) {
            throw new Error(`The service was installed, but the daemon did not start within ${READY_TIMEOUT_MS / 1000} seconds.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}

function recentLogs(plan: Plan, request: { target: ServiceTarget }): string {
    if (process.platform === "linux") {
        const journal = request.target.scope === "user"
            ? ["journalctl", "--user", "-u", request.target.name, "-n", "20", "--no-pager"]
            : ["journalctl", "-u", request.target.name, "-n", "20", "--no-pager"];
        const out = tryRun(journal);
        return `${out.stdout}${out.stderr}`.trim();
    }
    const log = /tail -f (.*)$/.exec(plan.logs[0])?.[1];
    if (log && fs.existsSync(log)) return fs.readFileSync(log, "utf8").split("\n").slice(-20).join("\n").trim();
    return "";
}

// a daemon already running for the same data directory (say, one started by
// hand) would fight the service over the port and the data
async function refuseOtherDaemon(plan: Plan): Promise<void> {
    process.env.PAPERBOARD_DIR = plan.dataDir;
    const { readDaemonStatus } = await import("./localControl");
    const status = await readDaemonStatus();
    if (!status.running) return;
    const servicePid = plan.mainPid();
    if (status.pid !== undefined && status.pid === servicePid) return;
    throw new Error(`A Paperboard server daemon is already running for ${plan.dataDir}${status.pid !== undefined ? ` (PID ${status.pid})` : ""}. Stop it first, then install the service.`);
}

function printList(label: string, lines: string[]): void {
    lines.forEach((line, i) => console.log(`  ${(i === 0 ? label : "").padEnd(9)} ${line}`));
}

function planFor(request: InstallRequest): Plan {
    const exe = daemonExecutable();
    const execStart = (dataDir?: string) => [
        exe,
        "--headless",
        ...(request.serve.port !== undefined ? ["--port", String(request.serve.port)] : []),
        ...(request.serve.host !== undefined ? ["--host", request.serve.host] : []),
        ...(dataDir !== undefined ? ["--data-dir", dataDir] : []),
    ];
    if (process.platform === "linux") return systemdPlan(request, execStart);
    if (process.platform === "darwin") return launchdPlan(request, execStart);
    throw new Error(`install-service does not support ${process.platform}.`);
}

export async function installService(request: InstallRequest): Promise<number> {
    if (process.platform === "win32") {
        console.error(windowsInstructions());
        return EXIT.FAILURE;
    }
    requireScopeRights(request.target);
    const plan = planFor(request);
    const scopeWord = request.target.scope === "user" ? "user" : "system";
    if (request.target.dryRun) {
        console.log(`Would write ${plan.file}:\n`);
        console.log(plan.contents.replace(/^/gm, "    "));
        console.log("Would run:");
        if (process.platform === "darwin") console.log(`    launchctl bootout ${(plan as ReturnType<typeof launchdPlan>).domain}/${plan.unit}   (only if it is already loaded)`);
        for (const command of plan.commands) console.log(`    ${command.join(" ")}`);
        return EXIT.OK;
    }

    await refuseOtherDaemon(plan);
    const existed = fs.existsSync(plan.file);
    const ran: string[][] = [];
    if (process.platform === "darwin") {
        const mac = plan as ReturnType<typeof launchdPlan>;
        fs.mkdirSync(mac.logDir, { recursive: true });
        if (request.target.scope === "system") fs.chownSync(mac.logDir, mac.owner.uid, -1);
        if (launchdLoaded(mac.domain, mac.label)) {
            const bootout = ["launchctl", "bootout", `${mac.domain}/${mac.label}`];
            run(bootout);
            ran.push(bootout);
        }
    }
    fs.mkdirSync(path.dirname(plan.file), { recursive: true });
    fs.writeFileSync(plan.file, plan.contents, { mode: 0o644 });
    for (const command of plan.commands) {
        run(command);
        ran.push(command);
    }

    let ready: Ready;
    try {
        ready = await waitForDaemon(plan);
    } catch (err) {
        const logs = recentLogs(plan, request);
        console.error(`${(err as Error).message}${logs ? `\n\nRecent log lines:\n${logs}` : ""}`);
        console.error(`\nThe service is still installed. Fix the problem and run install-service again, or remove it with papercrane uninstall-service${request.target.scope === "system" ? " --system" : ""}${request.target.name !== "papercrane" ? ` --name ${request.target.name}` : ""}.`);
        return EXIT.FAILURE;
    }

    const flags = [
        ...(request.target.scope === "system" ? ["--system"] : []),
        ...(request.target.name !== "papercrane" ? ["--name", request.target.name] : []),
    ].join(" ");
    const dataFlag = request.serve.dataDir ? ` --data-dir ${request.serve.dataDir}` : "";
    console.log(`${existed ? "Updated" : "Installed"} the Paperboard server daemon as a ${scopeWord} service (${plan.unit}).\n`);
    printList("Wrote", [plan.file]);
    printList("Ran", ran.map((c) => c.join(" ")));
    console.log(`\nIt is running (PID ${ready.pid})${ready.listen ? ` on ${ready.listen}` : ""}.\n`);
    printList("Data", [plan.dataDir]);
    printList("Logs", plan.logs);
    printList("Pair", [`papercrane pair${dataFlag}`]);
    printList("Remove", [`papercrane uninstall-service${flags ? ` ${flags}` : ""}`]);
    if (plan.notes.length) console.log(`\n${plan.notes.join("\n")}`);
    return EXIT.OK;
}

export async function uninstallService(target: ServiceTarget): Promise<number> {
    if (process.platform === "win32") {
        console.error(windowsInstructions());
        return EXIT.FAILURE;
    }
    if (process.platform !== "linux" && process.platform !== "darwin") {
        throw new Error(`uninstall-service does not support ${process.platform}.`);
    }
    requireScopeRights(target);
    const account = currentAccount();
    let file: string;
    let stop: string[][];
    let after: string[][] = [];
    if (process.platform === "linux") {
        const unit = `${target.name}.service`;
        const ctl = target.scope === "user" ? ["systemctl", "--user"] : ["systemctl"];
        file = target.scope === "user"
            ? path.join(process.env.XDG_CONFIG_HOME || path.join(account.home, ".config"), "systemd", "user", unit)
            : path.join("/etc/systemd/system", unit);
        stop = [[...ctl, "disable", "--now", unit]];
        after = [[...ctl, "daemon-reload"]];
    } else {
        const label = launchdLabel(target.name);
        const domain = target.scope === "user" ? `gui/${account.uid}` : "system";
        file = target.scope === "user"
            ? path.join(account.home, "Library", "LaunchAgents", `${label}.plist`)
            : path.join("/Library/LaunchDaemons", `${label}.plist`);
        stop = !target.dryRun && !launchdLoaded(domain, label) ? [] : [["launchctl", "bootout", `${domain}/${label}`]];
    }
    if (!fs.existsSync(file)) {
        const flags = `${target.scope === "system" ? " --system" : ""}${target.name !== "papercrane" ? ` --name ${target.name}` : ""}`;
        console.error(`No ${target.name} ${target.scope} service is installed (there is no ${file}).${target.scope === "user" ? ` If you installed a system service, run sudo papercrane uninstall-service --system${flags.replace(" --system", "")}.` : ""}`);
        return EXIT.FAILURE;
    }
    const dataDir = /Paperboard data: (.*?)( -->)?$/m.exec(fs.readFileSync(file, "utf8"))?.[1] ?? null;
    if (target.dryRun) {
        console.log("Would run:");
        for (const command of [...stop, ["rm", file], ...after]) console.log(`    ${command.join(" ")}`);
        console.log(`\nYour data${dataDir ? ` in ${dataDir}` : ""} would be kept.`);
        return EXIT.OK;
    }
    // the daemon stops before its service file goes
    for (const command of stop) run(command);
    fs.unlinkSync(file);
    for (const command of after) run(command);
    console.log(`Removed the ${target.name} service.\n`);
    printList("Ran", stop.map((c) => c.join(" ")));
    printList("Removed", [file]);
    if (after.length) printList("Ran", after.map((c) => c.join(" ")));
    console.log(`\nYour data${dataDir ? ` in ${dataDir}` : ""} was kept. Game servers and other workloads the daemon started keep running; start the daemon again to manage them.`);
    return EXIT.OK;
}
