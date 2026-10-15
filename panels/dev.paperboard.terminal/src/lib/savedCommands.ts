// Saved commands: short shell commands the user keeps in the Terminal panel
// and runs from Home's "Pinned command" widget. The service owns the list,
// its file, and every run; the widget only asks. A run's outcome is what the
// daemon reported when the child exited, never what we expected.
//
// Bounded: at most MAX_SAVED_COMMANDS commands, MAX_CONCURRENT_RUNS children
// at once, one run per command, and every run is killed after RUN_TIMEOUT_MS.
//
// A child belongs to the daemon and outlives this service, so the service
// records each accepted run in its file. A service that stops cleanly kills
// its runs (dispose); one that restarts after a crash finds the records and
// takes the runs back with the deadline they had left (init).

export const MAX_SAVED_COMMANDS = 32;
export const MAX_COMMAND_LENGTH = 4096;
export const MAX_LABEL_LENGTH = 48;
export const MAX_CONCURRENT_RUNS = 4;
export const RUN_TIMEOUT_MS = 10 * 60_000;
/** After a kill, how long to wait for the exit before giving up on the run. */
export const EXIT_GRACE_MS = 30_000;
export const SAVED_COMMANDS_VERSION = 1;

export interface SavedCommand {
    id: string;
    label: string;
    command: string;
}

export type CommandRun =
    | { state: "running"; startedAt: number }
    | { state: "exited"; startedAt: number; endedAt: number; exitCode: number }
    /** Killed after RUN_TIMEOUT_MS; the exit was observed, its code is not the command's verdict. */
    | { state: "timed-out"; startedAt: number; endedAt: number }
    /** The daemon refused the spawn, or no exit ever arrived. Not an exit code. */
    | { state: "failed"; startedAt: number; endedAt: number; error: string };

/** A child the daemon accepted and this service has not yet seen exit. */
export interface RunningRecord {
    commandId: string;
    procId: string;
    startedAt: number;
}

export interface SavedCommandsDoc {
    version: number;
    commands: SavedCommand[];
    /** Finished runs only; a run still going is in `running`. */
    lastRuns: Record<string, CommandRun>;
    /** Runs in flight, so a restarted service can take them back. */
    running: RunningRecord[];
}

export interface SavedCommandsView {
    savedCommands: SavedCommand[];
    commandRuns: Record<string, CommandRun>;
    /** Set when the saved list could not be read; the list is then unknown, not empty. */
    savedCommandsError: string;
}

export interface SavedCommandsDeps {
    load(): Promise<unknown>;
    save(doc: SavedCommandsDoc): Promise<void>;
    /** Resolves once the daemon accepted the spawn; rejects if it refused. */
    start(procId: string, command: string): Promise<void>;
    onExit(procId: string, callback: (exitCode?: number) => void): () => void;
    kill(procId: string): Promise<void>;
    /** Whether the daemon still has this child. */
    exists(procId: string): Promise<boolean>;
    publish(view: SavedCommandsView): void;
    now?: () => number;
    newId?: () => string;
    timeoutMs?: number;
    graceMs?: number;
}

const ID_PATTERN = /^cmd_[a-z0-9]{1,32}$/;
const PROC_ID_PATTERN = /^pinned_cmd_[a-z0-9]{1,32}_[a-z0-9]{1,16}$/;

function randomId(): string {
    return `cmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isFinishedRun(raw: unknown): raw is CommandRun {
    if (!raw || typeof raw !== "object") return false;
    const run = raw as Record<string, unknown>;
    if (typeof run.startedAt !== "number" || typeof run.endedAt !== "number") return false;
    if (run.state === "exited") return typeof run.exitCode === "number";
    if (run.state === "timed-out") return true;
    if (run.state === "failed") return typeof run.error === "string";
    return false;
}

/** Normalises a user's label and command, or throws saying what is wrong. */
export function validateSavedCommand(label: unknown, command: unknown): { label: string; command: string } {
    if (typeof command !== "string" || !command.trim()) throw new Error("A command is required");
    if (command.length > MAX_COMMAND_LENGTH) {
        throw new Error(`A saved command can be at most ${MAX_COMMAND_LENGTH} characters`);
    }
    if (/[\0]/.test(command)) throw new Error("A saved command cannot contain a NUL character");
    const cleanCommand = command.trim();
    const rawLabel = typeof label === "string" ? label.trim() : "";
    const cleanLabel = rawLabel || cleanCommand.split("\n")[0];
    if (cleanLabel.length > MAX_LABEL_LENGTH && rawLabel) {
        throw new Error(`A name can be at most ${MAX_LABEL_LENGTH} characters`);
    }
    return { label: cleanLabel.slice(0, MAX_LABEL_LENGTH), command: cleanCommand };
}

/** Parses the stored document; throws when it is not one we wrote (never read as empty). */
export function parseSavedCommandsDoc(raw: unknown): SavedCommandsDoc {
    if (raw === null || raw === undefined) return { version: SAVED_COMMANDS_VERSION, commands: [], lastRuns: {}, running: [] };
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("the saved commands file is not an object");
    const doc = raw as Record<string, unknown>;
    if (Object.keys(doc).length === 0) return { version: SAVED_COMMANDS_VERSION, commands: [], lastRuns: {}, running: [] };
    if (doc.version !== SAVED_COMMANDS_VERSION) {
        throw new Error(`the saved commands file has version ${String(doc.version)}, expected ${SAVED_COMMANDS_VERSION}`);
    }
    if (!Array.isArray(doc.commands)) throw new Error("the saved commands file has no command list");
    const commands: SavedCommand[] = [];
    for (const entry of doc.commands.slice(0, MAX_SAVED_COMMANDS)) {
        const c = entry as Record<string, unknown> | null;
        if (!c || typeof c.id !== "string" || !ID_PATTERN.test(c.id)) {
            throw new Error("the saved commands file has an entry without a valid id");
        }
        const valid = validateSavedCommand(c.label, c.command);
        commands.push({ id: c.id, ...valid });
    }
    const lastRuns: Record<string, CommandRun> = {};
    const rawRuns = doc.lastRuns && typeof doc.lastRuns === "object" ? (doc.lastRuns as Record<string, unknown>) : {};
    for (const command of commands) {
        const run = rawRuns[command.id];
        if (isFinishedRun(run)) lastRuns[command.id] = run;
    }
    const running: RunningRecord[] = [];
    if (doc.running !== undefined) {
        if (!Array.isArray(doc.running)) throw new Error("the saved commands file has a malformed run list");
        for (const entry of doc.running.slice(0, MAX_CONCURRENT_RUNS)) {
            const rec = entry as Record<string, unknown> | null;
            if (
                !rec ||
                typeof rec.commandId !== "string" || !ID_PATTERN.test(rec.commandId) ||
                typeof rec.procId !== "string" || !PROC_ID_PATTERN.test(rec.procId) ||
                typeof rec.startedAt !== "number"
            ) {
                throw new Error("the saved commands file has a malformed run record");
            }
            running.push({ commandId: rec.commandId, procId: rec.procId, startedAt: rec.startedAt });
        }
    }
    return { version: SAVED_COMMANDS_VERSION, commands, lastRuns, running };
}

interface LiveRun {
    commandId: string;
    procId: string;
    startedAt: number;
    /** The daemon accepted the spawn: from here the run is in the file. */
    accepted: boolean;
    offExit: () => void;
    timeout?: ReturnType<typeof setTimeout>;
    grace?: ReturnType<typeof setTimeout>;
    timedOut: boolean;
    settled: boolean;
}

export class SavedCommands {
    private commands: SavedCommand[] = [];
    private runs: Record<string, CommandRun> = {};
    private live = new Map<string, LiveRun>();
    private loadError = "";
    private loaded = false;
    private transactions: Promise<void> = Promise.resolve();
    private readonly now: () => number;
    private readonly newId: () => string;
    private readonly timeoutMs: number;
    private readonly graceMs: number;

    constructor(private readonly deps: SavedCommandsDeps) {
        this.now = deps.now ?? Date.now;
        this.newId = deps.newId ?? randomId;
        this.timeoutMs = deps.timeoutMs ?? RUN_TIMEOUT_MS;
        this.graceMs = deps.graceMs ?? EXIT_GRACE_MS;
    }

    async init(): Promise<void> {
        let running: RunningRecord[] = [];
        try {
            const doc = parseSavedCommandsDoc(await this.deps.load());
            this.commands = doc.commands;
            this.runs = doc.lastRuns;
            this.loadError = "";
            this.loaded = true;
            running = doc.running;
        } catch (err) {
            // unreadable is not empty: keep nothing, refuse to write over it
            this.commands = [];
            this.runs = {};
            this.loaded = false;
            this.loadError = `Saved commands could not be read: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (this.loaded && running.length > 0) await this.takeBack(running);
        this.publish();
    }

    view(): SavedCommandsView {
        return {
            savedCommands: this.commands.map((c) => ({ ...c })),
            commandRuns: { ...this.runs },
            savedCommandsError: this.loadError,
        };
    }

    /** What the widget's "Command" dropdown offers in Home's gallery. */
    choices(): { value: string; label: string }[] {
        if (!this.loaded) throw new Error(this.loadError || "Saved commands are not loaded yet");
        return this.commands.map((c) => ({ value: c.id, label: c.label }));
    }

    async add(label: unknown, command: unknown): Promise<string> {
        return this.transaction(async () => {
            this.requireLoaded();
            const valid = validateSavedCommand(label, command);
            if (this.commands.length >= MAX_SAVED_COMMANDS) {
                throw new Error(`You can save at most ${MAX_SAVED_COMMANDS} commands; remove one first`);
            }
            const id = this.newId();
            if (!ID_PATTERN.test(id) || this.commands.some((c) => c.id === id)) {
                throw new Error("Could not allocate a command id; try again");
            }
            // written before it is believed: a failed save leaves nothing to undo
            const next = [...this.commands, { id, ...valid }];
            try {
                await this.deps.save(this.docWith(next, this.runs));
            } catch (err) {
                throw new Error(`The command was not saved: ${err instanceof Error ? err.message : String(err)}`);
            }
            this.commands = next;
            this.publish();
            return id;
        });
    }

    async remove(id: unknown): Promise<void> {
        return this.transaction(async () => {
            this.requireLoaded();
            const command = this.find(id);
            const nextCommands = this.commands.filter((c) => c.id !== command.id);
            const { [command.id]: _dropped, ...nextRuns } = this.runs;
            try {
                await this.deps.save(this.docWith(nextCommands, nextRuns));
            } catch (err) {
                throw new Error(`The command was not removed: ${err instanceof Error ? err.message : String(err)}`);
            }
            // applied to what is current now, not to a snapshot: runs settled
            // and started while the save was in flight stay
            this.commands = this.commands.filter((c) => c.id !== command.id);
            const { [command.id]: _gone, ...runs } = this.runs;
            this.runs = runs;
            // a run already started keeps going until it exits or times out; its
            // outcome has nowhere to land and is dropped (see settle)
            this.publish();
        });
    }

    /**
     * Starts a saved command. Resolves once the daemon accepted the spawn
     * (accepted, not completed); the exit arrives later through the view.
     */
    async run(id: unknown): Promise<{ startedAt: number }> {
        this.requireLoaded();
        const command = this.find(id);
        if (this.live.has(command.id)) throw new Error(`"${command.label}" is already running`);
        if (this.live.size >= MAX_CONCURRENT_RUNS) {
            throw new Error(`At most ${MAX_CONCURRENT_RUNS} saved commands can run at once`);
        }
        const startedAt = this.now();
        const procId = `pinned_${command.id}_${startedAt.toString(36)}`;
        const live: LiveRun = { commandId: command.id, procId, startedAt, accepted: false, offExit: () => {}, timedOut: false, settled: false };
        this.live.set(command.id, live);
        this.listen(live);
        const previousRun = this.runs[command.id];
        this.runs = { ...this.runs, [command.id]: { state: "running", startedAt } };
        this.publish();
        try {
            await this.deps.start(procId, command.command);
        } catch (err) {
            this.abandon(live, previousRun);
            throw new Error(`"${command.label}" could not start: ${err instanceof Error ? err.message : String(err)}`);
        }
        live.accepted = true;
        // the child is the daemon's and outlives this service: it must be on
        // record before the run counts as started
        try {
            await this.transaction(() => this.deps.save(this.docNow()));
        } catch (err) {
            await this.deps.kill(procId).catch((killErr) =>
                console.error(`[TerminalService] could not stop unrecorded run of ${command.id}:`, killErr),
            );
            this.abandon(live, previousRun);
            throw new Error(`"${command.label}" was stopped: its run could not be recorded (${err instanceof Error ? err.message : String(err)})`);
        }
        if (!live.settled) {
            live.timeout = setTimeout(() => this.expire(command.id, live), this.timeoutMs);
        }
        return { startedAt };
    }

    /**
     * The service is stopping: kills every run it owns, waits for the daemon
     * to confirm, and records that they were stopped.
     */
    async dispose(): Promise<void> {
        const pending = [...this.live.values()];
        this.live.clear();
        for (const live of pending) {
            live.settled = true;
            live.offExit();
            clearTimeout(live.timeout);
            clearTimeout(live.grace);
        }
        await Promise.allSettled(pending.map((live) => this.deps.kill(live.procId)));
        if (pending.length === 0 || !this.loaded) return;
        const endedAt = this.now();
        for (const live of pending) {
            if (!this.commands.some((c) => c.id === live.commandId)) continue;
            this.runs = {
                ...this.runs,
                [live.commandId]: { state: "failed", startedAt: live.startedAt, endedAt, error: "Stopped when the service stopped" },
            };
        }
        try {
            await this.transaction(() => this.deps.save(this.docNow()));
        } catch (err) {
            console.error("[TerminalService] could not record the runs stopped at shutdown:", err);
        }
    }

    /** Test/diagnostic: how many children are in flight. */
    liveCount(): number {
        return this.live.size;
    }

    // listen before spawning: a fast command can exit before start() answers
    private listen(live: LiveRun): void {
        live.offExit = this.deps.onExit(live.procId, (exitCode) => {
            const { startedAt } = live;
            if (live.timedOut) {
                this.settle(live, { state: "timed-out", startedAt, endedAt: this.now() });
            } else if (typeof exitCode === "number") {
                this.settle(live, { state: "exited", startedAt, endedAt: this.now(), exitCode });
            } else {
                this.settle(live, { state: "failed", startedAt, endedAt: this.now(), error: "The process ended without an exit code" });
            }
        });
    }

    /** A run that never counted as started (refused, or could not be recorded). */
    private abandon(live: LiveRun, previousRun: CommandRun | undefined): void {
        if (live.settled) return;
        live.settled = true;
        live.offExit();
        if (this.live.get(live.commandId) === live) this.live.delete(live.commandId);
        if (previousRun) this.runs = { ...this.runs, [live.commandId]: previousRun };
        else {
            const { [live.commandId]: _gone, ...rest } = this.runs;
            this.runs = rest;
        }
        this.publish();
    }

    /**
     * After a restart, the runs the last service left in the file: a child
     * the daemon still has is owned again with the deadline it had left; one
     * it no longer has ended while nobody was watching, and its outcome is
     * not known.
     */
    private async takeBack(records: RunningRecord[]): Promise<void> {
        for (const rec of records) {
            let alive: boolean;
            try {
                alive = await this.deps.exists(rec.procId);
            } catch (err) {
                // cannot tell: own it, and the deadline bounds the guess
                console.error(`[TerminalService] could not check ${rec.procId}:`, err);
                alive = true;
            }
            const known = this.commands.some((c) => c.id === rec.commandId);
            if (!alive) {
                if (known) {
                    this.runs = {
                        ...this.runs,
                        [rec.commandId]: { state: "failed", startedAt: rec.startedAt, endedAt: this.now(), error: "The service restarted and did not see how this run ended" },
                    };
                }
                continue;
            }
            if (!known) {
                // removed while it ran: nothing can show it, so it must not keep running
                await this.deps.kill(rec.procId).catch((err) =>
                    console.error(`[TerminalService] could not stop orphaned run ${rec.procId}:`, err),
                );
                continue;
            }
            if (this.live.has(rec.commandId)) {
                // one run per command: a second record is a stray
                await this.deps.kill(rec.procId).catch((err) =>
                    console.error(`[TerminalService] could not stop stray run ${rec.procId}:`, err),
                );
                continue;
            }
            const live: LiveRun = { commandId: rec.commandId, procId: rec.procId, startedAt: rec.startedAt, accepted: true, offExit: () => {}, timedOut: false, settled: false };
            this.live.set(rec.commandId, live);
            this.listen(live);
            this.runs = { ...this.runs, [rec.commandId]: { state: "running", startedAt: rec.startedAt } };
            const left = Math.max(0, this.timeoutMs - (this.now() - rec.startedAt));
            live.timeout = setTimeout(() => this.expire(rec.commandId, live), left);
        }
        try {
            await this.transaction(() => this.deps.save(this.docNow()));
        } catch (err) {
            console.error("[TerminalService] could not record the runs taken back after a restart:", err);
        }
    }

    private expire(commandId: string, live: LiveRun): void {
        if (live.settled) return;
        live.timedOut = true;
        this.deps.kill(live.procId).catch((err) =>
            console.error(`[TerminalService] could not stop timed-out command ${commandId}:`, err),
        );
        // the exit is what proves the child is gone; without one we say so
        live.grace = setTimeout(() => {
            this.settle(live, {
                state: "failed",
                startedAt: live.startedAt,
                endedAt: this.now(),
                error: "Timed out, and no exit was reported after stopping it",
            });
        }, this.graceMs);
    }

    private settle(live: LiveRun, outcome: CommandRun): void {
        if (live.settled) return;
        live.settled = true;
        live.offExit();
        clearTimeout(live.timeout);
        clearTimeout(live.grace);
        if (this.live.get(live.commandId) === live) this.live.delete(live.commandId);
        // removed while running: nothing to show the outcome on, but the run
        // is over and its record leaves the file
        if (this.commands.some((c) => c.id === live.commandId)) {
            this.runs = { ...this.runs, [live.commandId]: outcome };
            this.publish();
        }
        this.transaction(() => this.deps.save(this.docNow())).catch((err) =>
            console.error(`[TerminalService] could not keep the last run of ${live.commandId}:`, err),
        );
    }

    private find(id: unknown): SavedCommand {
        const clean = typeof id === "string" ? id.trim() : "";
        if (!clean) throw new Error("A saved command id is required");
        const command = this.commands.find((c) => c.id === clean);
        if (!command) throw new Error(`No saved command "${clean}"; it may have been removed`);
        return command;
    }

    private requireLoaded(): void {
        if (!this.loaded) throw new Error(this.loadError || "Saved commands are not loaded yet");
    }

    /**
     * One transaction at a time: a change reads the current list, saves the
     * proposed one, and only then applies it, so a failed save has nothing to
     * roll back and a concurrent change is never overwritten.
     */
    private transaction<T>(work: () => Promise<T>): Promise<T> {
        const result = this.transactions.then(work);
        // the chain only orders transactions; each one's failure reaches its own caller
        this.transactions = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private docNow(): SavedCommandsDoc {
        return this.docWith(this.commands, this.runs);
    }

    private docWith(commands: SavedCommand[], runs: Record<string, CommandRun>): SavedCommandsDoc {
        const lastRuns: Record<string, CommandRun> = {};
        for (const [id, run] of Object.entries(runs)) {
            if (run.state !== "running") lastRuns[id] = run;
        }
        const running: RunningRecord[] = [...this.live.values()]
            .filter((live) => live.accepted && !live.settled)
            .map((live) => ({ commandId: live.commandId, procId: live.procId, startedAt: live.startedAt }));
        return { version: SAVED_COMMANDS_VERSION, commands, lastRuns, running };
    }

    private publish(): void {
        this.deps.publish(this.view());
    }
}
