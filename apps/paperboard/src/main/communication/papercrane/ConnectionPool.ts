import { EventEmitter } from "events";
import * as os from "os";
import * as path from "path";
import { DEFAULT_PORT } from "../../../../papercrane";
import {
    readJsonFileSync,
    writeJsonAtomicSync,
    sanitizeId,
} from "../../../../papercrane/storage";
import { getLocalDir } from "../../../../papercrane/paths";
import { getLinuxDistroInfo } from "../../../../papercrane/util";
import { logger } from "../../../../papercrane/logger";
import { PaperCraneClient } from "./PaperCraneClient";
import type { ComputerDriver } from "../driver/ComputerDriver";
import { RemoteComputerDriver } from "../driver/RemoteComputerDriver";

export interface StoredComputer {
    id: string;
    name: string;
    host: string;
    port: number;
    token?: string;
    os?: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch?: string;
    isLocal?: boolean;
}

// Every computer, including "local", is served by a PaperCrane daemon
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
        this.ensureLocalComputer();
    }

    public async init(): Promise<void> {
        this.ensureLocalComputer();
        // Warm the local daemon so panels find a live endpoint immediately
        try {
            await this.getClient("local").connect("127.0.0.1");
        } catch {}
    }

    private loadConfig() {
        const raw = readJsonFileSync<{
            activeId?: string;
            computers?: StoredComputer[];
        }>(this.configPath, {});
        this.activeId = raw.activeId || "local";
        if (Array.isArray(raw.computers)) {
            for (const c of raw.computers) {
                // Skip entries with unsafe ids or missing host/port so a
                // corrupt record can't poison the pool
                if (!c || typeof c !== "object") continue;
                const id = sanitizeId(c.id);
                if (!id) continue;
                if (typeof c.host !== "string" || !c.host) continue;
                if (typeof c.port !== "number" || !Number.isFinite(c.port)) continue;
                this.computers.set(id, { ...c, id });
            }
        }
    }

    private saveConfig() {
        try {
            const data = {
                activeId: this.activeId,
                computers: Array.from(this.computers.values()),
            };
            writeJsonAtomicSync(this.configPath, data);
        } catch (err) {
            logger.warn("[ConnectionPool] failed to save paired computers:", err);
        }
    }

    private ensureLocalComputer() {
        const plat = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
        const distro = getLinuxDistroInfo();
        const localComp: StoredComputer = {
            id: "local",
            name: "This Computer",
            host: "127.0.0.1",
            port: DEFAULT_PORT,
            isLocal: true,
            os: plat,
            osVersion: os.release(),
            distroId: distro.distroId,
            distroName: distro.distroName,
            arch: os.arch(),
        };

        this.computers.set("local", localComp);
    }

    // Returns active driver (always crane-backed)
    public getActiveDriver(): ComputerDriver {
        return this.getDriver(this.activeId);
    }

    // Never default to the active computer — operations must not land on
    // the wrong machine.
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
                // Credentials resolved internally via crane.json/embedded
                client.connect("127.0.0.1", undefined as never).catch(() => {});
            } else {
                client.connect(comp.host, comp.port, comp.token).catch(() => {});
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
        this.activeId = id;
        this.getDriver(id);
        this.saveConfig();
        this.emit("change");
        return true;
    }

    public listComputers(): (StoredComputer & { status: any })[] {
        return Array.from(this.computers.values()).map((c) => {
            const client = this.clients.get(c.id);
            const status =
                c.id === "local"
                    ? client?.getStatus() ?? { connected: false, isRemote: false, host: "127.0.0.1", port: DEFAULT_PORT }
                    : client
                      ? client.getStatus()
                      : { connected: false, isRemote: true, host: c.host, port: c.port };
            return { ...c, status };
        });
    }

    /** Returns all known computers as plain { id, name } entries — used by the updater. */
    public listAll(): { id: string; name: string }[] {
        return Array.from(this.computers.values()).map(({ id, name }) => ({ id, name }));
    }

    public async probe(
        host: string,
        port = DEFAULT_PORT,
    ): Promise<{ reachable: boolean; hostname?: string; error?: string }> {
        try {
            const url = `http://${host}:${port}/health`;
            const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const data = (await res.json()) as any;
                return { reachable: true, hostname: data.hostname };
            }
            return { reachable: false, error: `HTTP ${res.status}` };
        } catch (err: any) {
            return { reachable: false, error: err.message || "Unreachable" };
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
            await tempClient.connect(host, port);
            const pairRes = await tempClient.pair(code, customName || `Paperboard App`);
            if (!pairRes.success || !pairRes.token) {
                throw new Error("Pairing rejected: invalid code or daemon refused");
            }

            const id = `remote-${Date.now()}`;
            const comp: StoredComputer = {
                id,
                name: customName || pairRes.hostname || host,
                host,
                port,
                token: pairRes.token,
                os: pairRes.os,
                osVersion: pairRes.osVersion,
                distroId: pairRes.distroId,
                distroName: pairRes.distroName,
                arch: pairRes.arch,
                isLocal: false,
            };

            this.computers.set(id, comp);
            this.clients.set(id, tempClient);
            this.remoteDrivers.set(id, new RemoteComputerDriver(id, tempClient));
            this.saveConfig();
            this.emit("change");
            return comp;
        } catch (err) {
            tempClient.disconnect();
            throw err;
        }
    }

    public updateComputer(id: string, updates: Partial<StoredComputer>): boolean {
        const comp = this.computers.get(id);
        if (!comp) return false;
        Object.assign(comp, updates);
        this.saveConfig();
        this.emit("change");
        return true;
    }

    public removeComputer(id: string): boolean {
        return this.unpairComputer(id);
    }

    public unpairComputer(id: string): boolean {
        if (id === "local") return false;
        const client = this.clients.get(id);
        if (client) {
            client.disconnect();
            this.clients.delete(id);
        }
        this.remoteDrivers.delete(id);
        const removed = this.computers.delete(id);
        if (removed) {
            if (this.activeId === id) {
                this.activeId = "local";
            }
            this.saveConfig();
            this.emit("change");
        }
        return removed;
    }

    public getComputer(id: string): StoredComputer | undefined {
        return this.computers.get(id);
    }

    // Remote supervised processes intentionally survive
    public dispose(): void {
        for (const client of this.clients.values()) {
            // Stop embedded daemons so their supervised children terminate
            client.stopEmbeddedServer();
            client.disconnect();
        }
        this.clients.clear();
        this.remoteDrivers.clear();
    }
}

export const connectionPool = new ConnectionPool();
export default connectionPool;
