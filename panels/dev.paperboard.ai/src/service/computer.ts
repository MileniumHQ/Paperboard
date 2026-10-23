// The agent's computer: a Debian VM under QEMU that the service owns.
//
// QEMU is a daemon-supervised child (processApi), so its lifetime is observed
// through the daemon, not guessed: start waits for the guest agent to answer
// /health, stop waits for the exit event. The guest agent listens on a
// loopback port forwarded to it and wants a bearer token, kept in the vault.
// The record (installed, budget, port) lets a restarted service find a VM
// that outlived it instead of starting a second one on the same disk.
//
// The agent has sudo in its computer, so what keeps it from this machine is
// outside the VM: its network is passt (another daemon child, one per boot),
// which gives the guest no address for the host's loopback. Only a setup boot
// uses QEMU's own network, to reach its seed there; it ends by powering off.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
    LIMITS,
    PANEL_ID,
    type SetupPartId,
    type ComputerBudget,
    type ComputerPhase,
    type ComputerState,
    type SetupStep,
    type SetupStepId,
} from "../contract";
import type { ToolResult } from "./computerMcp";
import { which } from "./which";
import { BASE_IMAGE, BROWSER_DEB, GUEST_FILES, GUEST_PORT, GUEST_VERSION, META_DATA, SUDO_MIGRATION, updateCommand, userData } from "./guest";
import { ConsoleReader, SEED_PARTS, freshSteps, progress, reach, setStep } from "./setupProgress";

export const COMPUTER_PROC_ID = `${PANEL_ID}.computer`;
export const NET_PROC_ID = `${PANEL_ID}.net`;
export const TOKEN_SECRET = "computer-token";
const RECORD_FILE = "computer.json";
const RECORD_VERSION = 2; // 2: the agent has sudo and the computer's network is passt
const DISK_FILE = "disk.qcow2";
const NET_SOCKET = "net.sock";
const SUDO_SEED_DIR = "seed-sudo";
/** where the guest sends DNS: passt passes queries to it on to the host's resolver, which may be on loopback */
const DNS_ADDRESS = "169.254.1.1";

const FIRST_BOOT_MS = 25 * 60_000; // packages and the browser install on first boot
const BOOT_MS = 3 * 60_000;
const HEALTH_POLL_MS = 2_000;
const UPDATE_MS = 2 * 60_000; // an outdated guest agent restarts its session on the new files
const POWEROFF_MS = 2 * 60_000;
const NET_READY_MS = 5_000;
const STOP_GRACE_MS = 2_000; // the daemon gives the whole service 3 s to stop
const CALL_TIMEOUT_MS = 11 * 60_000; // a little past the guest's longest shell command
const MAX_CALLS = 4;
// the user's view polls frames from every open shell; it gets its own few slots so it never starves the agent
const MAX_VIEW_CALLS = 3;
const VIEW_TIMEOUT_MS = 10_000;
/** what the guest takes in one request (its MAX_BODY is 1 MiB, base64 included) */
const GUEST_FILE_CHUNK = 512 * 1024;
/** control lasts this long past the last renewal, so a closed shell can't hold the agent off */
export const CONTROL_LEASE_MS = 20_000;
export const VIEW_TOOLS = ["view_windows", "view_frame", "view_input", "view_close", "view_sign_in"] as const;
export type ViewTool = (typeof VIEW_TOOLS)[number];

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

export type Support = { ok: true; qemu: string; qemuImg: string; passt: string } | { ok: false; reason: string };
type Supported = Extract<Support, { ok: true }>;

/** How a boot is networked: a setup boot reaches its seed on the host's loopback; every other goes through passt. */
export type BootNet = { kind: "setup"; seedUrl: string | null; seedDisk: string | null } | { kind: "passt"; socket: string };

interface ComputerRecord {
    /** 1: set up before the agent had sudo, behind a firewall in the guest */
    version: 1 | typeof RECORD_VERSION;
    installed: boolean;
    budget: ComputerBudget | null;
    /** the loopback port of the running VM, so a restarted service can find it */
    port: number | null;
}

interface GuestHealth {
    version: string | null;
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
    healthPollMs?: number;
    poweroffMs?: number;
    controlLeaseMs?: number;
}

export class Computer {
    state: ComputerState = { phase: "none", installed: false, budget: null, steps: [], error: null, userControl: false };
    private record: ComputerRecord = { version: RECORD_VERSION, installed: false, budget: null, port: null };
    private token: string | null = null;
    private busy: Promise<unknown> = Promise.resolve();
    private exitWaiters = new Set<(code?: number) => void>();
    private offExit: (() => void) | null = null;
    private offStderr: (() => void) | null = null;
    private stderrTail = "";
    private running = false; // QEMU is up, as far as the daemon has told us
    private stopping = false;
    private netWaiters = new Set<(code?: number) => void>();
    private offNet: (() => void)[] = [];
    private netTail = "";
    private netRunning = false;
    private netStopping = false;
    private abort: AbortController | null = null;
    private calls = 0;
    private callQueue: (() => void)[] = [];
    private viewCalls = 0;
    private control: ReturnType<typeof setTimeout> | null = null;

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
        this.offNet = [
            this.deps.host.onExit(NET_PROC_ID, (code) => this.onNetExited(code)),
            this.deps.host.onStderr(NET_PROC_ID, (data) => {
                this.netTail = (this.netTail + data).slice(-2000);
            }),
        ];
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
        // a VM the last service generation left running is found, not doubled; one from before sudo restarts into it
        if (this.record.version === RECORD_VERSION && this.record.port && (await this.deps.host.exists(COMPUTER_PROC_ID))) {
            this.running = true;
            this.token = await this.deps.host.getSecret(TOKEN_SECRET);
            const found = this.token ? await this.health(this.record.port) : null;
            if (found && typeof found !== "string") {
                this.set({ phase: "starting" });
                const abort = (this.abort = new AbortController());
                try {
                    await this.becomeReady(found, abort.signal);
                    return;
                } catch (e) {
                    await this.kill();
                    this.set({ phase: "failed", error: e instanceof Error ? e.message : String(e) });
                    return;
                } finally {
                    if (this.abort === abort) this.abort = null;
                }
            }
        }
        await this.kill();
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

    /** Change the memory it gets from its next start. Storage is fixed once the disk exists. */
    setBudget(budget: ComputerBudget): Promise<void> {
        return this.exclusive(async () => {
            if (!this.record.installed || !this.record.budget) throw new Error("Set up the computer first.");
            if (budget.diskGb !== this.record.budget.diskGb) throw new Error("Storage can only change by setting the computer up again.");
            this.record = { ...this.record, budget };
            this.writeRecord();
            this.set({ budget });
        });
    }

    /** The service is going away: stop the VM and observe it gone, quickly. */
    async shutdown(): Promise<void> {
        this.releaseControl();
        this.abort?.abort();
        await this.kill();
        this.offExit?.();
        this.offStderr?.();
        for (const off of this.offNet.splice(0)) off();
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
        if (this.state.userControl) {
            return { isError: true, text: "The user has taken control of your computer. Wait until they hand it back, or ask them if they need you." };
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

    // ------------------------------------------------------------- files

    /** A file from the computer's home folder, read in chunks; the guest refuses one past the size limit. */
    async getFile(file: string): Promise<{ path: string; data: Buffer }> {
        const chunks: Buffer[] = [];
        let size = -1;
        let where = file;
        for (let offset = 0; size < 0 || offset < size; ) {
            const r = await this.guestCall("file_get", { path: file, offset });
            const chunk = Buffer.from(String(r.data ?? ""), "base64");
            if (size < 0) size = Number(r.size);
            else if (Number(r.size) !== size) throw new Error(`${where} changed while it was being read`);
            if (!Number.isSafeInteger(size) || size > LIMITS.attachments.fileBytes) throw new Error(`${where} is too big to share`);
            where = String(r.path ?? file);
            if (chunk.length === 0 && offset < size) throw new Error(`${where} ended early`);
            chunks.push(chunk);
            offset += chunk.length;
        }
        return { path: where, data: Buffer.concat(chunks) };
    }

    /** Write a file in the computer's home folder, in chunks; returns where it went. */
    async putFile(file: string, data: Buffer): Promise<string> {
        let where = file;
        let offset = 0;
        do {
            const chunk = data.subarray(offset, offset + GUEST_FILE_CHUNK);
            const r = await this.guestCall("file_put", { path: file, offset, data: chunk.toString("base64") });
            where = String(r.path ?? file);
            offset += chunk.length;
        } while (offset < data.length);
        return where;
    }

    /** One of the service's own calls to the guest, with the agent's slots and refusals: what it answered, or why not. */
    private async guestCall(tool: "file_get" | "file_put", args: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (this.state.phase !== "ready" || !this.record.port || !this.token) throw new Error("Your computer isn't on.");
        if (this.state.userControl) throw new Error("The user has taken control of your computer.");
        await this.slot();
        try {
            const r = await fetch(`http://127.0.0.1:${this.record.port}/call`, {
                method: "POST",
                headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tool, args }),
                signal: AbortSignal.timeout(VIEW_TIMEOUT_MS),
            });
            const body = (await r.json()) as Record<string, unknown> & { error?: string };
            if (!r.ok || body.error) throw new Error(body.error ?? `your computer answered ${r.status}`);
            return body;
        } finally {
            this.release();
        }
    }

    // ------------------------------------------------------------- the user's view

    /** The user looking at (and, with control, using) the computer's windows. The guest validates the arguments. */
    async view(tool: ViewTool, args: Record<string, unknown>): Promise<unknown> {
        if (!VIEW_TOOLS.includes(tool)) throw new Error(`not a view: ${tool}`);
        if (tool === "view_input" && !this.state.userControl) throw new Error("Take control of the computer first.");
        if (this.state.phase !== "ready" || !this.record.port || !this.token) throw new Error("The computer isn't on.");
        if (this.viewCalls >= MAX_VIEW_CALLS) throw new Error("The computer is busy showing other views; try again.");
        this.viewCalls++;
        try {
            const r = await fetch(`http://127.0.0.1:${this.record.port}/call`, {
                method: "POST",
                headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tool, args }),
                signal: AbortSignal.timeout(VIEW_TIMEOUT_MS),
            });
            const body = (await r.json()) as { error?: string };
            if (!r.ok || body.error) throw new Error(body.error ?? `the computer answered ${r.status}`);
            return body;
        } finally {
            this.viewCalls--;
        }
    }

    /** Take control, or renew it: the agent's hands wait until it's released or the lease runs out. */
    takeControl() {
        if (this.state.phase !== "ready") throw new Error("The computer isn't on.");
        if (this.control) clearTimeout(this.control);
        this.control = setTimeout(() => this.releaseControl(), this.deps.controlLeaseMs ?? CONTROL_LEASE_MS);
        this.set({});
    }

    releaseControl() {
        if (!this.control) return;
        clearTimeout(this.control);
        this.control = null;
        this.set({});
    }

    // ------------------------------------------------------------- install

    private async doInstall(budget: ComputerBudget): Promise<void> {
        const support = this.support();
        if (!support.ok) {
            this.set({ phase: "unsupported", error: support.reason });
            throw new Error(support.reason);
        }
        await this.kill();
        this.set({ phase: "installing", budget, steps: freshSteps(), error: null });
        this.record = { version: RECORD_VERSION, installed: false, budget, port: null };
        this.writeRecord();
        const abort = (this.abort = new AbortController());
        let seed: Server | null = null;
        let stopReading: (() => void) | null = null;
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
            this.reach("power");
            const token = randomBytes(32).toString("hex");
            await this.deps.host.setSecret(TOKEN_SECRET, token);
            this.token = token;
            // what the guest fetches from its seed says how far its first boot has got
            const seeded = await startSeed(this.deps.dir, token, (p) => {
                const part = SEED_PARTS[p];
                if (part) this.reach(part);
            });
            seed = seeded.server;
            await this.boot(support, budget, { kind: "setup", seedUrl: seeded.url, seedDisk: null });
            // and what its console shows: the boot's milestones, and apt's progress through the packages
            const reader = new ConsoleReader();
            stopReading = tailFile(path.join(this.deps.dir, "console.log"), (text) => {
                for (const sign of reader.feed(text)) {
                    if ("reach" in sign) this.reach(sign.reach);
                    else this.progress(sign.progress, sign.percent);
                }
            });
            await this.waitHealthy(this.deps.firstBootMs ?? FIRST_BOOT_MS, abort.signal);
            await this.endSetupBoot(abort.signal);
            this.record = { ...this.record, installed: true };
            this.writeRecord();
            await this.boot(support, budget, null);
            const found = await this.waitHealthy(this.deps.bootMs ?? BOOT_MS, abort.signal);
            this.step("install", "done", 100);
            await this.becomeReady(found, abort.signal);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.step(this.state.steps.find((s) => s.status === "running")?.id ?? step, "failed");
            await this.kill();
            this.set({ phase: "failed", error: message });
            throw e;
        } finally {
            stopReading?.();
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
        const found = this.running && this.record.port ? await this.health(this.record.port) : null;
        if (found && typeof found !== "string") {
            this.set({ phase: "starting", error: null });
            const abort = (this.abort = new AbortController());
            try {
                await this.becomeReady(found, abort.signal);
                return;
            } catch (e) {
                await this.kill();
                this.set({ phase: "failed", error: e instanceof Error ? e.message : String(e) });
                throw e;
            } finally {
                if (this.abort === abort) this.abort = null;
            }
        }
        await this.kill();
        this.token = await this.deps.host.getSecret(TOKEN_SECRET);
        if (!this.token) {
            this.set({ phase: "failed", error: "The computer's key is missing from the vault; set it up again." });
            throw new Error(this.state.error!);
        }
        this.set({ phase: "starting", error: null });
        const abort = (this.abort = new AbortController());
        const budget = this.record.budget ?? { memoryGb: 4, diskGb: 32 };
        try {
            if (this.record.version !== RECORD_VERSION) await this.migrateToSudo(support, budget, abort.signal);
            await this.boot(support, budget, null);
            const found = await this.waitHealthy(this.deps.bootMs ?? BOOT_MS, abort.signal);
            await this.becomeReady(found, abort.signal);
        } catch (e) {
            await this.kill();
            this.set({ phase: "failed", error: e instanceof Error ? e.message : String(e) });
            throw e;
        } finally {
            if (this.abort === abort) this.abort = null;
        }
    }

    /** Boot the VM: a setup boot on QEMU's own network, any other (setup null) through a passt of its own. */
    private async boot(support: Supported, budget: ComputerBudget, setup: Extract<BootNet, { kind: "setup" }> | null) {
        const port = await freePort();
        this.record = { ...this.record, port };
        this.writeRecord();
        this.stderrTail = "";
        const net: BootNet = setup ?? { kind: "passt", socket: await this.startNet(support.passt, port) };
        this.running = true;
        this.stopping = false;
        await this.deps.host.start({ id: COMPUTER_PROC_ID, command: support.qemu, args: qemuArgs(this.deps.dir, budget, port, net) });
    }

    /** Start passt for a boot and wait (bounded) until it listens for QEMU; returns its socket. */
    private async startNet(passt: string, port: number): Promise<string> {
        const socket = path.join(this.deps.dir, NET_SOCKET);
        if (Buffer.byteLength(socket) > 107) throw new Error(`the computer's folder is too deep for its network's socket: ${socket}`);
        fs.rmSync(socket, { force: true }); // left by a passt that kill() has seen stopped
        this.netTail = "";
        this.netRunning = true;
        this.netStopping = false;
        await this.deps.host.start({ id: NET_PROC_ID, command: passt, args: passtArgs(socket, port) });
        const deadline = Date.now() + NET_READY_MS;
        while (!listening(socket)) {
            if (!this.netRunning) throw new Error(`the computer's network (passt) didn't start${this.netTail ? `: ${this.netTail.trim().slice(-300)}` : ""}`);
            if (Date.now() > deadline) throw new Error("the computer's network (passt) didn't start listening");
            await new Promise((ok) => setTimeout(ok, 20));
        }
        return socket;
    }

    /**
     * A computer set up before the agent had sudo boots once on a seed disk that gives it sudo and
     * retires its firewall, and powers off; only then is it the current version.
     */
    private async migrateToSudo(support: Supported, budget: ComputerBudget, signal: AbortSignal) {
        const seedDisk = path.join(this.deps.dir, SUDO_SEED_DIR);
        fs.rmSync(seedDisk, { recursive: true, force: true });
        fs.mkdirSync(seedDisk);
        fs.writeFileSync(path.join(seedDisk, "meta-data"), SUDO_MIGRATION.metaData);
        fs.writeFileSync(path.join(seedDisk, "user-data"), SUDO_MIGRATION.userData);
        await this.boot(support, budget, { kind: "setup", seedUrl: null, seedDisk });
        await this.waitHealthy(this.deps.bootMs ?? BOOT_MS, signal);
        await this.endSetupBoot(signal);
        fs.rmSync(seedDisk, { recursive: true, force: true });
        this.record = { ...this.record, version: RECORD_VERSION };
        this.writeRecord();
    }

    /**
     * End a setup boot: once the agent has sudo (cloud-init may still be giving it), the guest powers itself
     * off and the exit is observed. Its network reaches the host's loopback, so it's never ready on it.
     */
    private async endSetupBoot(signal: AbortSignal) {
        const deadline = Date.now() + (this.deps.bootMs ?? BOOT_MS);
        for (;;) {
            if (signal.aborted) throw new Error("stopped");
            if (!this.running) throw new Error(`the computer shut down during setup${this.stderrTail ? `: ${this.stderrTail.trim().slice(-300)}` : ""}`);
            // an agent restarting while cloud-init runs doesn't answer for a moment: that's not yet, too
            const r = await this.guestShell("sudo -n true", 30, signal).catch((e: Error) => e.message);
            if (r.startsWith("exit 0")) break;
            if (Date.now() > deadline) throw new Error(`the agent didn't get sudo: ${r.trim().slice(0, 300)}`);
            await sleep(this.deps.healthPollMs ?? HEALTH_POLL_MS, signal);
        }
        const gone = new Promise<void>((ok) => this.exitWaiters.add(() => ok()));
        // the answer may not get out before the guest goes down: the observed exit is what counts
        const asked = await this.guestShell("sudo -n systemctl poweroff", 30, signal).catch((e: Error) => e.message);
        if (!(await within(gone, this.deps.poweroffMs ?? POWEROFF_MS))) throw new Error(`the computer didn't power off after setup (${asked.trim().slice(0, 200)})`);
    }

    /** A shell command the service runs on the guest; resolves to its output (from "exit N"). */
    private async guestShell(command: string, timeout: number, signal: AbortSignal): Promise<string> {
        const r = await fetch(`http://127.0.0.1:${this.record.port}/call`, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ tool: "shell", args: { command, timeout } }),
            signal: AbortSignal.any([signal, AbortSignal.timeout((timeout + 30) * 1000)]),
        });
        const body = (await r.json()) as { text?: string; error?: string };
        if (!r.ok || body.error || typeof body.text !== "string") throw new Error(body.error ?? `it answered ${r.status}`);
        return body.text;
    }

    private async waitHealthy(timeoutMs: number, signal: AbortSignal, current = false): Promise<GuestHealth> {
        const deadline = Date.now() + timeoutMs;
        let last = "no answer yet";
        while (Date.now() < deadline) {
            if (signal.aborted) throw new Error("stopped");
            if (!this.running) throw new Error(`the computer shut down while starting${this.stderrTail ? `: ${this.stderrTail.trim().slice(-300)}` : ""}`);
            const r = await this.health(this.record.port!);
            if (typeof r !== "string" && (!current || r.version === GUEST_VERSION)) return r;
            last = typeof r === "string" ? r : "the old agent still answers";
            await sleep(this.deps.healthPollMs ?? HEALTH_POLL_MS, signal);
        }
        throw new Error(`the computer didn't come up in ${Math.round(timeoutMs / 60_000)} min (${last}); see ${path.join(this.deps.dir, "console.log")}`);
    }

    /**
     * Ready once the guest runs this service's agent. A computer set up by an
     * older version is updated in place first: its agent would refuse what this
     * one asks of it.
     */
    private async becomeReady(found: GuestHealth, signal: AbortSignal) {
        if (found.version !== GUEST_VERSION) {
            const text = await this.guestShell(updateCommand(), 60, signal).catch((e: Error) => e.message);
            if (!text.startsWith("exit 0")) throw new Error(`couldn't update the computer's agent: ${text.trim().slice(0, 300)}`);
            await this.waitHealthy(UPDATE_MS, signal, true);
        }
        this.set({ phase: "ready", error: null });
    }

    /** what the guest agent says of itself, or why it didn't answer */
    private async health(port: number): Promise<GuestHealth | string> {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/health`, {
                headers: { Authorization: `Bearer ${this.token}` },
                signal: AbortSignal.timeout(2000),
            });
            if (!r.ok) return `health answered ${r.status}`;
            const body = (await r.json()) as { version?: unknown };
            // an agent from before versions has none, and is out of date
            return { version: typeof body.version === "string" ? body.version : null };
        } catch (e) {
            return e instanceof Error ? e.message : String(e); // still booting: the caller polls until its deadline
        }
    }

    /** Stop QEMU and then its network, each if it runs, and wait for the daemon to report them gone. */
    private async kill() {
        this.stopping = true;
        if (await this.stopObserved(COMPUTER_PROC_ID, this.exitWaiters, "the computer")) {
            this.record = { ...this.record, port: null };
            this.writeRecord();
        } else {
            this.running = false;
            this.stopping = false;
        }
        this.netStopping = true;
        if (!(await this.stopObserved(NET_PROC_ID, this.netWaiters, "the computer's network"))) {
            this.netRunning = false;
            this.netStopping = false;
        }
    }

    /** false if it wasn't running */
    private async stopObserved(id: string, waiters: Set<(code?: number) => void>, what: string): Promise<boolean> {
        let exited!: () => void;
        const gone = new Promise<void>((ok) => (exited = ok));
        waiters.add(exited); // before asking, so an exit in between isn't missed
        try {
            if (!(await this.deps.host.exists(id))) return false;
            await this.deps.host.kill(id, "SIGTERM");
            if (!(await within(gone, STOP_GRACE_MS))) {
                await this.deps.host.kill(id, "SIGKILL");
                if (!(await within(gone, STOP_GRACE_MS))) throw new Error(`${what} didn't stop`);
            }
            return true;
        } finally {
            waiters.delete(exited);
        }
    }

    /** passt went away on its own: the VM can't be reached without it, so it's stopped, and the reason kept. */
    private onNetExited(code?: number) {
        const expected = this.netStopping || this.stopping || !this.running;
        this.netRunning = false;
        this.netStopping = false;
        for (const w of this.netWaiters) w(code);
        this.netWaiters.clear();
        if (expected) return;
        this.stderrTail = `its network (passt) stopped (exit ${code ?? "?"})${this.netTail ? `: ${this.netTail.trim().slice(-300)}` : ""}`;
        this.deps.host.kill(COMPUTER_PROC_ID, "SIGTERM").catch((e: Error) => this.set({ phase: "failed", error: `the computer's network stopped, and the computer couldn't be stopped: ${e.message}` }));
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
        // control is of a running computer: it ends when the computer stops being ready
        if (this.control && (patch.phase ?? this.state.phase) !== "ready") {
            clearTimeout(this.control);
            this.control = null;
        }
        this.state = { ...this.state, ...patch, installed: this.record.installed, userControl: this.control !== null };
        this.deps.onState(this.state);
    }

    private step(id: SetupStepId, status: SetupStep["status"], percent: number | null = null) {
        const cur = this.state.steps.find((s) => s.id === id);
        if (cur && cur.status === status && cur.percent === percent) return; // downloads report every chunk
        this.set({ steps: setStep(this.state.steps, id, status, percent) });
    }

    private progress(part: SetupPartId, percent: number) {
        const steps = progress(this.state.steps, part, percent);
        if (steps !== this.state.steps) this.set({ steps });
    }

    private reach(part: SetupPartId) {
        const steps = reach(this.state.steps, part);
        if (steps !== this.state.steps) this.set({ steps });
    }

    private readRecord(): ComputerRecord {
        const file = path.join(this.deps.dir, RECORD_FILE);
        if (!fs.existsSync(file)) return { version: RECORD_VERSION, installed: false, budget: null, port: null };
        // unreadable is not "never installed": refuse rather than set up over it
        const r = JSON.parse(fs.readFileSync(file, "utf8")) as ComputerRecord;
        if (r.version !== 1 && r.version !== RECORD_VERSION) throw new Error(`${file} is from a newer version (${r.version})`);
        return r;
    }

    private writeRecord() {
        const file = path.join(this.deps.dir, RECORD_FILE);
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.record));
        fs.renameSync(`${file}.tmp`, file);
    }
}

// ------------------------------------------------------------- host

export function qemuArgs(dir: string, budget: ComputerBudget, port: number, net: BootNet): string[] {
    return [
        "-machine", "q35,accel=kvm",
        "-cpu", "host",
        "-smp", String(Math.max(1, Math.min(4, os.cpus().length))),
        "-m", String(budget.memoryGb * 1024),
        "-drive", `if=virtio,file=${path.join(dir, DISK_FILE)},format=qcow2,discard=unmap`,
        "-netdev",
        net.kind === "passt" ? `stream,id=n0,server=off,addr.type=unix,addr.path=${net.socket}` : `user,id=n0,hostfwd=tcp:127.0.0.1:${port}-:${GUEST_PORT}`,
        "-device", "virtio-net-pci,netdev=n0",
        "-device", "virtio-balloon",
        "-display", "none",
        "-monitor", "none",
        "-serial", `file:${path.join(dir, "console.log")}`,
        ...(net.kind === "setup" && net.seedUrl ? ["-smbios", `type=1,serial=ds=nocloud;s=${net.seedUrl}`] : []),
        // cloud-init's NoCloud seed as a disk: a read-only FAT view of the folder, labelled as it looks for
        ...(net.kind === "setup" && net.seedDisk ? ["-drive", `if=virtio,format=raw,readonly=on,file.driver=vvfat,file.dir=${net.seedDisk},file.label=cidata`] : []),
    ];
}

/**
 * passt for one boot: the agent's port forwarded from loopback, DNS passed to the host's resolver, and no
 * address in the guest for the host itself (--no-map-gw), so the agent never reaches this machine's loopback.
 */
export function passtArgs(socket: string, port: number): string[] {
    return ["--foreground", "--one-off", "--socket", socket, "--no-map-gw", "--dns-forward", DNS_ADDRESS, "-t", `127.0.0.1/${port}:${GUEST_PORT}`, "-u", "none"];
}

/** Is a unix socket at this path listening (Linux's /proc/net/unix: flag 0x10000 is a listener)? */
function listening(socket: string): boolean {
    return fs
        .readFileSync("/proc/net/unix", "utf8")
        .split("\n")
        .some((line) => line.endsWith(` ${socket}`) && (parseInt(line.trim().split(/\s+/)[3] ?? "0", 16) & 0x10000) !== 0);
}

/** Can this machine run the computer? Linux with KVM and QEMU, for now. */
export function hostSupport(): Support {
    if (process.platform !== "linux") return { ok: false, reason: "the agent's computer runs on Linux for now; macOS and Windows are coming." };
    if (process.arch !== "x64") return { ok: false, reason: "the agent's computer needs an x86-64 processor for now." };
    const qemu = which("qemu-system-x86_64");
    const qemuImg = which("qemu-img");
    if (!qemu || !qemuImg) return { ok: false, reason: "QEMU isn't installed (qemu-system-x86_64 and qemu-img)." };
    const passt = which("passt");
    if (!passt) return { ok: false, reason: "passt isn't installed; it's the computer's network (the passt package)." };
    try {
        fs.accessSync("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK);
    } catch (e) {
        return { ok: false, reason: `hardware virtualization isn't usable (/dev/kvm: ${(e as NodeJS.ErrnoException).code ?? e}). Is your user in the kvm group?` };
    }
    return { ok: true, qemu, qemuImg, passt };
}

/** The first-boot seed: cloud-init's NoCloud source plus the files it fetches. Loopback only. */
async function startSeed(dir: string, token: string, onFetch: (path: string) => void): Promise<{ server: Server; url: string }> {
    let url = "";
    const server = createServer((req, res) => {
        const p = (req.url ?? "").split("?")[0] ?? "";
        const send = (body: string) => res.writeHead(200, { "Content-Type": "text/plain" }).end(body);
        onFetch(p);
        if (p === "/user-data") return send(userData(url.replace(/\/$/, ""), token));
        if (p === "/progress/browser") return res.writeHead(204).end();
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

/**
 * Follow a file another process appends to (QEMU's serial console): new text goes to onText, read in bounded
 * chunks on a timer. Returns the stop; the timer never outlives it.
 */
export function tailFile(file: string, onText: (text: string) => void, everyMs = 500): () => void {
    const CHUNK = 256 * 1024;
    let offset = 0;
    const buf = Buffer.alloc(CHUNK);
    const decoder = new TextDecoder();
    const timer = setInterval(() => {
        if (!fs.existsSync(file)) return; // QEMU hasn't made it yet
        let fd: number;
        try {
            fd = fs.openSync(file, "r");
        } catch (e) {
            // progress is a display: an unreadable console costs the detail, never the install
            console.error("[ai] couldn't read the computer's console:", (e as Error).message);
            return;
        }
        try {
            // at most a few chunks a tick, so a flood can't hold the service
            for (let i = 0; i < 4; i++) {
                const n = fs.readSync(fd, buf, 0, CHUNK, offset);
                if (n <= 0) break;
                offset += n;
                onText(decoder.decode(buf.subarray(0, n), { stream: true }));
            }
        } finally {
            fs.closeSync(fd);
        }
    }, everyMs);
    return () => clearInterval(timer);
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
