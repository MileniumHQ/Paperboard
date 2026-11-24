// `papercrane install-service` / `uninstall-service`: run the daemon under
// the computer's service manager so it starts with the computer and comes
// back after a crash.
//
//   Linux    systemd unit, per user (~/.config/systemd/user) or system-wide
//            (/etc/systemd/system, as an unprivileged account)
//   macOS    launchd job, a LaunchAgent (per user) or a LaunchDaemon
//   Windows  Task Scheduler task, at sign-in (per user) or at startup
//            without anyone signed in (--system, as an administrator)
//
// Every service runs with --headless and is told to stop only the daemon
// process (systemd KillMode=process, launchd AbandonProcessGroup; a Windows
// supervisor is its own detached process): game
// servers and other workloads run in detached supervisors that must outlive
// a daemon restart, and the next daemon adopts them (see onSignal in
// index.ts). Uninstalling stops and removes the service, never the data.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { EXIT, type ServiceTarget } from "./cli";
import { errorMessage } from "@mileniumhq/paperapi/errors";

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
    // Task Scheduler reads its XML as UTF-16
    encoding?: "utf16le";
    // run in order after the file is written
    commands: string[][];
    dataDir: string;
    logs: string[];
    // how to read the PID the manager started, for the readiness check
    mainPid: () => number | null;
    // the file whose last lines a failed start shows
    logFile?: string;
    notes: string[];
}

const READY_TIMEOUT_MS = 20_000;

// The binary the service runs. From source (`bun apps/daemon/src/main.ts`) the
// runtime is bare bun, which cannot re-invoke itself to run a panel's
// service, so only a compiled papercrane can be a service.
function daemonExecutable(): string {
    const main = (globalThis as { Bun?: { main?: string } }).Bun?.main ?? "";
    const compiled = main.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(main);
    if (!compiled) {
        throw new Error("install-service needs the compiled papercrane binary (this is a source checkout). Build it in apps/daemon with `bun build --compile ./src/main.ts \`bun ../../scripts/build/supervisor.ts --path\` --outfile papercrane` and run that.");
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
    if (process.platform === "win32") {
        if (target.scope === "system" && !isWindowsAdmin()) {
            throw new Error("A --system service needs an administrator. Run it again from a terminal opened with Run as administrator.");
        }
        return;
    }
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
        logFile,
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

// Task Scheduler stands in for a service manager: a Windows service must be
// a program that answers the service control manager, which papercrane is
// not. A user task runs while that user is signed in (like a LaunchAgent); a
// --system task starts at boot with nobody signed in, as an account whose
// password is never stored (S4U). Every question to Task Scheduler goes
// through its COM interface, whose answers don't depend on the language
// Windows is in (schtasks /Query prints a translated status).

/** a PowerShell string literal */
function psString(text: string): string {
    return `'${text.replace(/'/g, "''")}'`;
}

function powershell(script: string, what: string): string {
    const result = tryRun(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `$ErrorActionPreference = 'Stop'; ${script}`]);
    if (result.status !== 0) throw new Error(`Could not ${what}: ${`${result.stderr}${result.stdout}`.trim() || `PowerShell exited with ${result.status}`}`);
    return result.stdout.trim();
}

function isWindowsAdmin(): boolean {
    // the token itself, which no service (like the Server service `net session` needs) can hide
    return powershell(
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        "check whether this terminal runs as an administrator",
    ) === "True";
}

interface WindowsTaskState {
    exists: boolean;
    running: boolean;
    // the daemon the running task started, once it is up
    pid: number | null;
}

/**
 * Whether a task exists and runs, and the PID of the papercrane it runs: the
 * task's running instance names the process it started (the daemon, or the
 * conhost of a user task), and the daemon is that process or one below it.
 */
function windowsTaskState(task: string, exe: string | null): WindowsTaskState {
    const cut = task.lastIndexOf("\\");
    const folder = cut > 0 ? task.slice(0, cut) : "\\";
    const name = task.slice(cut + 1);
    const answer = powershell([
        "$service = New-Object -ComObject Schedule.Service; $service.Connect()",
        // a missing task or folder (0x80070002, 0x80070003) is an answer; any other failure is not
        `try { $task = $service.GetFolder(${psString(folder)}).GetTask(${psString(name)}) } catch { $e = if ($_.Exception.InnerException) { $_.Exception.InnerException } else { $_.Exception }; if ($e.HResult -in -2147024894, -2147024893) { '{"exists":false,"running":false,"pid":null}'; exit 0 }; throw }`,
        "$running = @($task.GetInstances(0))",
        "if ($running.Count -eq 0) { '{\"exists\":true,\"running\":false,\"pid\":null}'; exit 0 }",
        ...(exe === null ? ["'{\"exists\":true,\"running\":true,\"pid\":null}'; exit 0"] : []),
        "$engine = [int]$running[0].EnginePID",
        "$all = @(Get-CimInstance Win32_Process); $byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }",
        `$daemon = $all | Where-Object { $_.ExecutablePath -eq ${psString(exe ?? "")} } | Where-Object { $p = $_; $found = $false; for ($i = 0; $i -lt 4 -and $p; $i++) { if ([int]$p.ProcessId -eq $engine) { $found = $true; break }; $p = $byId[[int]$p.ParentProcessId] }; $found } | Select-Object -First 1`,
        // ($pid is PowerShell's own, read-only)
        "$daemonPid = if ($daemon) { [string]$daemon.ProcessId } else { 'null' }",
        "'{\"exists\":true,\"running\":true,\"pid\":' + $daemonPid + '}'",
    ].join("; "), `ask Task Scheduler about ${task}`);
    return JSON.parse(answer) as WindowsTaskState;
}

/** an account as Task Scheduler names it: DOMAIN\user */
function windowsAccount(runAs: string | undefined): string {
    if (runAs) return runAs.includes("\\") ? runAs : `${process.env.USERDOMAIN || os.hostname()}\\${runAs}`;
    return `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
}

/** one argument as the program's command line carries it (CommandLineToArgvW's rules) */
export function windowsArg(arg: string): string {
    if (arg !== "" && !/[\s"]/.test(arg)) return arg;
    // backslashes double only before a quote, including the closing one
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

export function taskSchedulerXml(options: {
    scope: "user" | "system";
    account: string;
    command: string;
    args: string[];
    dataDir: string;
}): string {
    const trigger = options.scope === "user"
        ? [`    <LogonTrigger>`, `      <Enabled>true</Enabled>`, `      <UserId>${xml(options.account)}</UserId>`, `    </LogonTrigger>`]
        : [`    <BootTrigger>`, `      <Enabled>true</Enabled>`, `    </BootTrigger>`];
    // Task Scheduler never restarts a program that crashed once it started
    // (RestartOnFailure only covers a failed launch). This trigger starts the
    // task every minute; while the daemon runs, IgnoreNew skips it. The daemon
    // never exits cleanly on Windows, so a stopped task is a crashed one, and
    // stopping it on purpose disables the task first.
    const watchdog = [
        `    <TimeTrigger>`,
        `      <Repetition>`,
        `        <Interval>PT1M</Interval>`,
        `        <StopAtDurationEnd>false</StopAtDurationEnd>`,
        `      </Repetition>`,
        `      <StartBoundary>2000-01-01T00:00:00</StartBoundary>`,
        `      <Enabled>true</Enabled>`,
        `    </TimeTrigger>`,
    ];
    return [
        `<?xml version="1.0" encoding="UTF-16"?>`,
        `<!-- Written by papercrane install-service. Remove it with papercrane uninstall-service. -->`,
        // uninstall-service reads the data directory back from here; a comment
        // can't hold "--", so such a path is left out (uninstall then can't name it)
        ...(options.dataDir.includes("--") ? [] : [`<!-- Paperboard data: ${xml(options.dataDir)} -->`]),
        `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
        `  <RegistrationInfo>`,
        `    <Description>Paperboard server daemon</Description>`,
        `    <Documentation>https://paperboard.dev</Documentation>`,
        `  </RegistrationInfo>`,
        `  <Triggers>`,
        ...trigger,
        ...watchdog,
        `  </Triggers>`,
        `  <Principals>`,
        `    <Principal id="Author">`,
        `      <UserId>${xml(options.account)}</UserId>`,
        // S4U: runs with nobody signed in, and no password is kept
        `      <LogonType>${options.scope === "user" ? "InteractiveToken" : "S4U"}</LogonType>`,
        `      <RunLevel>LeastPrivilege</RunLevel>`,
        `    </Principal>`,
        `  </Principals>`,
        `  <Settings>`,
        `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`,
        `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
        `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
        `    <StartWhenAvailable>true</StartWhenAvailable>`,
        `    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>`,
        `    <IdleSettings>`,
        `      <StopOnIdleEnd>false</StopOnIdleEnd>`,
        `      <RestartOnIdle>false</RestartOnIdle>`,
        `    </IdleSettings>`,
        `    <AllowStartOnDemand>true</AllowStartOnDemand>`,
        `    <Enabled>true</Enabled>`,
        `    <RunOnlyIfIdle>false</RunOnlyIfIdle>`,
        // the default limit stops a task after 72 hours; the daemon runs for good
        `    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>`,
        // the default (7) runs below normal, and workloads would inherit it
        `    <Priority>5</Priority>`,
        `  </Settings>`,
        `  <Actions Context="Author">`,
        `    <Exec>`,
        `      <Command>${xml(options.command)}</Command>`,
        `      <Arguments>${xml(options.args.map(windowsArg).join(" "))}</Arguments>`,
        `    </Exec>`,
        `  </Actions>`,
        `</Task>`,
        ``,
    ].join("\r\n");
}

/**
 * The task's path in Task Scheduler, whose names are one namespace for the
 * whole computer: a system task is \\Paperboard\\<name>, and each account's
 * user task has a folder of its own, so no two installs replace each other.
 */
function windowsTaskName(scope: "user" | "system", name: string): string {
    if (scope === "system") return `\\Paperboard\\${name}`;
    const account = os.userInfo().username.replace(/[\\/:*?"<>|]/g, "_");
    return `\\Paperboard\\${account}\\${name}`;
}

function windowsTaskFile(scope: "user" | "system", name: string): string {
    const base = scope === "user"
        ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
        : process.env.ProgramData || "C:\\ProgramData";
    return path.join(base, "Paperboard", "services", `${name}.xml`);
}

function windowsFirewallRule(name: string): string {
    return `Paperboard server daemon (${name})`;
}

function windowsFirewallRuleExists(rule: string): boolean {
    return tryRun(["netsh", "advfirewall", "firewall", "show", "rule", `name=${rule}`]).status === 0;
}

function windowsPlan(request: InstallRequest, execStart: (dataDir?: string) => string[]): Plan & { task: string; exe: string; firewallRule: string | null } {
    const { target } = request;
    const account = windowsAccount(target.scope === "system" ? request.runAs : undefined);
    const otherAccount = target.scope === "system" && request.runAs !== undefined && account.toLowerCase() !== windowsAccount(undefined).toLowerCase();
    if (otherAccount && !request.serve.dataDir) {
        throw new Error(`Say where ${request.runAs}'s Paperboard data goes with --data-dir.`);
    }
    const dataDir = request.serve.dataDir ?? path.join(os.homedir(), ".paperboard");
    const [command, ...args] = execStart(target.scope === "system" ? dataDir : request.serve.dataDir);
    const task = windowsTaskName(target.scope, target.name);
    // the other scope's task of this name would run a second daemon
    const other = windowsTaskName(target.scope === "user" ? "system" : "user", target.name);
    if (!target.dryRun && windowsTaskState(other, command!).exists) {
        throw new Error(target.scope === "user"
            ? `A system service named ${target.name} is installed. Remove it first: from a terminal opened with Run as administrator, run papercrane uninstall-service --system${target.name !== "papercrane" ? ` --name ${target.name}` : ""}`
            : `You have a user service named ${target.name}. Remove it first: papercrane uninstall-service${target.name !== "papercrane" ? ` --name ${target.name}` : ""}`);
    }
    // A user task's console program would open a window on the desktop,
    // which stops the daemon when closed: conhost --headless gives it a
    // console with no window. Ending the task ends only conhost, so the
    // daemon follows it out. A system task runs where no window shows, and
    // runs the daemon itself.
    const conhost = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "conhost.exe");
    const action = target.scope === "user"
        ? { command: conhost, args: ["--headless", command!, ...args, "--exit-with-parent"] }
        : { command: command!, args };
    const firewallRule = target.scope === "system" ? windowsFirewallRule(target.name) : null;
    const notes = target.scope === "user"
        ? [
            "A user task starts when you sign in and stops when you sign out.",
            "To run it with nobody signed in, install it from a terminal opened with Run as administrator: papercrane install-service --system",
            "The first time it listens on your network, Windows may ask whether to allow it through the firewall.",
        ]
        : [];
    return {
        unit: task,
        task,
        exe: command!,
        firewallRule,
        file: windowsTaskFile(target.scope, target.name),
        encoding: "utf16le",
        contents: taskSchedulerXml({ scope: target.scope, account, ...action, dataDir }),
        commands: [
            ["schtasks", "/Create", "/TN", task, "/XML", windowsTaskFile(target.scope, target.name), "/F"],
            ...(firewallRule
                ? [["netsh", "advfirewall", "firewall", "add", "rule", `name=${firewallRule}`, "dir=in", "action=allow", `program=${command}`, "enable=yes", "profile=any"]]
                : []),
            ["schtasks", "/Run", "/TN", task],
        ],
        dataDir,
        logs: [path.join(dataDir, "logs", "paperboard.log"), `schtasks /Query /TN ${task} /V /FO LIST`],
        logFile: path.join(dataDir, "logs", "paperboard.log"),
        mainPid: () => windowsTaskState(task, command!).pid,
        notes,
    };
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
                throw new Error(`${handshake} could not be read: ${errorMessage(err)}`);
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
    const log = plan.logFile;
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
    if (process.platform === "win32") return windowsPlan(request, execStart);
    throw new Error(`install-service does not support ${process.platform}.`);
}

export async function installService(request: InstallRequest): Promise<number> {
    requireScopeRights(request.target);
    const plan = planFor(request);
    const scopeWord = request.target.scope === "user" ? "user" : "system";
    if (request.target.dryRun) {
        console.log(`Would write ${plan.file}:\n`);
        console.log(plan.contents.replace(/^/gm, "    "));
        console.log("Would run:");
        if (process.platform === "darwin") console.log(`    launchctl bootout ${(plan as ReturnType<typeof launchdPlan>).domain}/${plan.unit}   (only if it is already loaded)`);
        if (process.platform === "win32") console.log(`    schtasks /End /TN ${plan.unit}   (only if it is already running)`);
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
    if (process.platform === "win32") {
        const win = plan as ReturnType<typeof windowsPlan>;
        // an update replaces the running daemon: /Create under a running
        // instance would leave the old one running with its old options.
        // Disabled first, so the every-minute trigger can't start it again
        // before /Create; /Create enables it.
        const old = windowsTaskState(win.task, win.exe);
        const steps = [
            ...(old.exists ? [["schtasks", "/Change", "/TN", win.task, "/DISABLE"]] : []),
            ...(old.running ? [["schtasks", "/End", "/TN", win.task]] : []),
        ];
        for (const step of steps) {
            run(step);
            ran.push(step);
        }
        // a rule from an earlier install may name an older program
        if (win.firewallRule && windowsFirewallRuleExists(win.firewallRule)) {
            const remove = ["netsh", "advfirewall", "firewall", "delete", "rule", `name=${win.firewallRule}`];
            run(remove);
            ran.push(remove);
        }
    }
    fs.mkdirSync(path.dirname(plan.file), { recursive: true });
    fs.writeFileSync(
        plan.file,
        plan.encoding === "utf16le" ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(plan.contents, "utf16le")]) : plan.contents,
        { mode: 0o644 },
    );
    for (const command of plan.commands) {
        run(command);
        ran.push(command);
    }

    let ready: Ready;
    try {
        ready = await waitForDaemon(plan);
    } catch (err) {
        const logs = recentLogs(plan, request);
        console.error(`${errorMessage(err)}${logs ? `\n\nRecent log lines:\n${logs}` : ""}`);
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

// a service file as text: Task Scheduler's XML is UTF-16
function readServiceFile(file: string): string {
    const bytes = fs.readFileSync(file);
    return bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8");
}

export async function uninstallService(target: ServiceTarget): Promise<number> {
    if (process.platform !== "linux" && process.platform !== "darwin" && process.platform !== "win32") {
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
    } else if (process.platform === "win32") {
        const task = windowsTaskName(target.scope, target.name);
        file = windowsTaskFile(target.scope, target.name);
        // the task and its firewall rule go before the file that marks the
        // install, so a failed step can be run again
        const state = target.dryRun ? { exists: true, running: true } : windowsTaskState(task, null);
        const rule = windowsFirewallRule(target.name);
        stop = [
            // disabled first, so the every-minute trigger can't start it between /End and /Delete
            ...(state.exists ? [["schtasks", "/Change", "/TN", task, "/DISABLE"]] : []),
            ...(state.running ? [["schtasks", "/End", "/TN", task]] : []),
            ...(state.exists ? [["schtasks", "/Delete", "/TN", task, "/F"]] : []),
            ...(target.scope === "system" && (target.dryRun || windowsFirewallRuleExists(rule))
                ? [["netsh", "advfirewall", "firewall", "delete", "rule", `name=${rule}`]]
                : []),
        ];
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
        const elevated = process.platform === "win32" ? "from a terminal opened with Run as administrator, run papercrane" : "run sudo papercrane";
        console.error(`No ${target.name} ${target.scope} service is installed (there is no ${file}).${target.scope === "user" ? ` If you installed a system service, ${elevated} uninstall-service --system${flags.replace(" --system", "")}.` : ""}`);
        return EXIT.FAILURE;
    }
    const dataDir = /Paperboard data: (.*?)( -->)?$/m.exec(readServiceFile(file))?.[1] ?? null;
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
