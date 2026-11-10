/** Service-only module contract. Never imported as a value by renderers. */
import type { ActionDefinition, ServiceContext } from "../service/api";
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
    write(port: number): Promise<void>;
}
type Context = ServiceContext<GameServerState>;
export interface GameService {
    initialState(): GameServerState;
    actions(): Promise<readonly ActionDefinition[]>;
    /** The game's own blocks for the Blocks panel, beside the ones every game shares; its joins, leaves and chat among them. */
    blocks?(ctx: Context): Promise<import("@mileniumhq/paperapi").BlockSet>;
    /** The Blocks types the game's own blocks use; the panel registers them. */
    blockTypes?(): Promise<import("@mileniumhq/paperapi").BlockTypeDefinition[]>;
    initialize(ctx: Context, running: boolean): Promise<void>;
    dispose(): Promise<void>;
    beforeRemove(): Promise<void>;
    /** Asks the game's download source whether a newer build than the installed one is out; Steam games have it. Throws when the source cannot be asked. */
    updateStatus?(ctx: Context): Promise<import("./steam/installAction").SteamUpdateStatus>;
    /** Installs the newest build over a stopped server; with updateStatus, the server can update itself. */
    installUpdate?(ctx: Context): Promise<void>;
    /** The server's own icon, for games that have one. */
    readIcon?(): Promise<string | null>;
    primaryProcessId: string;
    customTypes?(): Promise<import("../service/api").CustomTypeDefinition[]>;
    readiness?: { timeoutMs: number; probe(ctx: Context): Promise<boolean> };
    stopTimeoutMs?: number;
    processIds: readonly string[];
    /** Top-level folders of the server left out of its backups and kept on restore, such as a downloaded game install. */
    backupExclude?: readonly string[];
    /** File names left out of its backups wherever they are, such as a lock the running server holds. */
    backupSkip?: readonly string[];
    loadOptions(ctx: Context): Promise<void>;
    prepareLaunch(ctx: Context): Promise<PreparedLaunch>;
    /**
     * Runs once the server's process is gone, however it went: stopped,
     * crashed, killed, or never started because the launch failed. A game
     * takes back what prepareLaunch set aside for the start, such as secrets
     * written into its settings files. It can run again for a server it
     * already cleaned up, and a restart waits for it before starting again.
     */
    afterStop?(ctx: Context): Promise<void>;
    isMutating(): boolean;
    assertFileAccess?(ctx: Context, path: unknown, write: boolean): Promise<void>;
    /** Writes the running world to disk and resolves once the game confirms it; refuses when offline. */
    saveWorld(ctx: Context): Promise<void>;
    stopEntry: string;
    stop(ctx: Context): Promise<void>;
    /** Checks a console command and gives what is sent: the stdin write, or for "rcon" the line itself. */
    commandLine(command: string): string;
    /** Runs a console command when the game's control is "rcon", as commandLine gave it. */
    sendCommand?(ctx: Context, command: string): Promise<void>;
    sendChat?(ctx: Context, message: string): Promise<void>;
    observePartialLine?(ctx: Context, line: string): void;
    observeLine(ctx: Context, line: string, final?: boolean): void;
    portNames: readonly string[];
    ports(ctx: Context, deps: PortDeps): AsyncIterable<PortSpec>;
    backup: {
        mode: "quiesce" | "offline";
        before(ctx: Context): Promise<void>;
        recover(): Promise<unknown>;
        withConsistentData<T>(ctx: Context, work: () => Promise<T>): Promise<T>;
    };
}
