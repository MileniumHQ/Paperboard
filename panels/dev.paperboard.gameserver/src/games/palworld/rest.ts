// Palworld's REST API: the dedicated server reads no console input, so every
// command goes here. It listens on RESTAPIPort under /v1/api with HTTP Basic
// auth, user "admin" and the server's AdminPassword. Paperboard only ever
// calls it on 127.0.0.1.

export interface PalworldPlayer {
    name: string;
    accountName: string;
    playerId: string;
    userId: string;
    ip: string;
    ping: number;
    level: number;
}

export interface PalworldInfo {
    version: string;
    servername: string;
    description: string;
    worldguid: string;
}

export interface PalworldMetrics {
    currentplayernum: number;
    maxplayernum: number;
    serverfps: number;
    /** the average over the last stretch, so one slow frame does not move it */
    serverfpsaverage: number;
    /** milliseconds the server took for its last frame */
    serverframetime: number;
    /** seconds since the server started */
    uptime: number;
    /** days passed in the game world */
    days: number;
    basecampnum: number;
}

const TIMEOUT_MS = 15_000;

export class PalworldRest {
    constructor(private readonly port: number, private readonly password: string) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Palworld's REST port is not a port: ${port}`);
        if (!password) throw new Error("Palworld's REST API needs the admin password");
    }

    private async request<T>(method: "GET" | "POST", endpoint: string, body?: Record<string, unknown>): Promise<T> {
        let response: Response;
        try {
            response = await fetch(`http://127.0.0.1:${this.port}/v1/api/${endpoint}`, {
                method,
                headers: {
                    Authorization: `Basic ${Buffer.from(`admin:${this.password}`).toString("base64")}`,
                    // Palworld refuses a POST without a length, so every POST carries a body
                    ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
                },
                body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (err) {
            throw new Error(`Palworld's REST API did not answer ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const text = await response.text();
        if (response.status === 401) throw new Error("Palworld refused Paperboard's admin password. Restart the server so it reads the current one.");
        if (!response.ok) throw new Error(`Palworld answered ${response.status} to ${endpoint}${text.trim() ? `: ${text.trim()}` : ""}`);
        if (method === "POST") return undefined as T;
        try {
            return JSON.parse(text) as T;
        } catch {
            throw new Error(`Palworld's ${endpoint} answer is not JSON`);
        }
    }

    info(): Promise<PalworldInfo> { return this.request("GET", "info"); }
    async metrics(): Promise<PalworldMetrics> {
        const answer = await this.request<Record<string, unknown>>("GET", "metrics");
        for (const key of ["currentplayernum", "maxplayernum", "serverfps", "serverfpsaverage", "serverframetime", "uptime", "days", "basecampnum"]) {
            if (typeof answer[key] !== "number") throw new Error(`Palworld's metrics answer has no ${key}`);
        }
        return answer as unknown as PalworldMetrics;
    }
    async players(): Promise<PalworldPlayer[]> {
        const answer = await this.request<{ players?: unknown }>("GET", "players");
        if (!Array.isArray(answer.players)) throw new Error("Palworld's player list has no players array");
        return answer.players.map((raw) => {
            const p = raw as Record<string, unknown>;
            if (typeof p.name !== "string" || typeof p.userId !== "string") throw new Error("Palworld listed a player without a name or user id");
            return {
                name: p.name,
                accountName: String(p.accountName ?? ""),
                playerId: String(p.playerId ?? ""),
                userId: p.userId,
                ip: String(p.ip ?? ""),
                ping: Number(p.ping ?? 0),
                level: Number(p.level ?? 0),
            };
        });
    }
    announce(message: string): Promise<void> { return this.request("POST", "announce", { message }); }
    kick(userid: string, message?: string): Promise<void> { return this.request("POST", "kick", { userid, ...(message ? { message } : {}) }); }
    ban(userid: string, message?: string): Promise<void> { return this.request("POST", "ban", { userid, ...(message ? { message } : {}) }); }
    unban(userid: string): Promise<void> { return this.request("POST", "unban", { userid }); }
    save(): Promise<void> { return this.request("POST", "save"); }
    /** Saves the world, then exits after `waittime` seconds. */
    shutdown(waittime: number, message: string): Promise<void> { return this.request("POST", "shutdown", { waittime, message }); }
}
