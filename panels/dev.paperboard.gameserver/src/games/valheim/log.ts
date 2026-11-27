// What the Valheim dedicated server says in its log, read line by line. The
// lines are the server's own (assembly_valheim, build 26949048, version
// 1.0.31): each begins with its time, "11/27/2026 02:26:47: ", which is left
// out here. The server reads no console input and has no remote console, so
// this is all Paperboard learns of a running server.
//
// Players: a connection names its account first ("Got connection SteamID
// <id>" on Steam, "PlayFab socket with remote ID <socket> received local
// Platform ID <id>" with crossplay), then the character it spawns names the
// player ("Got character ZDOID from <name> : <zdoid>"). Nothing prints both,
// so a character is matched with the oldest connection still waiting for one,
// in the order the server takes them. A death respawns with "0:0" and is not a
// join. Steam ends a connection with "Closing socket <id>"; crossplay keeps a
// lost one for a while ("Keep socket for <socket>, …") and takes it back
// ("Resume TX on <socket>"), so a kept one counts as gone until it resumes.

/** A player on the server: their name, and their platform id ("Steam_7656…") once the connection named it. */
export interface ValheimPlayer {
    name: string;
    id: string;
}

const STAMP = /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2}: /;
/** The line without the time the server puts before each of its own. */
export const withoutStamp = (line: string) => line.replace(STAMP, "");

export type ValheimEvent =
    | { kind: "joined"; player: ValheimPlayer }
    | { kind: "left"; player: ValheimPlayer }
    | { kind: "version"; version: string }
    | { kind: "join-code"; code: string; address: string | null }
    | { kind: "saved" }
    | { kind: "connected" }
    | { kind: "generating" }
    | { kind: "generated" }
    | { kind: "refused"; reason: string };

/**
 * One run's log: who is on, and what the lines meant. Made anew for each
 * start, so nothing of an earlier run carries over.
 */
export class ValheimLog {
    /** connections that named an account and spawned no character yet, oldest first */
    private waiting: { socket: string; id: string }[] = [];
    /** players on, by the socket their connection is */
    private on = new Map<string, ValheimPlayer>();
    /** crossplay connections kept after a loss, which may resume */
    private kept = new Map<string, ValheimPlayer>();

    online(): ValheimPlayer[] {
        return [...this.on.values()];
    }

    /** What the line meant, if anything. */
    read(raw: string): ValheimEvent[] {
        const line = withoutStamp(raw.replace(/\r/g, "")).trim();
        let m: RegExpExecArray | null;
        if ((m = /^Got connection SteamID (\d{17})$/.exec(line))) {
            this.waiting.push({ socket: m[1]!, id: `Steam_${m[1]}` });
            return [];
        }
        if ((m = /^PlayFab socket with remote ID (\S+) received local Platform ID (\S+)$/.exec(line))) {
            this.waiting.push({ socket: m[1]!, id: m[2]! });
            return [];
        }
        if ((m = /^Got character ZDOID from (.+) : (-?\d+):(\d+)$/.exec(line))) {
            const name = m[1]!;
            // a dead player's character is gone until they respawn
            if (m[2] === "0" && m[3] === "0") return [];
            if ([...this.on.values()].some((p) => p.name === name)) return [];
            const connection = this.waiting.shift();
            if (!connection) return [];
            const player = { name, id: connection.id };
            this.on.set(connection.socket, player);
            return [{ kind: "joined", player }];
        }
        if ((m = /^Closing socket (\S+)$/.exec(line))) return this.gone(m[1]!, false);
        if ((m = /^Keep socket for (\S+), try to reconnect before timeout$/.exec(line))) return this.gone(m[1]!, true);
        if ((m = /^Resume TX on (\S+)$/.exec(line))) {
            const player = this.kept.get(m[1]!);
            if (!player) return [];
            this.kept.delete(m[1]!);
            this.on.set(m[1]!, player);
            return [{ kind: "joined", player }];
        }
        if ((m = /^Valheim version: l?-?([\d.]+)/.exec(line))) return [{ kind: "version", version: m[1]! }];
        if ((m = /^Session ".*" registered with join code (\d+)$/.exec(line))) return [{ kind: "join-code", code: m[1]!, address: null }];
        if ((m = /^Session ".*" with join code (\d+) and IP (\S+) is active with \d+ player\(s\)$/.exec(line))) return [{ kind: "join-code", code: m[1]!, address: m[2]! }];
        if (/^World save \(5\/5\) done\./.test(line)) return [{ kind: "saved" }];
        if (line === "Game server connected") return [{ kind: "connected" }];
        if (line === "Loading: Generating locations") return [{ kind: "generating" }];
        // the server spells it "sinze"
        if (/^Loading: Done\. Total seconds sin[cz]e ZNet start/.test(line)) return [{ kind: "generated" }];
        if ((m = /^Error bad password:(.*)$/.exec(line))) return [{ kind: "refused", reason: m[1]!.trim() }];
        return [];
    }

    private gone(socket: string, mayResume: boolean): ValheimEvent[] {
        this.waiting = this.waiting.filter((c) => c.socket !== socket);
        const player = this.on.get(socket);
        if (!player) return [];
        this.on.delete(socket);
        if (mayResume) this.kept.set(socket, player);
        return [{ kind: "left", player }];
    }
}
