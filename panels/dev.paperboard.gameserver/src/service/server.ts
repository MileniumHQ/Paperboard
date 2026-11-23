// One configured server, as the service runs it: its saved entry, its state,
// its game, its processes, files, ports and backups, and what the shared
// service modules keep for it. The panel's service makes one when a server is
// added or loaded and disposes of it when the server is removed; every helper
// that works on a server is handed it.
import { backupApi, fileApi, portApi, processApi, type BlocksProjectHandle, type PortClaim, type PortRequest } from "@mileniumhq/paperapi";
import { scopedFiles } from "../scopedFiles";
import { serverPortLabel, serverPortName } from "../core/portNames";
import { gameFor } from "../games";
import { gameModuleFor } from "../games/service";
import type { GameDefinition } from "../games/types";
import type { GameService } from "../games/serviceTypes";
import type { StoredServer } from "../servers";
import { PANEL_ID } from "./contract";
import type { GameServerState } from "./types";
import { onlineSinceAfter, type historyWriter } from "./history";

export type Settings = Record<string, unknown>;

/** What owns a server: the panel's service, or a test. It hears what the server says and keeps its settings. */
export interface ServerHost {
    /** The server's state changed from `before`; `server.state` is the new one. */
    changed(server: Server, before: GameServerState): void;
    /** A game event (a join, a chat line, the server starting) for the server's blocks. */
    trigger(server: Server, id: string, output: unknown): void;
    /** Maps the server's saved settings in the order asked, against the latest saved copy; gives what was saved. */
    updateSettings(server: Server, change: (current: Settings) => Settings): Promise<Settings>;
    /** where the server's console and chat are kept across service restarts, when anywhere */
    readonly history?: ReturnType<typeof historyWriter>;
}

/** The ports the server claims, by its own names for them. */
export interface ServerPorts {
    claim(request: PortRequest): Promise<PortClaim>;
    prepare(name: string): Promise<PortClaim>;
    release(name: string): Promise<void>;
    /** the numbers the registry holds for the server's ports, by its own names for them */
    held(): Promise<Map<string, number>>;
}

type Timer = ReturnType<typeof setTimeout>;

export class Server {
    /** the saved entry; the panel replaces it when the saved servers change */
    stored: StoredServer;
    /**
     * The one server from before there were several (ServersConfig.legacyServer).
     * It keeps the names it had: its process is the game's bare id ("mc-server"),
     * its ports the bare names ("java"), its folder the panel's own, and its
     * backups the panel's original history. They are never migrated: the
     * daemon and the port registry can't rename a process or a claim, so a
     * server running through the update that made it legacy (Paperboard's
     * servers outlive its restarts) could only take new names by stopping,
     * and a deferred migration would need this same switch until it did.
     * Its process name is made in processId, its port names in serverPortName
     * (which the page uses too, knowing the server by its folder).
     */
    readonly legacy: boolean;
    readonly definition: GameDefinition;
    /** the server's own part of its game, made for it alone */
    readonly game: GameService;
    /** its folder: every path is relative to it */
    readonly files: typeof fileApi;
    /** its processes, by the game's names for them */
    readonly process: typeof processApi;
    readonly ports: ServerPorts;
    #state: GameServerState;
    readonly #host: ServerHost;

    /** whether the server is a backup source, once its setup has made it one */
    backupSource?: true;
    /** the server's Blocks project, once its setup has made it */
    blocks?: BlocksProjectHandle;
    /** its own picture, when its game has one and it is set */
    icon: string | null = null;
    /** calls and block runs under way: removal waits for them */
    activeOperations = 0;
    removing = false;
    /** what setup subscribed to, ended on removal or a fresh setup */
    readonly unsubscribe: (() => void)[] = [];

    /** the server process's start, readiness, stop and console lines (lifecycle) */
    readonly lifecycle = {
        oomBaseline: null as number | null,
        lineBuffer: "",
        readinessTimer: null as Timer | null,
        readinessDeadline: null as Timer | null,
        generation: 0,
        isRestarting: false,
        stopTimeout: null as Timer | null,
        killDeadline: null as Timer | null,
        /** the game's cleanup after the last run's exit (afterStop); its files are read once it settles */
        released: Promise.resolve() as Promise<void>,
    };
    /** the ports the running server opened, by the game's names for them; empty while it is stopped */
    runPorts: ReadonlyMap<string, number> = new Map();
    /** restarts after a crash, daily and for an update (automation) */
    readonly automation = {
        settings: null as import("./automation").AutomationSettings | null,
        crashes: [] as number[],
        stopRequested: false,
        crashReported: false,
        crashTimer: null as Timer | null,
        dailyTimers: [] as Timer[],
        updateTimer: null as Timer | null,
    };

    constructor(stored: StoredServer, host: ServerHost, legacy = false) {
        this.stored = stored;
        this.legacy = legacy;
        this.#host = host;
        this.definition = gameFor(stored.game);
        this.files = scopedFiles(fileApi, () => this.stored.directory);
        this.process = serverProcesses(this);
        this.ports = {
            claim: (request) => portApi.claim(PANEL_ID, { ...request, name: this.portName(request.name), label: serverPortLabel(this.name, request.label) }),
            prepare: (name) => portApi.prepare(PANEL_ID, this.portName(name)),
            release: (name) => portApi.release(PANEL_ID, this.portName(name)),
            held: async () => {
                const claims = await portApi.list(PANEL_ID);
                const held = new Map<string, number>();
                for (const name of this.game.portNames) {
                    const claim = claims.find((c) => c.name === this.portName(name));
                    if (claim) held.set(name, claim.port);
                }
                return held;
            },
        };
        this.game = gameModuleFor(stored.game).create(this);
        this.#state = this.game.initialState();
    }

    get id(): string {
        return this.stored.id;
    }
    get name(): string {
        return this.stored.name;
    }
    /** the server's saved settings, as last saved */
    get settings(): Settings {
        return this.stored.settings;
    }
    get state(): GameServerState {
        return this.#state;
    }
    setState(patch: Partial<GameServerState> | ((prev: GameServerState) => Partial<GameServerState>)): void {
        const before = this.#state;
        const next = { ...before, ...(typeof patch === "function" ? patch(before) : patch) };
        next.onlineSince = onlineSinceAfter(before, next);
        // a run's ports end with it: the next start asks for the saved ones again
        if (next.serverStatus === "offline" && before.serverStatus !== "offline") {
            next.portMoves = [];
            this.runPorts = new Map();
        }
        this.#state = next;
        this.#host.changed(this, before);
    }
    /**
     * The one way the server's settings change: a patch merges over them, a
     * function maps them, applied in order against the latest saved copy so
     * two writers never drop each other's keys. Gives what was saved.
     */
    updateSettings(change: Settings | ((current: Settings) => Settings)): Promise<Settings> {
        return this.#host.updateSettings(this, typeof change === "function" ? change : (current) => ({ ...current, ...change }));
    }
    /** A game event (a join, a chat line, the server starting) for the server's blocks. */
    trigger(id: string, output: unknown): void {
        this.#host.trigger(this, id, output);
    }
    /** the server's backups, as the backup service keeps them */
    /** its console and chat as kept across service restarts, when they are */
    get history() {
        return this.#host.history;
    }
    get backups() {
        return backupApi.forSource(PANEL_ID, this.id);
    }
    /** its folder, as a path on this computer */
    root(): Promise<string> {
        return this.files.getPath("", PANEL_ID);
    }
    /** a process of the server's game as the daemon knows it */
    processId(id: string): string {
        return this.legacy || !this.game.processIds.includes(id) ? id : `${this.id}-${id}`;
    }
    /**
     * The port `name` is open on while the server runs: the one its start
     * claimed, which a taken port moved for that run. `saved` is the
     * server's own setting, which holds while it is stopped.
     */
    runPort(name: string, saved: number): number {
        return this.runPorts.get(name) ?? saved;
    }
    /** one of the server's ports as the port registry knows it */
    portName(name: string): string {
        return serverPortName(this.id, this.legacy, name);
    }
}

/** The process API for one server: its game's process ids become the server's own. */
function serverProcesses(server: Server): typeof processApi {
    const id = (name: string) => server.processId(name);
    return {
        ...processApi,
        start: (options) => processApi.start({ ...options, id: id(options.id) }),
        write: (name, data) => processApi.write(id(name), data),
        closeInput: (name) => processApi.closeInput(id(name)),
        kill: (name, signal) => processApi.kill(id(name), signal),
        exists: (name) => processApi.exists(id(name)),
        stop: (name, options) => processApi.stop(id(name), options),
        attach: (name) => processApi.attach(id(name)),
        onData: (name, callback) => processApi.onData(id(name), callback),
        onStdout: (name, callback) => processApi.onStdout(id(name), callback),
        onStderr: (name, callback) => processApi.onStderr(id(name), callback),
        onExit: (name, callback) => processApi.onExit(id(name), callback),
    };
}
