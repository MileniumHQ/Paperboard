// Saved commands: short shell commands the user keeps in the Terminal panel
// and runs from Home's "Pinned command" widget. The service owns the list,
// its file, and every run; the widget only asks. A run's outcome is what the
// daemon reported when the child exited, never what we expected.
//
// Bounded: at most MAX_SAVED_COMMANDS commands, MAX_CONCURRENT_RUNS children
// at once, one run per command, and every run is killed after RUN_TIMEOUT_MS.

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

export interface SavedCommandsDoc {
    version: number;
    commands: SavedCommand[];
    /** Finished runs only: a run in flight when the service stops has no outcome to keep. */
    lastRuns: Record<string, CommandRun>;
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
    publish(view: SavedCommandsView): void;
    now?: () => number;
    newId?: () => string;
    timeoutMs?: number;
    graceMs?: number;
}

const ID_PATTERN = /^cmd_[a-z0-9]{1,32}$/;

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
    if (raw === null || raw === undefined) return { version: SAVED_COMMANDS_VERSION, commands: [], lastRuns: {} };
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("the saved commands file is not an object");
    const doc = raw as Record<string, unknown>;
    if (Object.keys(doc).length === 0) return { version: SAVED_COMMANDS_VERSION, commands: [], lastRuns: {} };
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
    return { version: SAVED_COMMANDS_VERSION, commands, lastRuns };
}

interface LiveRun {
    procId: string;
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
    private writes: Promise<void> = Promise.resolve();
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
        try {
            const doc = parseSavedCommandsDoc(await this.deps.load());
            this.commands = doc.commands;
            this.runs = doc.lastRuns;
            this.loadError = "";
            this.loaded = true;
        } catch (err) {
            // unreadable is not empty: keep nothing, refuse to write over it
            this.commands = [];
            this.runs = {};
            this.loaded = false;
            this.loadError = `Saved commands could not be read: ${err instanceof Error ? err.message : String(err)}`;
        }
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
        this.requireLoaded();
        const valid = validateSavedCommand(label, command);
        if (this.commands.length >= MAX_SAVED_COMMANDS) {
            throw new Error(`You can save at most ${MAX_SAVED_COMMANDS} commands; remove one first`);
        }
        const id = this.newId();
        if (!ID_PATTERN.test(id) || this.commands.some((c) => c.id === id)) {
            throw new Error("Could not allocate a command id; try again");
        }
        const previous = this.commands;
        this.commands = [...previous, { id, ...valid }];
        try {
            await this.persist();
        } catch (err) {
            this.commands = previous;
            throw new Error(`The command was not saved: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.publish();
        return id;
    }

    async remove(id: unknown): Promise<void> {
        this.requireLoaded();
        const command = this.find(id);
        const previousCommands = this.commands;
        const previousRuns = this.runs;
        this.commands = previousCommands.filter((c) => c.id !== command.id);
        const { [command.id]: _dropped, ...rest } = previousRuns;
        this.runs = rest;
        try {
            await this.persist();
        } catch (err) {
            this.commands = previousCommands;
            this.runs = previousRuns;
            throw new Error(`The command was not removed: ${err instanceof Error ? err.message : String(err)}`);
        }
        // a run already started keeps going until it exits or times out; its
        // outcome has nowhere to land and is dropped (see settle)
        this.publish();
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
        const live: LiveRun = { procId, offExit: () => {}, timedOut: false, settled: false };
        this.live.set(command.id, live);
        // listen before spawning: a fast command can exit before start() answers
        live.offExit = this.deps.onExit(procId, (exitCode) => {
            if (live.timedOut) {
                this.settle(command.id, live, { state: "timed-out", startedAt, endedAt: this.now() });
            } else if (typeof exitCode === "number") {
                this.settle(command.id, live, { state: "exited", startedAt, endedAt: this.now(), exitCode });
            } else {
                this.settle(command.id, live, { state: "failed", startedAt, endedAt: this.now(), error: "The process ended without an exit code" });
            }
        });
        const previousRun = this.runs[command.id];
        this.runs = { ...this.runs, [command.id]: { state: "running", startedAt } };
        this.publish();
        try {
            await this.deps.start(procId, command.command);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!live.settled) {
                live.settled = true;
                live.offExit();
                this.live.delete(command.id);
                if (previousRun) this.runs = { ...this.runs, [command.id]: previousRun };
                else {
                    const { [command.id]: _gone, ...rest } = this.runs;
                    this.runs = rest;
                }
                this.publish();
            }
            throw new Error(`"${command.label}" could not start: ${message}`);
        }
        if (!live.settled) {
            live.timeout = setTimeout(() => this.expire(command.id, live), this.timeoutMs);
        }
        return { startedAt };
    }

    /** Stops listening and kills every run this service started. */
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
    }

    /** Test/diagnostic: how many children are in flight. */
    liveCount(): number {
        return this.live.size;
    }

    private expire(commandId: string, live: LiveRun): void {
        if (live.settled) return;
        live.timedOut = true;
        this.deps.kill(live.procId).catch((err) =>
            console.error(`[TerminalService] could not stop timed-out command ${commandId}:`, err),
        );
        // the exit is what proves the child is gone; without one we say so
        live.grace = setTimeout(() => {
            this.settle(commandId, live, {
                state: "failed",
                startedAt: (this.runs[commandId] as CommandRun | undefined)?.startedAt ?? this.now(),
                endedAt: this.now(),
                error: "Timed out, and no exit was reported after stopping it",
            });
        }, this.graceMs);
    }

    private settle(commandId: string, live: LiveRun, outcome: CommandRun): void {
        if (live.settled) return;
        live.settled = true;
        live.offExit();
        clearTimeout(live.timeout);
        clearTimeout(live.grace);
        if (this.live.get(commandId) === live) this.live.delete(commandId);
        // removed while running: nothing to record it on
        if (!this.commands.some((c) => c.id === commandId)) return;
        this.runs = { ...this.runs, [commandId]: outcome };
        this.publish();
        this.persist().catch((err) =>
            console.error(`[TerminalService] could not keep the last run of ${commandId}:`, err),
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

    // one writer, in order: each write is the whole current document
    private persist(): Promise<void> {
        const write = this.writes.then(() => {
            const lastRuns: Record<string, CommandRun> = {};
            for (const [id, run] of Object.entries(this.runs)) {
                if (run.state !== "running") lastRuns[id] = run;
            }
            return this.deps.save({ version: SAVED_COMMANDS_VERSION, commands: this.commands, lastRuns });
        });
        // the chain only orders writes; this write's failure reaches its caller
        // through `write`, so the next write must not inherit the rejection
        this.writes = write.then(
            () => undefined,
            () => undefined,
        );
        return write;
    }

    private publish(): void {
        this.deps.publish(this.view());
    }
}
