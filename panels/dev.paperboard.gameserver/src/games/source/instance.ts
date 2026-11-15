// One server's part of a Source game: what its jobs (config files, maps,
// SourceMod, players, launch) share about the server while it runs. Each job
// is a module that is handed this.
import path from "node:path";
import type { Server } from "../../service/server";
import type { GameDefinition } from "../types";
import { ConsoleBuffer, serverSecret, settled } from "../serviceKit";
import type { SourceGameSpec } from "./index";
import { optionValue } from "./config";
import { isErrorLine, isSteamId, steamId as checkedSteamId } from "./log";
import type { SourceRcon } from "./rcon";
import type { SourceRoster } from "./roster";
import { SourcePlayers } from "./people";

export class SourceGame {
    readonly spec: SourceGameSpec;
    readonly definition: GameDefinition;
    readonly server: Server;
    /** the server's one process */
    readonly processId: string;
    /** an install, update or backup is under way */
    busy = false;
    /** the RCON connection of the run under way, or the one reattached to */
    connection: SourceRcon | null = null;
    /** Paperboard's players and bans of the server, once it is set up */
    loadedRoster: SourceRoster | null = null;
    /** the passwords the run under way started with, hidden from its console */
    secrets: string[] = [];
    readonly console = new ConsoleBuffer(isErrorLine);
    /** SourceMod loaded with the running server */
    modsActive = false;
    modsBusy = false;
    readonly players: SourcePlayers;
    readonly joinPassword: ReturnType<typeof serverSecret>;
    readonly rconPassword: ReturnType<typeof serverSecret>;
    readonly loginToken: ReturnType<typeof serverSecret>;
    /** Options kept in the vault, by option id. */
    readonly vaulted: readonly (readonly [string, ReturnType<typeof serverSecret>])[];

    constructor(spec: SourceGameSpec, definition: GameDefinition, server: Server) {
        this.spec = spec;
        this.definition = definition;
        this.server = server;
        this.processId = `${spec.id}-server`;
        this.joinPassword = serverSecret(server, spec.id, "join-password");
        this.rconPassword = serverSecret(server, spec.id, "rcon-password");
        this.loginToken = serverSecret(server, spec.id, "login-token");
        this.vaulted = [["password", this.joinPassword], ["rconPassword", this.rconPassword], ["token", this.loginToken]];
        this.players = new SourcePlayers(this);
    }

    // Layout: install/ is SteamCMD's folder, left out of backups; Paperboard's
    // players, bans, logs and the user's own server.cfg sit beside it.
    async installDir(): Promise<string> {
        return path.join(await this.server.root(), "install");
    }
    async gameDir(): Promise<string> {
        return path.join(await this.installDir(), this.spec.gameDir);
    }
    async cfgDir(): Promise<string> {
        return path.join(await this.gameDir(), "cfg");
    }

    rcon(): SourceRcon {
        const client = this.connection;
        if (!client) throw new Error(`${this.spec.name} is not running`);
        return client;
    }
    roster(): SourceRoster {
        const roster = this.loadedRoster;
        if (!roster) throw new Error(`${this.spec.name}'s player list is not ready`);
        return roster;
    }
    /** True when online, false when offline; starting or stopping refuses. */
    online(): boolean {
        return settled(this.server, this.spec.name);
    }
    steamId(value: unknown): string {
        return checkedSteamId(value, this.spec.steamIds);
    }
    isPlayer(id: string): boolean {
        return isSteamId(id, this.spec.steamIds);
    }
    refuseWhileBusy(): void {
        if (this.busy) throw new Error(`Wait for the ${this.spec.name} operation to finish`);
    }

    async loadOptions(): Promise<void> {
        const saved = this.server.settings;
        const values: Record<string, unknown> = {};
        for (const option of this.spec.options) {
            if (option.kind === "secret") continue;
            const value = optionValue(option, saved);
            if (value !== undefined) values[option.id] = value;
        }
        for (const [id, secret] of this.vaulted) values[id] = await secret.found();
        this.server.setState({ serverSoftware: this.spec.id, serverVersion: saved.build ? `Build ${saved.build}` : "", serverPort: String(values.port ?? this.spec.defaultPort), gameSettings: values });
    }
}
