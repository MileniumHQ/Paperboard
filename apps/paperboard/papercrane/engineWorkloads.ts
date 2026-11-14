// The supervised workloads (terminals and processes): starting, streaming,
// writing to and stopping them, which panel owns each one, and adopting the
// ones a previous daemon left running
import path from "path";
import fs from "fs";
import os from "os";
import {
    SupervisedProcessClient,
    supervisorPresent,
    supervisorEndpointName,
    type InputEncoding,
} from "./supervisor";
import { readStateFileSync, writeJsonAtomicSync, LimitError } from "./storage";
import { getSocketsDir } from "./paths";
import { logger } from "./logger";
import { stopMountHolder } from "./supervisorLaunch";
import { spawnSupervisedClient } from "./engineSupervisor";
import { defaultTerminalShell, requireOfferedShell, shellLaunch, type ShellCommand } from "./shellIntegration";
import { RpcError } from "./rpc/errors";
import { ErrorCode } from "./protocol";
import { requirePanelId } from "../../../packages/paperapi/src/panelIdentity";
import type { MonitorLifecycle } from "../../../packages/paperapi/src/monitorProtocol";

type StreamListeners = Record<string, ((...args: any[]) => void) | undefined>;
/** what a terminal tells its listeners; see SupervisedProcessClient's events */
export interface TerminalStreams {
    data?: (data: string) => void;
    exit?: (exitCode: number | null) => void;
    /** the program in front of the terminal changed */
    foreground?: (name: string) => void;
    /** a command the shell ran has ended */
    command?: (finished: ShellCommand) => void;
    /** the shell changed folder */
    cwd?: (cwd: string) => void;
}
/** what a supervisor's metadata file says about the workload it runs */
type SupervisorMeta = { config: { command?: unknown; noStdin?: unknown; important?: unknown }; startedAt?: unknown };
type StreamClient = { on: (event: string, fn: any) => unknown; off: (event: string, fn: any) => unknown };

/** a live workload, as the runtime packages see it */
export interface WorkloadUse {
    processId: string;
    owner: string | null;
    // holds: the workload is important or long running (holdsUpdates);
    // the others are stopped for an update without asking
    holds: boolean;
}

/** what the runtime packages do around a workload's life */
export interface WorkloadRuntime {
    /** before a process starts from `command`: its runtime's staged update lands, and a runtime being replaced refuses */
    beforeStart(id: string, command: string): Promise<void>;
    /** refuses a command whose runtime is being replaced right now */
    requireNotReplacing(command: string): void;
    /** a workload is gone: its runtime may now be free to update */
    ended(): void;
}

// a workload running this long is something people rely on: it holds an
// update of what it runs from, like one started as important
const LONG_RUNNING_MS = 10 * 60_000;

export class WorkloadRegistry {
    private clients = new Map<string, SupervisedProcessClient>();
    // the command each live workload runs, which says which runtime package
    // it holds. Missing or null means unknown, which blocks every swap.
    private clientCommands = new Map<string, string | null>();
    // workloads started with their input closed; a write to one is refused, not dropped
    private inputless = new Set<string>();
    // when each live workload started, and the ones started as important:
    // these hold an update of what they run from (holdsUpdates)
    private clientStarts = new Map<string, number>();
    private importantClients = new Set<string>();
    // supervisors that outlived the previous daemon are users too: no swap
    // decides before they are adopted
    private recovery: Promise<void> = Promise.resolve();
    private readonly lifecycleListeners = new Set<(change: MonitorLifecycle) => void>();

    constructor(private localDir: string, private runtime: WorkloadRuntime) {
        // a damaged ledger is set aside like every state file: its workloads
        // are then the host's alone, never a panel's by a guess
        const owners = readStateFileSync<Record<string, string | null>>(path.join(this.localDir, "process-owners.json"), {}, "workload ownership ledger");
        this.clientOwners = new Map(Object.entries(owners ?? {}));
    }

    /** settles once the supervisors a previous daemon left running are adopted */
    public adopted(): Promise<void> {
        return this.recovery;
    }

    /** Live workloads whose command `uses` says runs from something. */
    public users(uses: (command: string | null) => boolean): WorkloadUse[] {
        const found: WorkloadUse[] = [];
        for (const id of this.clients.keys()) {
            if (uses(this.clientCommands.get(id) ?? null)) {
                found.push({ processId: id, owner: this.clientOwners.get(id) ?? null, holds: this.holdsUpdates(id) });
            }
        }
        return found;
    }

    /** Stops one live workload and waits for it to exit; nothing when it is not running. */
    public async stop(id: string, signal = "SIGTERM", graceMs?: number): Promise<void> {
        const client = this.clients.get(id);
        if (client) await this.stopOwnedClient(id, client, signal, graceMs);
    }

    /** Stops every live workload the panel started and waits for each to exit. */
    public async stopPanelWorkloads(panelId: string): Promise<void> {
        for (const [id, client] of [...this.clients]) {
            if (this.clientOwners.get(id) === panelId) await this.stopOwnedClient(id, client);
        }
    }

    // Shared spawn cwd: explicit cwd wins, else home, else process cwd.
    private resolveSpawnCwd(cwd?: string): string {
        if (cwd) {
            const resolved = path.resolve(cwd);
            // explicit but missing cwd must fail, never fall back silently
            if (!fs.existsSync(resolved)) {
                throw new Error(`spawn cwd does not exist: ${resolved}`);
            }
            return resolved;
        }
        return typeof os.homedir === "function" ? os.homedir() : process.cwd();
    }

    // Stream subscriptions, keyed by workload id and then by subscriber (an
    // RPC socket). Every subscriber gets every chunk. Subscribing again
    // replaces that subscriber's own listeners, so a creator that also
    // attaches is not handed each chunk twice, and no subscriber takes the
    // stream from another. A subscription outlives the process it was made
    // against: a shell that exits and starts again under the same id, or one
    // subscribed to before it started, streams to everyone subscribed, until
    // the socket closes.
    private streamSubscriptions = new Map<string, Map<object, StreamListeners>>();
    private streamSubscriptionCount = 0;
    // what each live client currently has wired, so a replacement can be undone
    private wiredStreams = new WeakMap<object, Map<object, StreamListeners>>();

    private subscribeStreams(id: string, subscriber: object, listeners: StreamListeners): void {
        let bySubscriber = this.streamSubscriptions.get(id);
        if (!bySubscriber?.has(subscriber)) {
            if (this.streamSubscriptionCount >= 10_000) throw new LimitError("Too many stream subscriptions");
            this.streamSubscriptionCount++;
        }
        if (!bySubscriber) {
            bySubscriber = new Map();
            this.streamSubscriptions.set(id, bySubscriber);
        }
        bySubscriber.set(subscriber, listeners);
        const client = this.clients.get(id);
        if (client) this.wireStreams(id, client);
    }

    // brings a client's listeners in line with the subscriptions for its id
    private wireStreams(id: string, client: StreamClient): void {
        let wired = this.wiredStreams.get(client);
        if (!wired) {
            wired = new Map();
            this.wiredStreams.set(client, wired);
        }
        const wanted = this.streamSubscriptions.get(id);
        for (const [subscriber, listeners] of [...wired]) {
            if (wanted?.get(subscriber) === listeners) continue;
            for (const [event, fn] of Object.entries(listeners)) {
                if (fn) client.off(event, fn);
            }
            wired.delete(subscriber);
        }
        for (const [subscriber, listeners] of wanted ?? []) {
            if (wired.has(subscriber)) continue;
            for (const [event, fn] of Object.entries(listeners)) {
                if (fn) client.on(event, fn);
            }
            wired.set(subscriber, listeners);
        }
    }

    // a closed socket stops receiving: its subscriptions leave every workload
    public detachStreams(subscriber: object): void {
        for (const [id, bySubscriber] of [...this.streamSubscriptions]) {
            if (!bySubscriber.delete(subscriber)) continue;
            this.streamSubscriptionCount--;
            if (bySubscriber.size === 0) this.streamSubscriptions.delete(id);
            const client = this.clients.get(id);
            if (client) this.wireStreams(id, client);
        }
    }

    // ownership ledger: supervised id → creating panel claim (null =
    // master/host-created or pre-ledger). One entry per live client id,
    // deleted with the client — bounded by the client map itself. The RPC
    // layer records the socket claim on create and refuses mismatches
    // (rpc/ownership.ts).
    private clientOwners = new Map<string, string | null>();

    public setClientOwner(id: string, owner: string | null): void {
        if (typeof id === "string" && id) {
            if (!this.clientOwners.has(id) && this.clientOwners.size >= 10_000) throw new LimitError("Process ownership ledger is full");
            this.clientOwners.set(id, owner ?? null);
            writeJsonAtomicSync(path.join(this.localDir, "process-owners.json"), Object.fromEntries(this.clientOwners), { mode: 0o600 });
        }
    }

    // A reservation exists before start exposes a client. The bounded set
    // excludes overlapping starts (including host starts) so one failure
    // cannot restore the ledger over a newer claim. Both outcomes release it.
    private startingClients = new Set<string>();

    public reserveClientOwner(id: string, owner: string | null): { commit(): void; undo(): void } {
        if (this.startingClients.has(id)) throw new RpcError(ErrorCode.CONFLICT, `Process ${id} is already starting`);
        if (this.startingClients.size >= 10_000) throw new LimitError("Too many starting workloads");
        const had = this.clientOwners.has(id);
        const previous = this.clientOwners.get(id) ?? null;
        try {
            this.setClientOwner(id, owner);
        } catch (err) {
            // Atomic persistence failed; do not leave an in-memory claim for
            // a start that was never attempted.
            if (had) this.clientOwners.set(id, previous);
            else this.clientOwners.delete(id);
            throw err;
        }
        this.startingClients.add(id);
        return {
            commit: () => {
                this.startingClients.delete(id);
                // An immediate exit may already have removed the workload.
                if (!this.clients.has(id)) this.forgetClientOwner(id);
            },
            undo: () => {
                this.startingClients.delete(id);
                if (had) this.setClientOwner(id, previous);
                else this.forgetClientOwner(id);
            },
        };
    }

    // drops a finished workload's ledger entry, on disk too: an entry left
    // in process-owners.json would outlive the workload across a restart.
    // A failed write keeps the stale entry, which only over-claims (refuses
    // other panels that id) — it never grants anything — so it is logged
    // rather than thrown into the exit path that called this.
    private forgetClientOwner(id: string): void {
        // Startup still owns this id even if its child exits immediately.
        // commit/undo releases the reservation after start is observed.
        if (this.startingClients.has(id)) return;
        if (!this.clientOwners.delete(id)) return;
        try {
            writeJsonAtomicSync(path.join(this.localDir, "process-owners.json"), Object.fromEntries(this.clientOwners), { mode: 0o600 });
        } catch (err) {
            logger.error(`[engine] could not persist the end of ${id}'s ownership; the stale entry over-claims until the next write:`, err);
        }
    }

    public clientOwner(id: string): string | null {
        return this.clientOwners.get(id) ?? null;
    }

    /** Each live workload's supervisor process and the panel that created it (null: the host). */
    public workloadRoots(): Array<{ owner: string | null; pid: number }> {
        const roots: Array<{ owner: string | null; pid: number }> = [];
        for (const [id, client] of this.clients) {
            if (client.pid > 0) roots.push({ owner: this.clientOwners.get(id) ?? null, pid: client.pid });
        }
        return roots;
    }

    // one connect per id at a time: an attach that races adoption shares the
    // same socket instead of opening a second one
    private connecting = new Map<string, Promise<SupervisedProcessClient | null>>();

    // lookup with reconnect, shared by attach/isRunning
    private async getOrConnectClient(id: string): Promise<SupervisedProcessClient | null> {
        const live = this.clients.get(id);
        if (live) return live;
        // Windows supervisors listen on a named pipe, which fs cannot
        // stat: supervisorPresent keys off the metadata file there so an
        // orphaned Ollama is found and stopped instead of a second
        // supervisor racing the same pipe name.
        if (!supervisorPresent(id)) return null;
        return this.connectSupervisor(id, () => this.supervisorMeta(id));
    }

    // Connects to a supervisor that is already running and takes it on as a
    // live workload, the same way whether an attach or adoption found it:
    // its streams, what it runs, and its exit, which ends it here.
    private connectSupervisor(id: string, readMeta: () => SupervisorMeta | null): Promise<SupervisedProcessClient | null> {
        const pending = this.connecting.get(id);
        if (pending) return pending;
        const attempt = (async () => {
            const client = new SupervisedProcessClient(id);
            if (!(await client.connect())) {
                client.destroy();
                return null;
            }
            const live = this.clients.get(id);
            if (live) {
                client.destroy();
                return live;
            }
            const meta = readMeta();
            this.clients.set(id, client);
            this.wireStreams(id, client);
            this.clientCommands.set(id, typeof meta?.config.command === "string" ? meta.config.command : null);
            if (meta?.config.noStdin === true) this.inputless.add(id);
            this.rememberWorkload(id, meta?.startedAt, meta?.config.important === true);
            client.on("exit", (code: number | null) => {
                if (this.clients.get(id) !== client) return;
                this.clients.delete(id);
                this.workloadEnded(id, code);
            });
            return client;
        })().finally(() => this.connecting.delete(id));
        this.connecting.set(id, attempt);
        return attempt;
    }

    // Terminal management
    public async createTerminal(
        id: string,
        options: { cols?: number; rows?: number; cwd?: string; env?: Record<string, string>; shell?: string },
        streams: TerminalStreams,
        // the socket that receives the streams (see subscribeStreams); without
        // one, the listeners belong to this shell alone
        subscriber?: object,
    ): Promise<void> {
        const { cols = 80, rows = 24, cwd, env } = options;
        const { data: onData, exit: onExit } = streams;
        // a chosen shell must be one this computer offers; otherwise the
        // platform's own, never $SHELL as a GUI app inherited it
        const shell = options.shell ? requireOfferedShell(options.shell) : defaultTerminalShell();
        this.runtime.requireNotReplacing(shell);
        const resolvedCwd = this.resolveSpawnCwd(cwd);
        const launch = shellLaunch(shell, { ...process.env, ...env });
        logger.debug(`[Paperboard Server] creating terminal ${id} (shell=${shell} cwd=${resolvedCwd})`);
        if (subscriber) this.subscribeStreams(id, subscriber, { ...streams });

        let announced = false;
        let exited = false;
        await spawnSupervisedClient(
            id,
            {
                id,
                type: "pty",
                isPty: true,
                command: shell,
                args: launch.args,
                cwd: resolvedCwd,
                env: { ...env, ...launch.env },
                cols,
                rows,
            },
            this.clients,
            {
                onData: subscriber ? undefined : onData,
                onExit: (code) => {
                    this.clients.delete(id);
                    // a shell can exit before its spawn resolves: it still
                    // started first, and nothing of it is kept
                    if (!announced) {
                        announced = true;
                        this.announceWorkload(id, "started");
                    }
                    exited = true;
                    this.workloadEnded(id, code);
                    if (!subscriber) onExit?.(code);
                },
                attach: (client) => this.wireStreams(id, client),
            },
        );
        if (!exited) {
            this.clientCommands.set(id, shell);
            this.rememberWorkload(id, Date.now(), false);
        }
        if (!announced) {
            announced = true;
            this.announceWorkload(id, "started");
        }
    }

    public writeTerminal(id: string, data: string): void {
        const client = this.clients.get(id);
        // keystrokes for a shell that is gone are a failure, not a delivery
        if (!client) throw new Error(`Terminal "${id}" is not running`);
        client.write(data);
    }

    /**
     * What is known of a running terminal: the program in front of it and
     * the folder its shell is in, each "" until it has been said
     */
    public terminalState(id: string): { foreground: string; cwd: string } {
        const client = this.clients.get(id);
        return { foreground: client?.foreground ?? "", cwd: client?.cwd ?? "" };
    }

    public resizeTerminal(id: string, cols: number, rows: number): void {
        const client = this.clients.get(id);
        if (!client) throw new Error(`Terminal "${id}" is not running`);
        client.resize(cols, rows);
    }

    public async destroyTerminal(id: string): Promise<void> {
        const client = this.clients.get(id);
        if (client) {
            await this.stopOwnedClient(id, client);
        }
        this.forgetClientOwner(id);
    }

    // Reattaches streaming for a terminal owned by a previous session
    public async attachTerminal(
        id: string,
        subscriber: object,
        streams: TerminalStreams,
    ): Promise<boolean> {
        // subscribed even when the shell is not running yet: it streams
        // here as soon as it starts
        this.subscribeStreams(id, subscriber, { ...streams });
        return (await this.getOrConnectClient(id)) !== null;
    }

    public async isTerminalRunning(id: string): Promise<boolean> {
        const client = await this.getOrConnectClient(id);
        return client?.isConnected() ?? false;
    }

    // Background supervised processes
    public async runProcess(
        id: string,
        command: string,
        args: string[] = [],
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
    ): Promise<{ exitCode: number | null }> {
        return (await this.startProcess(id, command, args, cwd, env, onData, onStdout, onStderr)).completion;
    }

    public async startProcess(
        id: string, command: string, args: string[] = [], cwd?: string, env?: Record<string, string>,
        onData?: (data: string) => void, onStdout?: (data: string) => void, onStderr?: (data: string) => void,
        // subscriber: the socket that receives the streams (see
        // subscribeStreams), onExit its exit listener; without one, the
        // listeners belong to this process alone
        // important: people rely on it while it runs (a game server), so an
        // update of what it runs from waits for it instead of stopping it
        options: { stdin?: boolean; inputEncoding?: InputEncoding; consoleInput?: boolean; important?: boolean; subscriber?: object; onExit?: (exitCode: number | null) => void } = {},
    ): Promise<{ completion: Promise<{ exitCode: number | null }> }> {
        if (!id || typeof id !== "string") {
            throw new Error("process id is required");
        }
        await this.runtime.beforeStart(id, command);
        const resolvedCwd = this.resolveSpawnCwd(cwd);
        const subscriber = options.subscriber;
        if (subscriber) {
            this.subscribeStreams(id, subscriber, {
                data: onData,
                stdout: onStdout,
                stderr: onStderr,
                exit: options.onExit,
            });
        }

        let resolveExit!: (result: { exitCode: number | null }) => void;
        const completion = new Promise<{ exitCode: number | null }>((resolve) => { resolveExit = resolve; });
        // a Windows console input takes no writes: the process is inputless,
        // recorded as such so a daemon that adopts it refuses writes too
        const inputless = options.stdin === false || (options.consoleInput === true && process.platform === "win32");
        let announced = false;
        let exited = false;
        await spawnSupervisedClient(
                id,
                {
                    id,
                    type: "child_process",
                    command,
                    args,
                    cwd: resolvedCwd,
                    env,
                    noStdin: inputless,
                    inputEncoding: options.inputEncoding,
                    consoleInput: options.consoleInput,
                    ...(options.important ? { important: true } : {}),
                },
                this.clients,
                {
                    onData: subscriber ? undefined : onData,
                    onStdout: subscriber ? undefined : onStdout,
                    onStderr: subscriber ? undefined : onStderr,
                    onExit: (exitCode: number | null) => {
                        this.clients.delete(id);
                        // a process can exit before its spawn resolves: it
                        // still started first, and nothing of it is kept
                        if (!announced) {
                            announced = true;
                            this.announceWorkload(id, "started");
                        }
                        exited = true;
                        this.workloadEnded(id, exitCode);
                        resolveExit({ exitCode });
                        if (!subscriber) options.onExit?.(exitCode);
                    },
                    attach: (client) => this.wireStreams(id, client),
                },
            );
        if (!exited) {
            this.clientCommands.set(id, command);
            if (inputless) this.inputless.add(id);
            else this.inputless.delete(id);
            this.rememberWorkload(id, Date.now(), options.important === true);
        }
        if (!announced) {
            announced = true;
            this.announceWorkload(id, "started");
        }
        return { completion };
    }


    public writeProcess(id: string, data: string): void {
        const client = this.clients.get(id);
        // a write to a process that is gone is a failure, not a delivery
        if (!client) throw new Error(`Process "${id}" is not running`);
        if (this.inputless.has(id)) throw new Error(`Process "${id}" has no input open (it was started without one, or it was closed); it can't be written to`);
        client.write(data);
    }

    /** Ends a process's input after what was written to it: a program that reads its input to the end goes on. Later writes are refused. */
    public closeProcessInput(id: string): void {
        const client = this.clients.get(id);
        if (!client) throw new Error(`Process "${id}" is not running`);
        if (this.inputless.has(id)) throw new Error(`Process "${id}" has no input open (it was started without one, or it was closed already)`);
        this.inputless.add(id);
        client.closeInput();
    }

    public async killProcess(id: string, signal: string = "SIGTERM"): Promise<void> {
        const client = this.clients.get(id);
        if (!client) {
            this.forgetClientOwner(id);
            return;
        }
        await this.stopOwnedClient(id, client, signal);
    }

    public async isProcessRunning(id: string): Promise<boolean> {
        const client = await this.getOrConnectClient(id);
        return client?.isConnected() ?? false;
    }

    public async attachProcess(
        id: string,
        subscriber: object,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number | null) => void,
    ): Promise<boolean> {
        this.subscribeStreams(id, subscriber, {
            data: onData,
            stdout: onStdout,
            stderr: onStderr,
            exit: onExit,
        });
        return (await this.getOrConnectClient(id)) !== null;
    }

    // Reconnects supervisors that outlived the previous daemon, keyed by the
    // id their metadata records (the endpoint name is a digest of it, never
    // an id). A supervisor whose metadata does not belong to its file name is
    // skipped rather than adopted under the wrong id.
    public recoverRunningSupervisors(): Promise<void> {
        this.recovery = this.adoptRunningSupervisors();
        return this.recovery;
    }

    private async adoptRunningSupervisors(): Promise<void> {
        const socketsDir = getSocketsDir();
        if (!fs.existsSync(socketsDir)) return;
        let files: string[];
        try {
            files = await fs.promises.readdir(socketsDir);
        } catch (err) {
            logger.warn("[Paperboard Server] failed to list running supervisors:", err);
            return;
        }
        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const stem = file.slice(0, -".json".length);
            let id: unknown;
            let meta: SupervisorMeta;
            let mountHolderPid: unknown;
            try {
                const parsed = JSON.parse(await fs.promises.readFile(path.join(socketsDir, file), "utf8"));
                id = parsed?.id;
                meta = { config: parsed?.config && typeof parsed.config === "object" ? parsed.config : {}, startedAt: parsed?.startedAt };
                mountHolderPid = parsed?.config?.mountHolderPid;
            } catch (err) {
                logger.warn(`[Paperboard Server] unreadable supervisor metadata ${file}; not adopting it:`, err);
                continue;
            }
            if (typeof id !== "string" || !id || this.clients.has(id)) continue;
            if (stem !== supervisorEndpointName(id)) {
                logger.warn(`[Paperboard Server] supervisor metadata ${file} names "${id}", which does not own that endpoint; not adopting it`);
                continue;
            }
            if (!(await this.connectSupervisor(id, () => meta))) {
                // A supervisor that was killed outright never stopped the
                // AppImage mount it ran from (supervisorLaunch.ts). Its
                // metadata goes too, so a later start never signals that pid
                // again once it may belong to another supervisor's mount.
                if (typeof mountHolderPid === "number" && Number.isInteger(mountHolderPid) && mountHolderPid > 0) {
                    stopMountHolder(mountHolderPid);
                    await fs.promises.rm(path.join(socketsDir, file), { force: true }).catch((err) =>
                        logger.warn(`[Paperboard Server] could not remove the metadata of dead supervisor "${id}":`, err),
                    );
                }
            }
        }
    }

    // shutdown all clients: SIGTERM, then SIGKILL after grace
    public async disposeClients(graceMs = 5000): Promise<void> {
        const entries = [...this.clients.entries()];
        if (entries.length === 0) return;

        // kill and destroy only queue or write to a socket; neither throws
        for (const [, client] of entries) client.kill("SIGTERM");

        const deadline = Date.now() + graceMs;
        while (Date.now() < deadline) {
            if (entries.every(([, client]) => !client.isConnected())) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        this.killAllClients();
    }

    // lets go of every supervised workload without stopping it: the sockets
    // close, the supervisors keep their programs running, and the next daemon
    // adopts them (recoverRunningSupervisors)
    public releaseAllClients(): void {
        for (const [id, client] of [...this.clients.entries()]) {
            client.destroy();
            this.clients.delete(id);
        }
    }

    // last-resort sync teardown for exit handlers
    public killAllClients(): void {
        for (const [id, client] of [...this.clients.entries()]) {
            if (client.isConnected()) client.kill("SIGKILL");
            client.destroy();
            this.clients.delete(id);
        }
    }

    // a workload is gone: its runtime may now be free to update
    private workloadEnded(id: string, code: number | null): void {
        this.announceWorkload(id, "exited", code);
        this.clientCommands.delete(id);
        this.inputless.delete(id);
        this.clientStarts.delete(id);
        this.importantClients.delete(id);
        this.forgetClientOwner(id);
        this.runtime.ended();
    }

    private supervisorMeta(id: string): SupervisorMeta | null {
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(getSocketsDir(), `${supervisorEndpointName(id)}.json`), "utf8"));
            return meta?.config && typeof meta.config === "object" ? { config: meta.config, startedAt: meta.startedAt } : null;
        } catch (err) {
            logger.warn(`[engine] supervisor metadata for ${id} is unreadable; its runtime is unknown and blocks package updates:`, err);
            return null;
        }
    }

    private rememberWorkload(id: string, startedAt: unknown, important: boolean): void {
        const at = typeof startedAt === "number" ? startedAt : typeof startedAt === "string" ? Date.parse(startedAt) : NaN;
        // an unknown start counts as long ago: it holds updates, never loses to them
        this.clientStarts.set(id, Number.isFinite(at) ? at : 0);
        if (important) this.importantClients.add(id);
        else this.importantClients.delete(id);
    }

    /**
     * Whether a live workload holds back an update of what it runs from:
     * one started as important (a game server), or one that has run for a
     * while. Anything else is stopped for the update and started again by
     * its panel (afterUpdate), without asking anyone.
     */
    public holdsUpdates(id: string): boolean {
        if (this.importantClients.has(id)) return true;
        const started = this.clientStarts.get(id);
        return started === undefined || Date.now() - started >= LONG_RUNNING_MS;
    }

    /** The live workloads a panel started, which an update of the panel stops. */
    public panelWorkloads(panelId: string): string[] {
        const cleanId = requirePanelId(panelId);
        return [...this.clients.keys()].filter((id) => this.clientOwners.get(id) === cleanId);
    }

    /** Hears every workload start and exit from now on; returns the unsubscribe. */
    public onLifecycle(listener: (change: MonitorLifecycle) => void): () => void {
        this.lifecycleListeners.add(listener);
        return () => this.lifecycleListeners.delete(listener);
    }

    private announceWorkload(id: string, state: "started" | "exited", code?: number | null): void {
        if (this.lifecycleListeners.size === 0) return;
        const panel = this.clientOwner(id);
        for (const listener of this.lifecycleListeners) {
            try {
                listener({ type: "workload", id, panel, state, ...(state === "exited" ? { code: code ?? null } : {}) });
            } catch (err) { logger.error(`[engine] lifecycle listener failed for ${id}`, err); }
        }
    }

    private async stopOwnedClient(id: string, client: SupervisedProcessClient, signal = "SIGTERM", graceMs = 3000): Promise<void> {
        let exitCode: number | null = null;
        if (client.isConnected()) {
            let exited = false;
            const onExit = (code: number | null) => { exited = true; exitCode = code; };
            client.on("exit", onExit);
            try {
                client.kill(signal);
                const started = Date.now();
                let escalated = false;
                while (!exited) {
                    if (!escalated && Date.now() - started >= graceMs) { client.kill("SIGKILL"); escalated = true; }
                    if (Date.now() - started >= graceMs + 3000) throw new Error(`Process ${id} did not stop; removal refused`);
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
            } finally { client.off("exit", onExit); }
        }
        client.destroy();
        // its own exit listener may have ended it already
        if (this.clients.get(id) !== client) return;
        this.clients.delete(id);
        this.workloadEnded(id, exitCode);
    }}
