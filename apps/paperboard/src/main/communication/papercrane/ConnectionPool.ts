import { EventEmitter } from "events";
import * as os from "os";
import * as path from "path";
import { DEFAULT_PORT, getDetailedOsInfo, getNetworkIp } from "../../../../papercrane";
import {
    readStateFileSync,
    writeJsonAtomicSync,
    sanitizeId,
} from "../../../../papercrane/storage";
import { getLocalDir } from "../../../../papercrane/paths";
import { logger } from "../../../../papercrane/logger";
import { pinnedRequest } from "../../../../papercrane/pinnedTls";
import { PaperCraneClient } from "./PaperCraneClient";
import type { ComputerDriver } from "../driver/ComputerDriver";
import { RemoteComputerDriver } from "../driver/RemoteComputerDriver";

export interface StoredComputer {
    id: string;
    name: string;
    host: string;
    port: number;
    token?: string;
    // remote daemon certificate, pinned at pairing (remote computers only)
    cert?: string;
    os?: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch?: string;
    isLocal?: boolean;
}

function bracketHost(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

// timeout = lost in transit, refusal = nothing listening there
export function classifyProbeError(err: any): string {
    const msg = String(err?.message || "");
    if (err?.name === "TimeoutError" || /aborted|timeout/i.test(msg)) {
        return "Timed out with no response. The computer may be offline, on a different network, or its firewall is blocking the Paperboard Server daemon";
    }
    const code = (err as any)?.cause?.code || (err as any)?.code;
    if (code === "ECONNREFUSED") {
        return "Connection refused. The Paperboard Server daemon isn't running on that computer";
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return "Host not found. Check the address";
    }
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
        return "Network unreachable. Is this device on the same network?";
    }
    return msg || "Unreachable";
}

// every computer, including local, is served by a daemon
export class ConnectionPool extends EventEmitter {
    private computers: Map<string, StoredComputer> = new Map();
    private clients: Map<string, PaperCraneClient> = new Map();
    private remoteDrivers: Map<string, RemoteComputerDriver> = new Map();
    private activeId: string = "local";
    private configPath: string;

    constructor() {
        super();
        this.configPath = path.join(getLocalDir(), "paired_computers.json");
        this.loadConfig();
        // fire-and-forget here is safe: init() awaits the same idempotent
        // refresh below before the pool is used; the local record's
        // identity fields only ever refine
        void this.ensureLocalComputer();
    }

    public async init(): Promise<void> {
        await this.ensureLocalComputer();
        // warm local daemon so panels find a live endpoint
        try {
            await this.getClient("local").connect("127.0.0.1");
        } catch (err) { logger.debug("[ConnectionPool.ts] op failed:", err) }
    }

    private loadConfig() {
        // corrupt = quarantined (paired tokens and pinned certs kept for
        // recovery), never read as "no computers" and overwritten
        const raw = readStateFileSync<{
            activeId?: string;
            computers?: StoredComputer[];
        }>(this.configPath, {}, "paired computers") ?? {};
        this.activeId = raw.activeId || "local";
        if (Array.isArray(raw.computers)) {
            for (const c of raw.computers) {
                // skip corrupt records so one bad entry can't poison the pool
                if (!c || typeof c !== "object") continue;
                const id = sanitizeId(c.id);
                if (!id) continue;
                if (typeof c.host !== "string" || !c.host) continue;
                if (typeof c.port !== "number" || !Number.isFinite(c.port)) continue;
                this.computers.set(id, { ...c, id });
            }
        }
    }

    // throws: a pairing, rename or removal that was not saved must not
    // report success (the caller's IPC answer carries the failure)
    private saveConfig() {
        const data = {
            activeId: this.activeId,
            computers: Array.from(this.computers.values()),
        };
        writeJsonAtomicSync(this.configPath, data, { mode: 0o600 });
    }

    private async ensureLocalComputer() {
        const info = await getDetailedOsInfo();
        const localComp: StoredComputer = {
            id: "local",
            name: "This Computer",
            host: "127.0.0.1",
            port: DEFAULT_PORT,
            isLocal: true,
            os: info.os,
            osVersion: info.osVersion,
            distroId: info.distroId,
            distroName: info.distroName,
            arch: os.arch(),
        };

        this.computers.set("local", localComp);
    }

    public getActiveDriver(): ComputerDriver {
        return this.getDriver(this.activeId);
    }

    // never default id — operations must not land on wrong machine
    public getDriver(id: string): ComputerDriver {
        let remoteDriver = this.remoteDrivers.get(id);
        if (!remoteDriver) {
            const client = this.getClient(id);
            remoteDriver = new RemoteComputerDriver(id, client);
            this.remoteDrivers.set(id, remoteDriver);
        }
        return remoteDriver;
    }

    public getClient(id: string): PaperCraneClient {
        const comp = this.computers.get(id);
        if (!comp) throw new Error(`Unknown computer: ${id}`);
        let client = this.clients.get(id);
        if (!client) {
            client = new PaperCraneClient();
            client.on("status", () => this.emit("change"));
            this.clients.set(id, client);
            if (id === "local") {
                // credentials resolved internally via handshake/embedded
                client.connect("127.0.0.1").catch((err) => logger.debug("[ConnectionPool] local connect failed:", err));
            } else {
                client.connect(comp.host, comp.port, comp.token, comp.cert).catch((err) => logger.debug("[ConnectionPool] remote connect failed:", err));
            }
        }
        return client;
    }

    public getActiveClient(): PaperCraneClient {
        return this.getClient(this.activeId);
    }

    public getActiveId(): string {
        return this.activeId;
    }

    public setActive(id: string): boolean {
        if (!this.computers.has(id)) return false;
        const previous = this.activeId;
        this.activeId = id;
        try { this.saveConfig(); }
        catch (err) { this.activeId = previous; throw err; }
        this.getDriver(id);
        this.emit("change");
        return true;
    }

    public listComputers(): (StoredComputer & { status: any; networkAddress?: string })[] {
        return Array.from(this.computers.values()).map((c) => {
            const client = this.clients.get(c.id);
            const status =
                c.id === "local"
                    ? client?.getStatus() ?? { connected: false, isRemote: false, host: "127.0.0.1", port: DEFAULT_PORT }
                    : client
                      ? client.getStatus()
                      : { connected: false, isRemote: true, host: c.host, port: c.port };
            // the local daemon is dialed on loopback, which is no address
            // another machine can use; remote hosts are already the address
            // they were paired with. Computed per call: it follows the network.
            return { ...c, status, ...(c.id === "local" ? { networkAddress: getNetworkIp() } : {}) };
        });
    }

    // plain {id,name} list for updater
    public listAll(): { id: string; name: string }[] {
        return Array.from(this.computers.values()).map(({ id, name }) => ({ id, name }));
    }

    public async probe(
        host: string,
        port = DEFAULT_PORT,
    ): Promise<{ reachable: boolean; hostname?: string; error?: string }> {
        try {
            // reachability only: no credential crosses this request, so the
            // not-yet-pinned certificate is not checked here
            const res = await pinnedRequest(`https://${bracketHost(host)}:${port}/health`, null, { timeoutMs: 2000 });
            if (res.ok) {
                // /health carries liveness + version only; hostname arrives
                // over the authenticated pair/verify handshake instead
                return { reachable: true };
            }
            return { reachable: false, error: `HTTP ${res.status}` };
        } catch (err: any) {
            return { reachable: false, error: classifyProbeError(err) };
        }
    }

    public async pairComputer(
        host: string,
        port = DEFAULT_PORT,
        code: string,
        customName?: string,
    ): Promise<StoredComputer> {
        const tempClient = new PaperCraneClient();
        try {
            await tempClient.connectForPairing(host, port);
            // send our hostname, never the server name; customName stays local-only
            const pairRes = await tempClient.pair(code, os.hostname().replace(/\.local$/i, "") || "Paperboard App");
            if (!pairRes.success || !pairRes.token) {
                throw new Error("Pairing rejected: invalid code or daemon refused");
            }
            const cert = tempClient.getCert();
            if (!cert) throw new Error("Pairing failed: the computer presented no certificate");

            // explicit identity: millisecond timestamps collide; a random
            // suffix keeps two paired-in-a-blink computers distinct
            const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const comp: StoredComputer = {
                id,
                name: customName || pairRes.hostname || host,
                host,
                port,
                token: pairRes.token,
                cert,
                os: pairRes.os,
                osVersion: pairRes.osVersion,
                distroId: pairRes.distroId,
                distroName: pairRes.distroName,
                arch: pairRes.arch,
                isLocal: false,
            };

            // the pairing socket trusted whatever certificate it was shown;
            // from here on the computer is dialed pinned, by a client that
            // reconnects on its own
            tempClient.disconnect();
            this.computers.set(id, comp);
            try { this.saveConfig(); }
            catch (err) {
                // the remote issued a token we could not keep: say so, and
                // keep memory equal to disk (the pairing did not stick here)
                this.computers.delete(id);
                throw new Error(`Paired, but this computer could not save the pairing: ${err instanceof Error ? err.message : String(err)}`);
            }
            this.getDriver(id);
            this.emit("change");
            return comp;
        } catch (err) {
            tempClient.disconnect();
            throw err;
        }
    }

    public updateComputer(id: string, updates: Partial<StoredComputer>): boolean {
        // validate at the boundary that owns the record: a bad port through
        // computer-update previously poisoned the persisted record until
        // the next session's loader silently skipped it
        if (
            updates.port !== undefined &&
            (!Number.isFinite(updates.port) || updates.port < 1 || updates.port > 65535)
        ) {
            logger.warn(`[ConnectionPool] refusing invalid port ${JSON.stringify(updates.port)} for ${id}`);
            return false;
        }
        const comp = this.computers.get(id);
        if (!comp) return false;
        const before = { ...comp };
        Object.assign(comp, updates);
        try { this.saveConfig(); }
        catch (err) {
            this.computers.set(id, before);
            throw err;
        }
        this.emit("change");
        return true;
    }

    public async removeComputer(id: string): Promise<boolean> {
        return this.unpairComputer(id);
    }

    public async unpairComputer(id: string): Promise<boolean> {
        if (id === "local") return false;
        const comp = this.computers.get(id);
        // best-effort remote forget; local forget always proceeds
        if (comp?.token) {
            try {
                const client = this.clients.get(id);
                if (client) {
                    await client.call("auth:revoke-self", {}, 5000);
                }
            } catch (err) {
                logger.debug("[ConnectionPool] best-effort remote forget failed:", err);
            }
        }
        const client = this.clients.get(id);
        if (client) {
            client.disconnect();
            this.clients.delete(id);
        }
        this.remoteDrivers.delete(id);
        const removedRecord = this.computers.get(id);
        const removed = this.computers.delete(id);
        if (removed) {
            const previousActive = this.activeId;
            if (this.activeId === id) {
                this.activeId = "local";
            }
            try { this.saveConfig(); }
            catch (err) {
                // disk still lists it: memory must too, or it reappears on
                // the next launch without anyone having been told
                this.computers.set(id, removedRecord!);
                this.activeId = previousActive;
                throw err;
            }
            this.emit("change");
        }
        return removed;
    }

    // the machine woke or the network changed: recheck every computer now
    public wake(): void {
        for (const client of this.clients.values()) client.wake();
    }

    public getComputer(id: string): StoredComputer | undefined {
        return this.computers.get(id);
    }

    // remote supervised processes intentionally survive
    public dispose(): void {
        for (const client of this.clients.values()) {
            // stop embedded daemons so supervised children terminate
            client.stopEmbeddedServer();
            client.disconnect();
        }
        this.clients.clear();
        this.remoteDrivers.clear();
    }
}

export const connectionPool = new ConnectionPool();
export default connectionPool;
