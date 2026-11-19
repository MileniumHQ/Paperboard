import { EventEmitter } from "events";
import * as os from "os";
import * as path from "path";
import { DEFAULT_PORT, getDetailedOsInfo, getNetworkIp } from "daemon";
import {
    readStateFileSync,
    writeJsonAtomicSync,
    sanitizeId,
} from "daemon/storage";
import { getLocalDir } from "daemon/paths";
import { logger } from "daemon/logger";
import { certFingerprint, pinnedRequest } from "daemon/pinnedTls";
import { readTlsCert } from "daemon/tlsIdentity";
import { bareHost, bracketHost, checkProbeTarget, isLoopback } from "./probeTarget";
import { PaperCraneClient } from "./PaperCraneClient";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { ComputerInfo } from "../../../shared/shellContract";

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

// timeout = lost in transit, refusal = nothing listening there
export function classifyProbeError(err: any): string {
    const msg = String(err?.message || "");
    if (err?.name === "TimeoutError" || /aborted|timeout/i.test(msg)) {
        return "Timed out with no response. The computer may be offline, on a different network, or its firewall is blocking the Paperboard server daemon";
    }
    const code = (err as any)?.cause?.code || (err as any)?.code;
    if (code === "ECONNREFUSED") {
        return "Connection refused. The Paperboard server daemon isn't running on that computer";
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return "Host not found. Check the address";
    }
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
        return "Network unreachable. Is this device on the same network?";
    }
    if (isPlaintextAnswer(err)) return NOT_THE_DAEMON;
    return msg || "Unreachable";
}

const NOT_THE_DAEMON = "Something other than Paperboard answered there. Check the port";
// a daemon started with --host 127.0.0.1 serves plain HTTP, which only this computer's own app may use
const LOOPBACK_DAEMON = "That server only accepts this computer. Start it with --host 0.0.0.0";

const OWN_DAEMON = "That's this computer's own Paperboard server, not another computer";

/** a plain (unencrypted) server answered where a paired daemon's TLS was expected */
function isPlaintextAnswer(err: any): boolean {
    const code = err?.cause?.code || err?.code;
    return code === "EPROTO" || /SSL|TLS|WRONG_VERSION_NUMBER/.test(String(err?.message || ""));
}

const LOCAL_COMPUTER_NAME = "This Computer";
const COMPUTER_NAME_MAX = 64;

// a name is shown on the rail and in every header; blank or huge is refused
export function checkComputerName(name: unknown): string {
    if (typeof name !== "string") throw new Error("A computer name must be text.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A computer needs a name.");
    if (trimmed.length > COMPUTER_NAME_MAX) {
        throw new Error(`A computer name can be at most ${COMPUTER_NAME_MAX} characters.`);
    }
    return trimmed;
}

// every computer, including local, is served by a daemon
export class ConnectionPool extends EventEmitter {
    private computers: Map<string, StoredComputer> = new Map();
    private clients: Map<string, PaperCraneClient> = new Map();
    private activeId: string = "local";
    private configPath: string;
    /** resolves once this computer's record carries its OS details, or to why it can't */
    public readonly localRecorded: Promise<string | null>;

    constructor() {
        super();
        this.configPath = path.join(getLocalDir(), "paired_computers.json");
        this.loadConfig();
        this.localRecorded = this.ensureLocalComputer();
    }

    public async init(): Promise<void> {
        // warm local daemon so panels find a live endpoint
        try {
            await this.getClient("local").connect("127.0.0.1");
        } catch (err) {
            // the rail shows this computer offline, with the reason
            logger.warn("[ConnectionPool] the local Paperboard server is not answering yet:", err);
        }
        const failure = await this.localRecorded;
        if (failure) throw new Error(`This computer's OS details couldn't be read: ${failure}`);
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
                // a pairing kept before hosts were stored bare may say "[::1]"
                this.computers.set(id, { ...c, id, host: bareHost(c.host) });
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

    // this computer is always listed, so a failure to read its OS details
    // (init() throws it) never turns into "Unknown computer: local"
    private ensureLocalComputer(): Promise<string | null> {
        const localComp: StoredComputer = {
            id: "local",
            // a name the person gave this computer outlives the refresh
            name: this.computers.get("local")?.name || LOCAL_COMPUTER_NAME,
            host: "127.0.0.1",
            port: DEFAULT_PORT,
            isLocal: true,
            arch: os.arch(),
        };
        this.computers.set("local", localComp);
        return getDetailedOsInfo().then((info) => {
            Object.assign(localComp, {
                os: info.os,
                osVersion: info.osVersion,
                distroId: info.distroId,
                distroName: info.distroName,
            });
            return null;
        }, (err) => errorMessage(err));
    }

    // never a default id: operations must not land on the wrong machine.
    // The first ask connects.
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

    public getActiveId(): string {
        return this.activeId;
    }

    /**
     * Running panel services across every connected computer, for the tray.
     * A paired remote that is offline runs nothing reachable and is skipped;
     * the local daemon, or a connected computer that fails to answer, still
     * fails the count.
     */
    public async runningServiceCount(): Promise<number> {
        let total = 0;
        for (const client of this.clients.values()) {
            const status = client.getStatus();
            if (status.isRemote && !status.connected) continue;
            total += await client.runningServiceCount();
        }
        return total;
    }

    public setActive(id: string): boolean {
        if (!this.computers.has(id)) return false;
        const previous = this.activeId;
        this.activeId = id;
        try { this.saveConfig(); }
        catch (err) { this.activeId = previous; throw err; }
        this.getClient(id);
        this.emit("change");
        return true;
    }

    /** what the shell shows of each computer: never a pairing's token or pinned certificate */
    public listComputers(): ComputerInfo[] {
        return Array.from(this.computers.values()).map(({ token: _token, cert: _cert, ...c }) => {
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

    // the updater's fan-out: `visit` on every paired computer, eight at a time
    public async forEachComputer(visit: (computer: { id: string; name: string }) => Promise<void>): Promise<void> {
        const computers = this.listAll();
        for (let offset = 0; offset < computers.length; offset += 8) {
            await Promise.all(computers.slice(offset, offset + 8).map(visit));
        }
    }

    // port arrives as typed, so a bad one is an answer, not a quiet default
    public async probe(
        host: string,
        port: number | string = DEFAULT_PORT,
    ): Promise<{ reachable: boolean; hostname?: string; error?: string; invalidAddress?: boolean }> {
        const checked = checkProbeTarget(host, port);
        if ("error" in checked) return checked;
        try {
            // reachability only: no credential crosses this request, so the
            // not-yet-pinned certificate is not checked here
            const res = await pinnedRequest(`https://${bracketHost(host)}:${checked.port}/health`, null, { timeoutMs: 2000 });
            if (res.ok) {
                // /health carries liveness + version only; hostname arrives
                // over the authenticated pair/verify handshake instead
                return { reachable: true };
            }
            // the daemon always answers /health with 200, so any other
            // status came from a different server on that port
            return {
                reachable: false,
                error: `Something other than the Paperboard server daemon answered on that port (HTTP ${res.status}). Check the port number`,
            };
        } catch (err: any) {
            return { reachable: false, error: isLoopback(host) && isPlaintextAnswer(err) ? LOOPBACK_DAEMON : classifyProbeError(err) };
        }
    }

    // the address, port and name are checked as probe and updateComputer
    // check them: a record saved with a bad port is skipped on the next
    // load, which loses the pairing
    public async pairComputer(
        host: string,
        port: number | string = DEFAULT_PORT,
        code: string,
        customName?: unknown,
    ): Promise<StoredComputer> {
        const checked = checkProbeTarget(host, port);
        if ("error" in checked) throw new Error(checked.error);
        const name = customName === undefined ? undefined : checkComputerName(customName);
        // kept as sockets dial it: "[::1]" as typed is ::1
        host = bareHost(host);
        const tempClient = new PaperCraneClient();
        try {
            await tempClient.connectForPairing(host, checked.port);
            const cert = tempClient.getCert();
            if (!cert) throw new Error("Pairing failed: the computer presented no certificate");
            // who answered is told by its certificate, never by the address:
            // an ssh tunnel and this computer's own daemon share 127.0.0.1
            const own = readTlsCert(getLocalDir());
            if (own && certFingerprint(own) === certFingerprint(cert)) throw new Error(OWN_DAEMON);
            // send our hostname, never the server name; customName stays local-only
            const pairRes = await tempClient.pair(code, os.hostname().replace(/\.local$/i, "") || "Paperboard App");
            if (!pairRes.success || !pairRes.token) {
                throw new Error("Pairing rejected: invalid code or daemon refused");
            }

            // explicit identity: millisecond timestamps collide; a random
            // suffix keeps two paired-in-a-blink computers distinct
            const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const comp: StoredComputer = {
                id,
                name: name || pairRes.hostname || host,
                host,
                port: checked.port,
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
                throw new Error(`Paired, but this computer could not save the pairing: ${errorMessage(err)}`);
            }
            this.getClient(id);
            this.emit("change");
            return comp;
        } catch (err) {
            tempClient.disconnect();
            throw err;
        }
    }

    // the name the rail and every header show; false for a computer that's gone
    public renameComputer(id: string, name: unknown): boolean {
        const checked = checkComputerName(name);
        const comp = this.computers.get(id);
        if (!comp) return false;
        const before = comp.name;
        comp.name = checked;
        try { this.saveConfig(); }
        catch (err) {
            comp.name = before;
            throw err;
        }
        this.emit("change");
        return true;
    }

    /**
     * The rail's order, which is the order of the paired computers file.
     * The ids must be exactly the stored computers: a list that drops or
     * invents one is refused, so a stale renderer can never lose a pairing.
     */
    public reorderComputers(ids: string[]): void {
        const current = Array.from(this.computers.keys());
        const unique = new Set(ids);
        if (unique.size !== ids.length || ids.length !== current.length || current.some((id) => !unique.has(id))) {
            throw new Error("The computer list changed while you were reordering it. Try again.");
        }
        const before = new Map(this.computers);
        this.computers = new Map(ids.map((id) => [id, before.get(id)!]));
        try { this.saveConfig(); }
        catch (err) {
            this.computers = before;
            throw err;
        }
        this.emit("change");
    }

    /**
     * Forgets a paired computer, first asking it to forget this one's key.
     * Resolves to why it couldn't be asked, with nothing forgotten: it would
     * keep trusting a key nobody here remembers, so forgetting it anyway is
     * the person's call (`evenIfUntold`). Null once it's forgotten.
     */
    public async unpairComputer(id: string, evenIfUntold = false): Promise<string | null> {
        if (id === "local") throw new Error("This computer can't be forgotten.");
        const comp = this.computers.get(id);
        if (!comp) throw new Error("Paperboard doesn't know this computer anymore.");
        const client = this.clients.get(id);
        if (comp.token && !evenIfUntold) {
            try {
                if (!client) throw new Error("it isn't connected");
                await client.call("auth:revoke-self", {}, 5000);
            } catch (err) {
                logger.warn(`[ConnectionPool] ${id} wasn't told it is forgotten:`, err);
                return errorMessage(err);
            }
        }
        if (client) {
            client.disconnect();
            this.clients.delete(id);
        }
        this.computers.delete(id);
        const previousActive = this.activeId;
        if (this.activeId === id) this.activeId = "local";
        try { this.saveConfig(); }
        catch (err) {
            // disk still lists it: memory must too, or it reappears on
            // the next launch without anyone having been told
            this.computers.set(id, comp);
            this.activeId = previousActive;
            throw err;
        }
        this.emit("change");
        return null;
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
    }
}

export const connectionPool = new ConnectionPool();
export default connectionPool;
