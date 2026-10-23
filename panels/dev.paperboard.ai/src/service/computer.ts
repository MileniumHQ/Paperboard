// The agent's computer: a Debian VM under QEMU that the service owns.
//
// QEMU is a daemon-supervised child (processApi), so its lifetime is observed
// through the daemon, not guessed: start waits for the guest agent to answer
// /health, stop waits for the exit event. The guest agent listens on a
// loopback port QEMU forwards and wants a bearer token, kept in the vault.
// The record (installed, budget, port) lets a restarted service find a VM
// that outlived it instead of starting a second one on the same disk.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
    PANEL_ID,
    SETUP_STEPS,
    type ComputerBudget,
    type ComputerPhase,
    type ComputerState,
    type SetupStep,
    type SetupStepId,
} from "../contract";
import type { ToolResult } from "./computerMcp";
import { which } from "./which";
import { BASE_IMAGE, BROWSER_DEB, GUEST_FILES, GUEST_PORT, META_DATA, userData } from "./guest";

export const COMPUTER_PROC_ID = `${PANEL_ID}.computer`;
export const TOKEN_SECRET = "computer-token";
const RECORD_FILE = "computer.json";
const DISK_FILE = "disk.qcow2";

const FIRST_BOOT_MS = 25 * 60_000; // packages and the browser install on first boot
const BOOT_MS = 3 * 60_000;
const HEALTH_POLL_MS = 2_000;
const STOP_GRACE_MS = 2_000; // the daemon gives the whole service 3 s to stop
const CALL_TIMEOUT_MS = 11 * 60_000; // a little past the guest's longest shell command
const MAX_CALLS = 4;

/** A daemon-supervised child (processApi.start). */
export interface StartOptions {
    id: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export interface ComputerHost {
    start(o: StartOptions): Promise<unknown>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onExit(id: string, cb: (code?: number) => void): () => void;
    onStderr(id: string, cb: (data: string) => void): () => void;
    exec(command: string, args: string[], o?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    /** into the panel's storage; resolves once the bytes match sha256 */
    download(o: { url: string; targetPath: string; sha256: string; onProgress?: (percent: number) => void }): Promise<unknown>;
    getSecret(name: string): Promise<string | null>;
    setSecret(name: string, value: string): Promise<void>;
}

export type Support = { ok: true; qemu: string; qemuImg: string } | { ok: false; reason: string };

interface ComputerRecord {
    version: 1;
    installed: boolean;
    budget: ComputerBudget | null;
    /** the loopback port of the running VM, so a restarted service can find it */
    port: number | null;
}

export interface ComputerDeps {
    host: ComputerHost;
    /** absolute path of the computer's folder in the panel's storage */
    dir: string;
    /** the same folder relative to the panel's storage, for downloads */
    storagePath: string;
    support?: () => Support;
    onState: (s: ComputerState) => void;
    firstBootMs?: number;
    bootMs?: number;
}

export class Computer {
    state: ComputerState = { phase: "none", installed: false, budget: null, steps: [], error: null };
    private record: ComputerRecord = { version: 1, installed: false, budget: null, port: null };
    private token: string | null = null;
    private busy: Promise<unknown> = Promise.resolve();
    private exitWaiters = new Set<(code?: number) => void>();
    private offExit: (() => void) | null = null;
    private offStderr: (() => void) | null = null;
    private stderrTail = "";
    private running = false; // QEMU is up, as far as the daemon has told us
    private stopping = false;
    private abort: AbortController | null = null;
    private calls = 0;
    private callQueue: (() => void)[] = [];

    constructor(private deps: ComputerDeps) {}

    // ------------------------------------------------------------- lifecycle

    async init(): Promise<void> {
        fs.mkdirSync(this.deps.dir, { recursive: true });
        this.record = this.readRecord();
        // one exit subscription for the life of the service: every start's waiters hang off it
        this.offExit = this.deps.host.onExit(COMPUTER_PROC_ID, (code) => this.onExited(code));
        this.offStderr = this.deps.host.onStderr(COMPUTER_PROC_ID, (data) => {
            this.stderrTail = (this.stderrTail + data).slice(-2000);
        });
        const support = this.support();
        if (!this.record.installed) {
            this.set({ phase: support.ok ? "none" : "unsupported", budget: null, steps: [], error: support.ok ? null : support.reason });
            return;
        }
        this.set({ phase: "stopped", budget: this.record.budget, steps: [], error: null });
        if (!support.ok) {
            this.set({ phase: "unsupported", error: support.reason });
            return;
        }
        // a VM the last service generation left running is found, not doubled
        if ((await this.deps.host.exists(COMPUTER_PROC_ID)) && this.record.port) {
            this.running = true;
            this.token = await this.deps.host.getSecret(TOKEN_SECRET);
            if (this.token && (await this.healthy(this.record.port))) {
                this.set({ phase: "ready" });
                return;
            }
            await this.kill();
        }
        await this.start();
    }

    /** Set it up from nothing: download, make the disk, first boot. */
    install(budget: ComputerBudget): Promise<void> {
        return this.exclusive(() => this.doInstall(budget));
    }

    start(): Promise<void> {
        return this.exclusive(() => this.doStart());
    }

    stop(): Promise<void> {
        return this.exclusive(async () => {
            await this.kill();
            this.set({ phase: this.record.installed ? "stopped" : "none" });
        });
    }

    /** The service is going away: stop the VM and observe it gone, quickly. */
    async shutdown(): Promise<void> {
        this.abort?.abort();
        await this.kill();
        this.offExit?.();
        this.offStderr?.();
    }

    // ------------------------------------------------------------- tools

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        if (this.state.phase !== "ready" || !this.record.port || !this.token) {
            const why: Partial<Record<ComputerPhase, string>> = {
                none: "You don't have a computer yet; the user can set one up from the AI panel.",
                unsupported: `This machine can't run your computer: ${this.state.error ?? "unsupported"}`,
                installing: "Your computer is still being set up.",
                starting: "Your computer is still starting up; try again in a moment.",
            };
            return { isError: true, text: why[this.state.phase] ?? "Your computer is off right now." };
        }
        await this.slot();
        try {
            const r = await fetch(`http://127.0.0.1:${this.record.port}/call`, {
                method: "POST",
                headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tool: name, args }),
                signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            });
            const body = (await r.json()) as { text?: string; image?: string; error?: string };
            if (!r.ok || body.error) return { isError: true, text: body.error ?? `your computer answered ${r.status}` };
            return { text: body.text ?? "", image: body.image };
        } catch (e) {
            return { isError: true, text: `Your computer didn't answer: ${e instanceof Error ? e.message : String(e)}` };
        } finally {
            this.release();
        }
    }

    // ------------------------------------------------------------- install

    private async doInstall(budget: ComputerBudget): Promise<void> {
        const support = this.support();
        if (!support.ok) {
            this.set({ phase: "unsupported", error: support.reason });
            throw new Error(support.reason);
        }
        await this.kill();
        const steps: SetupStep[] = SETUP_STEPS.map((id) => ({ id, status: "waiting", percent: null }));
        this.set({ phase: "installing", budget, steps, error: null });
        this.record = { version: 1, installed: false, budget, port: null };
        this.writeRecord();
        const abort = (this.abort = new AbortController());
        let seed: Server | null = null;
        let step: SetupStepId = "image";
        try {
            step = "image";
            await this.fetchPinned("image", BASE_IMAGE);
            step = "browser";
            await this.fetchPinned("browser", BROWSER_DEB);

            step = "disk";
            this.step("disk", "running");
            fs.rmSync(path.join(this.deps.dir, DISK_FILE), { force: true }); // a fresh install starts from a fresh disk
            const made = await this.deps.host.exec(
                support.qemuImg,
                ["create", "-q", "-f", "qcow2", "-F", "qcow2", "-b", path.join(this.deps.dir, BASE_IMAGE.file), path.join(this.deps.dir, DISK_FILE), `${budget.diskGb}G`],
                { timeoutMs: 60_000 },
            );
            if (made.exitCode !== 0) throw new Error(`qemu-img couldn't make the disk: ${made.stderr.trim().slice(0, 300)}`);
            this.step("disk", "done", 100);

            step = "boot";
            this.step("boot", "running");
            const token = randomBytes(32).toString("hex");
            await this.deps.host.setSecret(TOKEN_SECRET, token);
            this.token = token;
            const seeded = await startSeed(this.deps.dir, token, () => {
                if (this.state.steps.find((s) => s.id === "boot")?.status === "running") {
                    this.step("boot", "done", 100);
                    this.step("install", "running");
                    step = "install";
                }
            });
            seed = seeded.server;
            await this.boot(support.qemu, budget, seeded.url);
            await this.waitHealthy(this.deps.firstBootMs ?? FIRST_BOOT_MS, abort.signal);
            this.step("install", "done", 100);
            this.record = { ...this.record, installed: true };
            this.writeRecord();
            this.set({ phase: "ready" });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.step(step, "failed");
            await this.kill();
            this.set({ phase: "failed", error: message });
            throw e;
        } finally {
            seed?.closeAllConnections();
            seed?.close();
            if (this.abort === abort) this.abort = null;
        }
    }

    private async fetchPinned(id: SetupStepId, file: { url: string; sha256: string; file: string }) {
        const ok = path.join(this.deps.dir, `${file.file}.sha256`);
        // verified bytes from an earlier install are reused; the marker is written only after verification
        if (fs.existsSync(path.join(this.deps.dir, file.file)) && readText(ok) === file.sha256) {
            this.step(id, "done", 100);
            return;
        }
        this.step(id, "running", 0);
        await this.deps.host.download({
            url: file.url,
            targetPath: `${this.deps.storagePath}/${file.file}`,
            sha256: file.sha256,
            onProgress: (percent) => this.step(id, "running", percent),
        });
        fs.writeFileSync(ok, file.sha256);
        this.step(id, "done", 100);
    }

    // ------------------------------------------------------------- boot

    private async doStart(): Promise<void> {
        if (!this.record.installed) throw new Error("Set up the computer first.");
        const support = this.support();
        if (!support.ok) {
            this.set({ phase: "unsupported", error: support.reason });
            throw new Error(support.reason);
        }
        if (this.running && this.record.port && (await this.healthy(this.record.port))) {
            this.set({ phase: "ready", error: null });
            return;
        }
        await this.kill();
        this.token = await this.deps.host.getSecret(TOKEN_SECRET);
        if (!this.token) {
            this.set({ phase: "failed", error: "The computer's key is missing from the vault; set it up again." });
            throw new Error(this.state.error!);
        }
        this.set({ phase: "starting", error: null });
        const abort = (this.abort = new AbortController());
        try {
            await this.boot(support.qemu, this.record.budget ?? { memoryGb: 4, diskGb: 32 }, null);
            await this.waitHealthy(this.deps.bootMs ?? BOOT_MS, abort.signal);
            this.set({ phase: "ready" });
        } catch (e) {
            await this.kill();
            this.set({ phase: "failed", error: e instanceof Error ? e.message : String(e) });
            throw e;
        } finally {
            if (this.abort === abort) this.abort = null;
        }
    }

    private async boot(qemu: string, budget: ComputerBudget, seedUrl: string | null) {
        const port = await freePort();
        this.record = { ...this.record, port };
        this.writeRecord();
        this.stderrTail = "";
        this.running = true;
        this.stopping = false;
        await this.deps.host.start({ id: COMPUTER_PROC_ID, command: qemu, args: qemuArgs(this.deps.dir, budget, port, seedUrl) });
    }

    private async waitHealthy(timeoutMs: number, signal: AbortSignal) {
        const deadline = Date.now() + timeoutMs;
        let last = "no answer yet";
        while (Date.now() < deadline) {
            if (signal.aborted) throw new Error("stopped");
            if (!this.running) throw new Error(`the computer shut down while starting${this.stderrTail ? `: ${this.stderrTail.trim().slice(-300)}` : ""}`);
            const r = await this.health(this.record.port!);
            if (r === true) return;
            last = r;
            await sleep(HEALTH_POLL_MS, signal);
        }
        throw new Error(`the computer didn't come up in ${Math.round(timeoutMs / 60_000)} min (${last}); see ${path.join(this.deps.dir, "console.log")}`);
    }

    private async healthy(port: number) {
        return (await this.health(port)) === true;
    }

    /** true, or why not */
    private async health(port: number): Promise<true | string> {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/health`, {
                headers: { Authorization: `Bearer ${this.token}` },
                signal: AbortSignal.timeout(2000),
            });
            return r.ok ? true : `health answered ${r.status}`;
        } catch (e) {
            return e instanceof Error ? e.message : String(e); // still booting: the caller polls until its deadline
        }
    }

    /** Stop QEMU if it runs, and wait for the daemon to report it gone. */
    private async kill() {
        if (!(await this.deps.host.exists(COMPUTER_PROC_ID))) {
            this.running = false;
            return;
        }
        this.stopping = true;
        const gone = new Promise<void>((ok) => this.exitWaiters.add(() => ok()));
        await this.deps.host.kill(COMPUTER_PROC_ID, "SIGTERM");
        if (!(await within(gone, STOP_GRACE_MS))) {
            await this.deps.host.kill(COMPUTER_PROC_ID, "SIGKILL");
            if (!(await within(gone, STOP_GRACE_MS))) throw new Error("the computer didn't stop");
        }
        this.record = { ...this.record, port: null };
        this.writeRecord();
    }

    private onExited(code?: number) {
        const expected = this.stopping;
        this.running = false;
        this.stopping = false;
        for (const w of this.exitWaiters) w(code);
        this.exitWaiters.clear();
        if (!expected && this.state.phase === "ready") {
            this.set({ phase: "failed", error: `the computer stopped unexpectedly (exit ${code ?? "?"})${this.stderrTail ? `: ${this.stderrTail.trim().slice(-300)}` : ""}` });
        }
    }

    // ------------------------------------------------------------- plumbing

    private support(): Support {
        return (this.deps.support ?? hostSupport)();
    }

    private exclusive<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.busy.then(fn, fn);
        this.busy = run.catch(() => undefined); // the queue continues; the caller still gets the failure
        return run;
    }

    private async slot() {
        if (this.calls < MAX_CALLS) {
            this.calls++;
            return;
        }
        await new Promise<void>((ok) => this.callQueue.push(ok));
    }

    private release() {
        const next = this.callQueue.shift();
        if (next) next();
        else this.calls--;
    }

    private set(patch: Partial<ComputerState>) {
        this.state = { ...this.state, ...patch, installed: this.record.installed };
        this.deps.onState(this.state);
    }

    private step(id: SetupStepId, status: SetupStep["status"], percent: number | null = null) {
        const cur = this.state.steps.find((s) => s.id === id);
        if (cur && cur.status === status && cur.percent === percent) return; // downloads report every chunk
        this.set({ steps: this.state.steps.map((s) => (s.id === id ? { ...s, status, percent } : s)) });
    }

    private readRecord(): ComputerRecord {
        const file = path.join(this.deps.dir, RECORD_FILE);
        if (!fs.existsSync(file)) return { version: 1, installed: false, budget: null, port: null };
        // unreadable is not "never installed": refuse rather than set up over it
        const r = JSON.parse(fs.readFileSync(file, "utf8")) as ComputerRecord;
        if (r.version !== 1) throw new Error(`${file} is from a newer version (${r.version})`);
        return r;
    }

    private writeRecord() {
        const file = path.join(this.deps.dir, RECORD_FILE);
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.record));
        fs.renameSync(`${file}.tmp`, file);
    }
}

// ------------------------------------------------------------- host

export function qemuArgs(dir: string, budget: ComputerBudget, port: number, seedUrl: string | null): string[] {
    return [
        "-machine", "q35,accel=kvm",
        "-cpu", "host",
        "-smp", String(Math.max(1, Math.min(4, os.cpus().length))),
        "-m", String(budget.memoryGb * 1024),
        "-drive", `if=virtio,file=${path.join(dir, DISK_FILE)},format=qcow2,discard=unmap`,
        "-netdev", `user,id=n0,hostfwd=tcp:127.0.0.1:${port}-:${GUEST_PORT}`,
        "-device", "virtio-net-pci,netdev=n0",
        "-device", "virtio-balloon",
        "-display", "none",
        "-monitor", "none",
        "-serial", `file:${path.join(dir, "console.log")}`,
        ...(seedUrl ? ["-smbios", `type=1,serial=ds=nocloud;s=${seedUrl}`] : []),
    ];
}

/** Can this machine run the computer? Linux with KVM and QEMU, for now. */
export function hostSupport(): Support {
    if (process.platform !== "linux") return { ok: false, reason: "the agent's computer runs on Linux for now; macOS and Windows are coming." };
    if (process.arch !== "x64") return { ok: false, reason: "the agent's computer needs an x86-64 processor for now." };
    const qemu = which("qemu-system-x86_64");
    const qemuImg = which("qemu-img");
    if (!qemu || !qemuImg) return { ok: false, reason: "QEMU isn't installed (qemu-system-x86_64 and qemu-img)." };
    try {
        fs.accessSync("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK);
    } catch (e) {
        return { ok: false, reason: `hardware virtualization isn't usable (/dev/kvm: ${(e as NodeJS.ErrnoException).code ?? e}). Is your user in the kvm group?` };
    }
    return { ok: true, qemu, qemuImg };
}

/** The first-boot seed: cloud-init's NoCloud source plus the files it fetches. Loopback only. */
async function startSeed(dir: string, token: string, onUserData: () => void): Promise<{ server: Server; url: string }> {
    let url = "";
    const server = createServer((req, res) => {
        const p = (req.url ?? "").split("?")[0];
        const send = (body: string) => res.writeHead(200, { "Content-Type": "text/plain" }).end(body);
        if (p === "/user-data") {
            onUserData();
            return send(userData(url.replace(/\/$/, ""), token));
        }
        if (p === "/meta-data") return send(META_DATA);
        if (p === "/vendor-data") return send("");
        if (p === "/agent.py" || p === "/session.sh") return send(GUEST_FILES[p.slice(1) as keyof typeof GUEST_FILES]);
        if (p === "/helium.deb") {
            res.writeHead(200, { "Content-Type": "application/octet-stream" });
            fs.createReadStream(path.join(dir, BROWSER_DEB.file)).on("error", () => res.destroy()).pipe(res);
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise<void>((ok, fail) => {
        server.once("error", fail);
        server.listen(0, "127.0.0.1", () => ok());
    });
    // the guest sees the host's loopback as 10.0.2.2
    url = `http://10.0.2.2:${(server.address() as AddressInfo).port}/`;
    return { server, url };
}

function freePort(): Promise<number> {
    return new Promise((ok, fail) => {
        const s = createServer();
        s.once("error", fail);
        s.listen(0, "127.0.0.1", () => {
            const port = (s.address() as AddressInfo).port;
            s.close(() => ok(port));
        });
    });
}

function readText(file: string): string | null {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
}

function within(p: Promise<void>, ms: number): Promise<boolean> {
    let t: ReturnType<typeof setTimeout>;
    return Promise.race([p.then(() => true), new Promise<boolean>((ok) => (t = setTimeout(() => ok(false), ms)))]).finally(() => clearTimeout(t));
}

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((ok) => {
        const done = () => {
            clearTimeout(t);
            signal.removeEventListener("abort", done);
            ok();
        };
        const t = setTimeout(done, ms);
        signal.addEventListener("abort", done);
    });
}
