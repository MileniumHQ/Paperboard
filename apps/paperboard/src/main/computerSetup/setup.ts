// Setting a computer up over SSH: sign in, find or install its Paperboard
// Server, and pair with it, pinning the certificate the server names over
// the SSH session (whose host key is checked) instead of trusting whoever
// answers first. Electron-free: what it reaches is handed in, so tests drive
// it against an in-process SSH server.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { daemonReleaseKey, releaseMessage, verifyRelease } from "@mileniumhq/release";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import { extractArchive } from "daemon/engine/archives";
import { streamToFileWithProgress } from "daemon/packages/download";
import { validSha256 } from "daemon/packages/packageChecksum";
import { DEFAULT_PORT } from "daemon";
import { SshHostKeyChanged, SshPasswordRefused, SshSignInNeeded, type OpenSshOptions, type SshExecResult, type SshSession } from "./ssh";
import type { ComputerSetupState, SetupStep, SetupStepId } from "../../shared/shellContract";

export interface CraneIndexEntry {
    version: string;
    sha256: string;
    signature: string;
    downloadUrl?: string;
}

export interface ComputerSetupDeps {
    openSsh(options: Pick<OpenSshOptions, "host" | "username" | "password">): Promise<SshSession>;
    /** the account SSH signs in as when none is given (~/.ssh/config's User, else this computer's) */
    defaultUsername(host: string): string;
    /** the published crane releases by target ("linux-x64"), and where a target's archive downloads */
    craneIndex(): Promise<{ entries: Record<string, CraneIndexEntry>; downloadUrl(target: string): string }>;
    /** whether a Paperboard Server answers at host:port */
    probe(host: string, port: number): Promise<boolean>;
    /** the computer as it is listed once paired: a new one under its hostname, one paired before under the name it has */
    pair(host: string, port: number, code: string, expect: { fingerprint: string }): Promise<{ id: string; name: string }>;
    /** where the download is unpacked; removed afterwards */
    tempDir(): string;
    /** called with each new state */
    changed(state: ComputerSetupState): void;
}

type RemoteOs = "linux" | "macos" | "windows";

interface Remote {
    os: RemoteOs;
    arch: "x64" | "arm64";
    /** runs a script in sh (Linux, macOS) or PowerShell (Windows) */
    run(script: string, stdin?: Buffer | string): Promise<SshExecResult>;
    /** where an installed papercrane goes, as the script language spells it */
    installPath: string;
}

interface PairingLine {
    code: string;
    listen: { host: string; port: number };
    fingerprint: string;
}

// pair --json's first line; anything else stops the setup
function parsePairingLine(line: string): PairingLine {
    let parsed: Partial<PairingLine>;
    try {
        parsed = JSON.parse(line) as Partial<PairingLine>;
    } catch {
        // quiet: the line itself is the error said
        throw new SetupStopped(`papercrane pair answered with something other than a pairing: ${line}`);
    }
    if (typeof parsed.code !== "string" || typeof parsed.fingerprint !== "string" || typeof parsed.listen?.host !== "string" || typeof parsed.listen.port !== "number") {
        throw new SetupStopped(`papercrane pair answered with something other than a pairing: ${line}`);
    }
    return parsed as PairingLine;
}

// a step that can't go on; the message is what the person reads
class SetupStopped extends Error {}
// the computer can't be set up over SSH, but its pairing code still works
class UseCode extends Error {}
class Cancelled extends Error {}

const STEP_LABELS: Record<SetupStepId, { doing: string; done: string }> = {
    connect: { doing: "Connecting", done: "Connected" },
    signIn: { doing: "Signing in", done: "Signed in" },
    check: { doing: "Looking for Paperboard Server", done: "Found Paperboard Server" },
    install: { doing: "Installing Paperboard Server", done: "Installed Paperboard Server" },
    pair: { doing: "Pairing", done: "Paired" },
};

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;
// A script for Windows PowerShell, as base64 UTF-16 so no quoting has to
// survive the trip. A failing cmdlet stops it, and it exits with the last
// program's code: -Command alone exits 0 or 1, whatever papercrane said.
const encodedPowerShell = (script: string) => {
    const wrapped = `$ErrorActionPreference = 'Stop'\n${script}\nexit $LASTEXITCODE`;
    return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(wrapped, "utf16le").toString("base64")}`;
};
// What a command said, for a message: its last line (why it stopped) on
// the first line, the five before it below, where Details shows them
const said = (r: SshExecResult): string => {
    const lines = `${r.stderr}\n${r.stdout}`.split("\n").map((line) => line.trimEnd()).filter((line) => line !== "").slice(-6);
    const last = lines.pop();
    if (last === undefined) return `it exited with ${r.code ?? "no code"} and said nothing`;
    return lines.length > 0 ? `${last}\n${lines.join("\n")}` : last;
};

/**
 * One setup of one computer. A newer one replaces it (the caller cancels
 * this one), and its answers then go nowhere: every push carries the job id.
 */
export class ComputerSetupJob {
    private state: ComputerSetupState;
    private session: SshSession | null = null;
    private cancelled = false;
    private answer: { resolve: (c: { username: string; password: string }) => void; reject: (e: Error) => void } | null = null;
    // kept only while the job runs: sudo on the computer may need it once more
    private password: string | undefined;
    private stopPairing: (() => void) | null = null;
    // something to know once it's paired, said after the wizard closes
    private notice: string | undefined;

    constructor(
        readonly id: string,
        private readonly host: string,
        private readonly deps: ComputerSetupDeps,
    ) {
        this.state = {
            jobId: id,
            revision: 0,
            host,
            steps: (Object.keys(STEP_LABELS) as SetupStepId[]).map((step) => ({ id: step, status: "waiting", label: STEP_LABELS[step].doing })),
            signIn: null,
            result: null,
        };
    }

    current(): ComputerSetupState {
        return this.state;
    }

    async run(): Promise<void> {
        try {
            const { id, name } = await this.setUp();
            this.finish({ paired: { id, name, ...(this.notice ? { notice: this.notice } : {}) } });
        } catch (err) {
            if (err instanceof Cancelled || this.cancelled) return;
            this.failRunning();
            if (err instanceof UseCode) this.finish({ useCode: err.message });
            else this.finish({ failed: errorMessage(err) });
        } finally {
            this.password = undefined;
            this.stopPairing?.();
            this.session?.close();
            this.session = null;
        }
    }

    /** the account and password the person typed for the sign-in step */
    signIn(username: string, password: string): void {
        if (!this.answer) throw new Error("This setup isn't waiting for a password.");
        const answer = this.answer;
        this.answer = null;
        answer.resolve({ username, password });
    }

    cancel(): void {
        if (this.cancelled) return;
        this.cancelled = true;
        this.answer?.reject(new Cancelled());
        this.answer = null;
        this.stopPairing?.();
        this.session?.close();
    }

    private async setUp(): Promise<{ id: string; name: string }> {
        this.begin("connect");
        this.session = await this.signInStep();
        const session = this.session;
        this.done("connect", `Connected to ${this.host}`);
        this.done("signIn", `Signed in as ${session.username}`);

        this.begin("check");
        const remote = await this.detect(session);
        let binary = await this.findCrane(remote);
        const running = binary ? await this.isRunning(remote, binary) : false;
        if (!binary && (await this.deps.probe(session.host, DEFAULT_PORT))) {
            // a server answers but there's no papercrane to drive: the desktop
            // app runs it there, and a second daemon on its data would fight it
            throw new UseCode(`Paperboard is open on ${session.host}, so its server can't be set up over SSH. Pair it with the code from its Add Computer screen instead.`);
        }
        this.done("check", binary ? (running ? "Found Paperboard Server, running" : "Found Paperboard Server, not running") : "Paperboard Server isn't installed yet");

        if (!binary || !running) {
            this.begin("install");
            const installed = !binary;
            if (!binary) binary = await this.installCrane(remote);
            await this.startService(remote, binary, session.username);
            this.done("install", installed ? STEP_LABELS.install.done : "Started Paperboard Server");
        } else {
            this.skip("install", "Already installed");
        }

        this.begin("pair");
        const paired = await this.pairOver(remote, binary, session);
        this.done("pair", STEP_LABELS.pair.done);
        return paired;
    }

    // keys and the agent first; the person is asked only when they fail
    private async signInStep(): Promise<SshSession> {
        let attempt: { username?: string; password?: string } = {};
        let error: string | undefined;
        for (;;) {
            this.check();
            try {
                const session = await this.deps.openSsh({ host: this.host, ...attempt });
                this.password = attempt.password;
                this.set({ signIn: null });
                return session;
            } catch (err) {
                if (err instanceof SshHostKeyChanged) throw new SetupStopped(err.message);
                if (!(err instanceof SshSignInNeeded) && !(err instanceof SshPasswordRefused)) throw err;
                // its own words: a server may take no passwords at all
                error = err instanceof SshPasswordRefused ? err.message : undefined;
            }
            this.done("connect", `Connected to ${this.host}`);
            this.begin("signIn");
            this.set({ signIn: { username: attempt.username ?? this.deps.defaultUsername(this.host), ...(error ? { error } : {}) } });
            attempt = await new Promise((resolve, reject) => {
                this.answer = { resolve, reject };
            });
            this.set({ signIn: null });
        }
    }

    private async detect(session: SshSession): Promise<Remote> {
        const uname = await session.exec("uname -sm");
        // Git for Windows and MSYS bring a uname of their own: that's Windows
        if (uname.code === 0 && !/^(MINGW|MSYS|CYGWIN)/i.test(uname.stdout.trim())) {
            const [kernel, machine] = uname.stdout.trim().split(/\s+/);
            const remoteOs = kernel === "Linux" ? "linux" : kernel === "Darwin" ? "macos" : null;
            const arch = machine === "x86_64" || machine === "amd64" ? "x64" : machine === "aarch64" || machine === "arm64" ? "arm64" : null;
            if (!remoteOs || !arch) throw new SetupStopped(`Paperboard Server doesn't run on ${uname.stdout.trim()}.`);
            return {
                os: remoteOs,
                arch,
                installPath: "$HOME/.local/bin/papercrane",
                run: (script, stdin) => session.exec(`sh -c ${sh(script)}`, stdin === undefined ? {} : { stdin }),
            };
        }
        const run = (script: string, stdin?: Buffer | string) =>
            session.exec(encodedPowerShell(script), stdin === undefined ? {} : { stdin });
        const windows = await run("$env:PROCESSOR_ARCHITECTURE");
        if (windows.code !== 0) throw new SetupStopped(`Couldn't tell what system ${session.host} runs: ${said(uname)}`);
        const arch = windows.stdout.trim().toUpperCase();
        if (arch !== "AMD64" && arch !== "ARM64") throw new SetupStopped(`Paperboard Server doesn't run on Windows for ${arch}.`);
        return { os: "windows", arch: arch === "AMD64" ? "x64" : "arm64", installPath: "$env:LOCALAPPDATA\\Paperboard\\bin\\papercrane.exe", run };
    }

    // the papercrane on its PATH, else the one Paperboard installs; null when neither
    private async findCrane(remote: Remote): Promise<string | null> {
        const found = remote.os === "windows"
            ? await remote.run(`$c = Get-Command papercrane -ErrorAction SilentlyContinue; if ($c) { $c.Source } elseif (Test-Path "${remote.installPath}") { "${remote.installPath}" }`)
            : await remote.run(`if command -v papercrane >/dev/null 2>&1; then command -v papercrane; elif [ -x "${remote.installPath}" ]; then echo "${remote.installPath}"; fi`);
        if (found.code !== 0) throw new SetupStopped(`Couldn't look for Paperboard Server: ${said(found)}`);
        return found.stdout.trim().split("\n")[0]?.trim() || null;
    }

    private crane(remote: Remote, binary: string, args: string): string {
        return remote.os === "windows" ? `& ${ps(binary)} ${args}` : `${sh(binary)} ${args}`;
    }

    private async isRunning(remote: Remote, binary: string): Promise<boolean> {
        const status = await remote.run(this.crane(remote, binary, "status --json"));
        // 3: no daemon runs for its data
        if (status.code === 3) return false;
        if (status.code !== 0) throw new SetupStopped(`papercrane status failed on ${this.host}: ${said(status)}`);
        return (JSON.parse(status.stdout) as { running: boolean }).running;
    }

    // the signed release for that computer, checked here before a byte goes there
    private async installCrane(remote: Remote): Promise<string> {
        const target = `${remote.os}-${remote.arch}`;
        const index = await this.deps.craneIndex();
        const entry = index.entries[target];
        if (!entry) throw new SetupStopped(`Paperboard publishes no server for ${target}.`);
        if (!validSha256(entry.sha256) || !verifyRelease(releaseMessage.crane(entry.version, entry.sha256), entry.signature, daemonReleaseKey())) {
            throw new SetupStopped(`The Paperboard Server ${entry.version} release for ${target} isn't signed by Paperboard's release key, so it wasn't installed.`);
        }
        const dir = fs.mkdtempSync(path.join(this.deps.tempDir(), "pb-crane-"));
        try {
            const archive = path.join(dir, remote.os === "windows" ? "crane.zip" : "crane.tar.gz");
            await streamToFileWithProgress(entry.downloadUrl ?? index.downloadUrl(target), archive, (p) => {
                if (p.stage === "downloading") this.progress("install", Math.round(p.percent * 0.8), `Downloading Paperboard Server ${entry.version}`);
            }, undefined, entry.sha256);
            const contents = path.join(dir, "contents");
            await extractArchive(archive, contents);
            const name = remote.os === "windows" ? `papercrane-${target}.exe` : `papercrane-${target}`;
            const bytes = fs.readFileSync(path.join(contents, name));
            const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
            this.progress("install", 85, `Copying Paperboard Server to ${this.host}`);
            const part = `${remote.installPath}.part`;
            const copied = remote.os === "windows"
                ? await remote.run(`$f = "${part}"; New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null; $o = [IO.File]::Create($f); [Console]::OpenStandardInput().CopyTo($o); $o.Close(); (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower()`, bytes)
                : await remote.run(`f="${part}"; mkdir -p "$(dirname "$f")" && cat > "$f" && chmod 755 "$f" && { sha256sum "$f" 2>/dev/null || shasum -a 256 "$f"; } | cut -d' ' -f1`, bytes);
            if (copied.code !== 0) throw new SetupStopped(`Couldn't copy Paperboard Server to ${this.host}: ${said(copied)}`);
            if (copied.stdout.trim() !== sha256) throw new SetupStopped(`Paperboard Server arrived on ${this.host} changed (its checksum differs), so it wasn't installed.`);
            const placed = remote.os === "windows"
                ? await remote.run(`Move-Item -Force "${part}" "${remote.installPath}"; "${remote.installPath}"`)
                : await remote.run(`mv "${part}" "${remote.installPath}" && echo "${remote.installPath}"`);
            if (placed.code !== 0) throw new SetupStopped(`Couldn't put Paperboard Server in place on ${this.host}: ${said(placed)}`);
            return placed.stdout.trim();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    // a service that starts with the computer; install-service also starts an installed one again
    private async startService(remote: Remote, binary: string, username: string): Promise<void> {
        this.progress("install", 90, "Setting it up to start with the computer");
        const sudo = (command: string) => `sudo -S -p '' ${command}`;
        let result: SshExecResult;
        const root = remote.os !== "windows" && (await remote.run("id -u")).stdout.trim() === "0";
        if (remote.os === "windows") {
            // a user task runs only while its account is signed in at the
            // desktop, which an SSH session isn't: only a system task runs
            const admin = await remote.run("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)");
            if (admin.stdout.trim() !== "True") {
                throw new UseCode(`${username} isn't an administrator on ${this.host}, so Paperboard Server can't be set up to start with it. Install it there, then pair it with its code.`);
            }
            result = await remote.run(this.crane(remote, binary, "install-service --system"));
        } else if (root) {
            // root has no session of its own to live in, so a system service
            // that starts at boot; it runs as root because root is who signed
            // in, and every panel then runs as root too (the docs say so)
            result = await remote.run(this.crane(remote, binary, "install-service --system --run-as root"));
        } else if (remote.os === "macos" && this.password !== undefined) {
            // a LaunchAgent needs the account signed in at the desktop; with
            // the password, a LaunchDaemon runs it at boot as this account
            result = await remote.run(sudo(this.crane(remote, binary, "install-service --system")), `${this.password}\n`);
        } else {
            result = await remote.run(this.crane(remote, binary, "install-service"));
        }
        if (result.code !== 0) throw new SetupStopped(`Paperboard Server didn't start on ${this.host}: ${said(result)}`);
        if (remote.os === "linux" && !root) await this.keepRunningAfterSignOut(remote, sudo);
    }

    // a user service stops when the account's last session ends, unless lingering is on
    private async keepRunningAfterSignOut(remote: Remote, sudo: (command: string) => string): Promise<void> {
        const linger = await remote.run(`loginctl show-user "$(id -un)" -p Linger --value`);
        if (linger.code === 0 && linger.stdout.trim() === "yes") return;
        const enabled = await remote.run(`loginctl enable-linger "$(id -un)"`);
        if (enabled.code === 0) return;
        if (this.password !== undefined) {
            const elevated = await remote.run(sudo(`loginctl enable-linger "$(id -un)"`), `${this.password}\n`);
            if (elevated.code === 0) return;
        }
        this.notice = `Paperboard Server stops when you sign out of ${this.host}. To keep it running, run "sudo loginctl enable-linger $USER" there.`;
    }

    private async pairOver(remote: Remote, binary: string, session: SshSession): Promise<{ id: string; name: string }> {
        const command = this.crane(remote, binary, "pair --json");
        let pairing: PairingLine | null = null;
        let opened!: (line: PairingLine) => void;
        const first = new Promise<PairingLine>((resolve) => {
            opened = resolve;
        });
        // its stdin stays open: closing the channel (or losing the
        // connection) ends it, and pair --json then closes pairing there
        const stream = session.stream(remote.os === "windows" ? encodedPowerShell(command) : `sh -c ${sh(command)}`, (line) => {
            if (pairing || !line.startsWith("{")) return;
            pairing = parsePairingLine(line);
            opened(pairing);
        });
        this.stopPairing = stream.cancel;
        // ending before its line is an answer too, said in its own words
        const ended = stream.done.then((result) => {
            if (pairing) return pairing;
            throw new SetupStopped(`Pairing didn't open on ${this.host}: ${said(result)}`);
        });
        const { code, listen, fingerprint } = await Promise.race([first, ended]);
        // quiet: once the code is out, the pairing itself says whether it worked
        ended.catch(() => undefined);
        this.check();
        // a daemon on every address is reached where SSH reached it
        const host = listen.host === "0.0.0.0" || listen.host === "::" ? session.host : listen.host;
        const paired = await this.deps.pair(host, listen.port, code, { fingerprint });
        return { id: paired.id, name: paired.name };
    }

    // ── state ──

    private check(): void {
        if (this.cancelled) throw new Cancelled();
    }

    private set(patch: Partial<ComputerSetupState>): void {
        this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
        if (!this.cancelled) this.deps.changed(this.state);
    }

    private step(id: SetupStepId, patch: Partial<SetupStep>): void {
        this.check();
        this.set({ steps: this.state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
    }

    private begin(id: SetupStepId): void {
        if (this.state.steps.find((s) => s.id === id)!.status === "success") return;
        this.step(id, { status: "loading", label: STEP_LABELS[id].doing });
    }

    private progress(id: SetupStepId, percent: number | undefined, label: string): void {
        this.step(id, { status: "loading", label, ...(percent === undefined ? {} : { percent }) });
    }

    private done(id: SetupStepId, label: string): void {
        this.step(id, { status: "success", label, percent: 100 });
    }

    private skip(id: SetupStepId, label: string): void {
        this.step(id, { status: "success", label });
    }

    private failRunning(): void {
        this.set({ steps: this.state.steps.map((s) => (s.status === "loading" ? { ...s, status: "error" } : s)) });
    }

    private finish(result: NonNullable<ComputerSetupState["result"]>): void {
        this.set({ signIn: null, result });
    }
}

/** the one setup under way; a new one cancels it */
export class ComputerSetups {
    private job: ComputerSetupJob | null = null;

    constructor(private readonly deps: () => ComputerSetupDeps) {}

    /** starts a setup, answering with where it stands: it may have pushed already */
    start(host: string): ComputerSetupState {
        this.job?.cancel();
        const job = new ComputerSetupJob(crypto.randomUUID(), host, this.deps());
        this.job = job;
        void job.run();
        return job.current();
    }

    signIn(jobId: string, username: string, password: string): void {
        this.find(jobId).signIn(username, password);
    }

    cancel(jobId: string): void {
        if (this.job?.id !== jobId) return;
        this.job.cancel();
        this.job = null;
    }

    private find(jobId: string): ComputerSetupJob {
        if (this.job?.id !== jobId) throw new Error("This setup was replaced or cancelled.");
        return this.job;
    }
}

export const defaultTempDir = () => os.tmpdir();
