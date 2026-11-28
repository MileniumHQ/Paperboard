/** Service-only module contract. Never imported as a value by renderers. */
import type { ServerCalls } from "../service/calls";
import type { GameServerState } from "../service/types";
import type { PortDeps } from "../service/ports";
export interface LaunchCommand {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    /** how console commands are encoded for the server; default UTF-8 */
    inputEncoding?: "utf8" | "utf16le";
    /** Windows: the server reads an empty console rather than a pipe (processApi's consoleInput) */
    consoleInput?: boolean;
}
export interface PreparedLaunch { command: LaunchCommand; message: string }
export interface PortSpec {
    name: string;
    label: string;
    protocol: "tcp" | "udp" | "tcp+udp";
    preferred: number | null;
    /**
     * Ports in a row the server opens from this one, such as Valheim's port
     * and the next; they are claimed, checked and moved together. 1 when unset.
     */
    count?: number;
    /**
     * Set when the game reads this port only from a file the user keeps, so
     * it can't move for one run: a taken one refuses the start, and this says
     * what to do instead.
     */
    pinned?: string;
}
/** One server's part of its game, made for that server alone (GameModule.create): it knows its server. */
export interface GameService {
    initialState(): GameServerState;
    /** The contract's calls the game answers, and its blocks run; each is handed the server and the call's own input. */
    calls(): Promise<ServerCalls>;
    /** The game's own blocks for the Blocks panel, beside the ones every game shares; its joins, leaves and chat among them. */
    blocks?(): Promise<import("@mileniumhq/paperapi").BlockSet>;
    initialize(running: boolean): Promise<void>;
    dispose(): Promise<void>;
    beforeRemove(): Promise<void>;
    /** Asks the game's download source whether a newer build than the installed one is out; Steam games have it. Throws when the source cannot be asked. */
    updateStatus?(): Promise<import("./steam/installAction").SteamUpdateStatus>;
    /** Installs the newest build over a stopped server; with updateStatus, the server can update itself. */
    installUpdate?(): Promise<void>;
    /** The server's own icon, for games that have one. */
    readIcon?(): Promise<string | null>;
    primaryProcessId: string;
    readiness?: { timeoutMs: number; probe(): Promise<boolean> };
    stopTimeoutMs?: number;
    processIds: readonly string[];
    /** Top-level folders of the server left out of its backups and kept on restore, such as a downloaded game install. */
    backupExclude?: readonly string[];
    /** File names left out of its backups wherever they are, such as a lock the running server holds. */
    backupSkip?: readonly string[];
    loadOptions(): Promise<void>;
    /** Readies a start. The run's ports are claimed: `ctx.runPort` gives each, which a taken one may have moved. */
    prepareLaunch(): Promise<PreparedLaunch>;
    /**
     * Runs once the server's process is gone, however it went: stopped,
     * crashed, killed, or never started because the launch failed. A game
     * takes back what prepareLaunch set aside for the start, such as secrets
     * written into its settings files. It can run again for a server it
     * already cleaned up, and a restart waits for it before starting again.
     * `moves` are the run's ports that moved off taken ones, which a server
     * that saves its settings as it runs may have written over the user's.
     */
    afterStop?(moves: readonly import("../service/ports").PortMove[]): Promise<void>;
    isMutating(): boolean;
    assertFileAccess?(path: unknown, write: boolean): Promise<void>;
    /** Writes the running world to disk and resolves once the game confirms it; refuses when offline. */
    saveWorld(): Promise<void>;
    stopEntry: string;
    stop(): Promise<void>;
    /** Checks a console command and gives what is sent: the stdin write, or for "rcon" the line itself. */
    commandLine(command: string): string;
    /** Publishes the console lines the game holds back (ConsoleBuffer); the exit calls it before it says anything. */
    flushConsole?(): void;
    /** Runs a console command when the game's control is "rcon", as commandLine gave it. */
    sendCommand?(command: string): Promise<void>;
    sendChat?(message: string): Promise<void>;
    observePartialLine?(line: string): void;
    observeLine(line: string, final?: boolean): void;
    portNames: readonly string[];
    ports(deps: PortDeps): AsyncIterable<PortSpec>;
    /**
     * How the server's folder is readied for a backup's copy, which is made
     * while the service keeps running. "quiesce": a running server keeps
     * going with its saving paused; "offline": it is saved and stopped.
     */
    backup: {
        mode: "quiesce" | "offline";
        /** Readies the folder for the copy; throwing refuses the backup, with nothing left paused or stopped. */
        before(): Promise<void>;
        /** Carries on once the copy is done, or failed: saving resumes, or the server `before` stopped starts again. */
        after(): Promise<void>;
    };
}
