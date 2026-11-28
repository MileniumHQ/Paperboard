import { EventEmitter } from "events";
import * as os from "os";
import * as path from "path";
import { DEFAULT_PORT, getNetworkIp } from "daemon";
import { readStateFileSync, writeJsonAtomicSync } from "daemon/core/storage";
import { getLocalDir } from "daemon/core/paths";
import { logger } from "daemon/core/logger";
import { certFingerprint, pinnedRequest } from "daemon/security/pinnedTls";
import { readTlsCert } from "daemon/security/tlsIdentity";
import { checkComputerName, dialHosts, LOCAL_COMPUTER_ID } from "daemon/network/roster";
import { memberIdOf } from "daemon/network/memberId";
import { bareHost, bracketHost, checkProbeTarget, isLoopback } from "./probeTarget";
import { PaperCraneClient } from "./PaperCraneClient";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { RosterDial, RosterFacts, RosterView, RpcParams, RpcResult } from "@mileniumhq/paperapi/protocol";
import type { ComputerInfo, ComputerReachResult, DiscoveredComputer } from "../../../shared/shellContract";

export { checkComputerName };

/**
 * A computer as this app knows it: a member of this computer's roster (its
 * daemon owns it), under the id the app and panels name it by, with the
 * token this computer signs in to it with.
 */
export interface KnownComputer extends RosterFacts {
    /** "local" for this computer; the id an older Paperboard gave a computer it paired; else its member id */
    id: string;
    /** its id in the roster, from its daemon's key; empty for this computer until the roster has loaded */
    memberId: string;
    name: string;
    /** the address the computer is dialed at first: its .local name when it answers to one */
    host: string;
    /** the IP it last answered at, dialed alongside a .local host (absent when host is the IP) */
    address?: string;
    port: number;
    token?: string;
    /** its daemon's certificate, pinned at pairing */
    cert?: string;
    isLocal: boolean;
}

/** What a daemon says the computer is: a layer it no longer reports is gone. */
function osFactsOf(from: RosterFacts): RosterFacts {
    return {
        os: from.os,
        osVersion: from.osVersion,
        distroId: from.distroId,
        distroName: from.distroName,
        flavor: from.flavor,
        machine: from.machine,
        board: from.board,
        operator: from.operator,
    };
}

const definedOnly = (facts: RosterFacts): RosterFacts => Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined));

const errorCodeOf = (err: unknown): unknown => {
    const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
    return e?.cause?.code ?? e?.code;
};

// timeout = lost in transit, refusal = nothing listening there
export function classifyProbeError(err: unknown): string {
    const msg = err instanceof Error ? err.message : "";
    if ((err instanceof Error && err.name === "TimeoutError") || /aborted|timeout/i.test(msg)) {
        return "Timed out with no response. The computer may be offline, on a different network, or its firewall is blocking the Paperboard server daemon";
    }
    const code = errorCodeOf(err);
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
function isPlaintextAnswer(err: unknown): boolean {
    const code = errorCodeOf(err);
    return code === "EPROTO" || /SSL|TLS|WRONG_VERSION_NUMBER/.test(err instanceof Error ? err.message : "");
}

/** a name the computer answers to over mDNS, as opposed to an IP or a DNS name */
function isMdnsName(host: string): boolean {
    return /\.local$/i.test(host);
}

/** where a paired computer might be now; each is believed only once its pinned certificate answers there */
interface Sighting {
    name?: string;
    address?: string;
    port?: number;
}

export const LOCAL_COMPUTER_NAME = "This Computer";

// which computer the rail has selected: the app's view, never the roster's
const ACTIVE_FILE = "active_computer.json";
// TODO(remove after v0.6): 0.4 kept the selection in paired_computers.json,
// which the daemon moves into its roster (and deletes) when it starts
const OLD_PAIRED_FILE = "paired_computers.json";

function readActiveId(): string {
    const dir = getLocalDir();
    const saved = readStateFileSync<{ activeId?: unknown } | null>(path.join(dir, ACTIVE_FILE), null, ACTIVE_FILE);
    if (saved && typeof saved.activeId === "string") return saved.activeId;
    const old = readStateFileSync<{ activeId?: unknown }>(path.join(dir, OLD_PAIRED_FILE), {}, OLD_PAIRED_FILE);
    if (typeof old?.activeId !== "string") return LOCAL_COMPUTER_ID;
    // kept where this app keeps it before the daemon moves the old file away
    writeJsonAtomicSync(path.join(dir, ACTIVE_FILE), { activeId: old.activeId });
    return old.activeId;
}

type RosterAction = "computers:list" | "computers:pair" | "computers:update" | "computers:reorder" | "computers:remove";

// this computer, until the roster says more about it
const placeholderSelf = (): KnownComputer => ({
    id: LOCAL_COMPUTER_ID,
    memberId: "",
    name: LOCAL_COMPUTER_NAME,
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    arch: os.arch(),
    isLocal: true,
});

/**
 * Every computer the app shows, each served by a daemon. The list is this
 * computer's roster, which its daemon owns: the pool asks the daemon for it,
 * follows its changes, and writes every pairing, rename, reorder, removal
 * and new address through it.
 */
export class ConnectionPool extends EventEmitter {
    private computers = new Map<string, KnownComputer>([[LOCAL_COMPUTER_ID, placeholderSelf()]]);
    private byMember = new Map<string, KnownComputer>();
    private aliases: Record<string, string> = {};
    private clients: Map<string, PaperCraneClient> = new Map();
    private activeId: string;
    // the roster as last applied, compared so a push that changes nothing notifies nothing
    private applied: string | null = null;
    // why the roster couldn't be read from this computer's daemon, until it can
    private rosterError: string | null = null;
    // the newest roster revision applied from this computer's daemon: an
    // older answer arriving late never undoes a newer one. A daemon that
    // started again counts from 0, and the old one's calls all failed with it.
    private revision = -1;
    // the newest sighting checked per computer: an older check's answer is dropped
    private sightings = new Map<string, number>();
    private sightingCounter = 0;

    constructor() {
        super();
        this.activeId = readActiveId();
    }

    /** Connects to this computer's daemon and reads the computer list; throws when the list can't be read. */
    public async init(): Promise<void> {
        try {
            await this.getClient(LOCAL_COMPUTER_ID).connect("127.0.0.1");
        } catch (err) {
            // the rail shows this computer offline, with the reason
            logger.warn("[ConnectionPool] the local Paperboard server is not answering yet:", err);
        }
        await this.ready();
    }

    /** resolves once the computer list is read; a list that couldn't be read is asked for again, and its failure thrown */
    public async ready(): Promise<void> {
        if (this.applied !== null && this.rosterError === null) return;
        await this.loadRoster();
        if (this.rosterError !== null) throw new Error(`The computer list couldn't be read from this computer's Paperboard Server: ${this.rosterError}`);
    }

    private async loadRoster(): Promise<void> {
        try {
            // a daemon that started again hears this socket's interest anew
            await this.getClient(LOCAL_COMPUTER_ID).call("events:subscribe", { events: ["computers:changed"] });
            await this.ask("computers:list", {});
        } catch (err) {
            this.rosterError = errorMessage(err);
            logger.error("[ConnectionPool] the computer list couldn't be read:", err);
            this.emit("change");
        }
    }

    /** a roster call on this computer's daemon; its answer is applied unless a newer one was */
    private async ask<A extends RosterAction>(action: A, params: RpcParams<A>): Promise<RpcResult<A>> {
        const view = await this.getClient(LOCAL_COMPUTER_ID).call(action, params);
        if (view.revision >= this.revision) {
            this.revision = view.revision;
            this.rosterError = null;
            this.apply(view);
        }
        return view;
    }

    // the roster as the app names it: this computer is "local", a computer
    // an older Paperboard paired keeps the id it gave it (its panels' pages
    // keep their origin, and with it what they saved in the browser)
    private apply(view: RosterView): void {
        const shown = JSON.stringify({ ...view, revision: 0 });
        if (shown === this.applied) return;
        this.applied = shown;
        const { byId: next, byMember } = computersOf(view);
        // each client follows its computer: gone, signed in anew, or found elsewhere
        for (const [id, client] of [...this.clients]) {
            if (id === LOCAL_COMPUTER_ID) continue;
            const before = this.computers.get(id);
            const now = next.get(id);
            if (!now || !now.cert || now.token !== before?.token || now.cert !== before?.cert) {
                this.clients.delete(id);
                this.retire(id, client, now !== undefined && before?.token !== undefined && now.token !== before.token);
            } else if (now.host !== before.host || now.address !== before.address || now.port !== before.port) {
                client.retarget(dialHosts({ host: now.host, address: now.address, port: now.port }), now.port);
            }
        }
        this.computers = next;
        this.byMember = byMember;
        this.aliases = view.aliases;
        // a selection saved under another of its ids still names it; a forgotten one falls back to this computer
        this.activeId = this.resolve(this.activeId) ?? LOCAL_COMPUTER_ID;
        this.emit("change");
    }

    // a client whose computer is gone, or signed in with a new token: its
    // going is no news. Paired again, the old token is given back so it
    // isn't left valid there.
    private retire(id: string, client: PaperCraneClient, giveBackToken: boolean): void {
        client.removeAllListeners("status");
        client.removeAllListeners("facts");
        if (!giveBackToken) {
            client.disconnect();
            return;
        }
        void client.call("auth:revoke-self", {}, 5000)
            // quiet: the new pairing stands either way; an old token left behind is listed on that computer
            .catch((err) => logger.warn(`[ConnectionPool] ${id}'s old token wasn't given back:`, err))
            .finally(() => client.disconnect());
    }

    /** the app's id for the computer an id names: its own, its member id, or one an older Paperboard gave it */
    public resolve(id: string): string | null {
        if (this.computers.has(id)) return id;
        const member = Object.hasOwn(this.aliases, id) ? this.aliases[id]! : id;
        return this.byMember.get(member)?.id ?? null;
    }

    private known(id: string): KnownComputer | undefined {
        const resolved = this.resolve(id);
        return resolved === null ? undefined : this.computers.get(resolved);
    }

    // a remote re-sends what it is on every sign-in: an OS upgrade, or
    // detection a newer daemon learned, shows without pairing again. Its
    // .local name is learned the same way, so a computer paired by IP moves
    // to its name once the name answers here.
    private refreshFacts(id: string, facts: RosterFacts & { mdnsName?: string }) {
        const comp = this.computers.get(id);
        if (!comp) return;
        if (facts.mdnsName) void this.follow(id, [{ name: facts.mdnsName }]);
        // a daemon too old to answer with facts keeps what pairing recorded
        if (!facts.os) return;
        const next = definedOnly({ ...osFactsOf(facts), arch: comp.arch });
        if (JSON.stringify(definedOnly({ ...osFactsOf(comp), arch: comp.arch })) === JSON.stringify(next)) return;
        this.ask("computers:update", { id: comp.memberId, facts: next }).catch((err) => {
            logger.warn(`[ConnectionPool] ${comp.name}'s refreshed OS details weren't saved:`, err); // quiet: the computer sends them again on its next sign-in
        });
    }

    /** why the computer with this pinned certificate doesn't answer at host:port, or null when it does */
    private async healthAt(host: string, port: number, cert: string): Promise<string | null> {
        try {
            const res = await pinnedRequest(`https://${bracketHost(host)}:${port}/health`, cert, { timeoutMs: 3000 });
            return res.ok ? null : `Something other than the Paperboard server daemon answered (HTTP ${res.status})`;
        } catch (err) {
            return classifyProbeError(err);
        }
    }

    /**
     * A paired computer was seen somewhere: its daemon named itself, or
     * mDNS found its certificate's fingerprint at an address. Each new name,
     * address or port is kept only once the pinned certificate answers
     * there, so whoever else answers to a name or copies a fingerprint
     * never takes the record. The client then dials the new addresses.
     */
    // every sighting is probed (a copy of the public fingerprint can be
    // advertised too); the first whose certificate answers is followed
    private async follow(id: string, sightings: Sighting[]): Promise<void> {
        const comp = this.computers.get(id);
        if (!comp?.cert || comp.isLocal) return;
        const { cert, host: wasHost, address: wasAddress, port: wasPort } = comp;
        const fresh = sightings.map((seen) => {
            const port = seen.port ?? wasPort;
            const name = seen.name && (seen.name !== wasHost || port !== wasPort) ? seen.name : undefined;
            const address = seen.address && (seen.address !== wasAddress && seen.address !== wasHost || port !== wasPort) ? seen.address : undefined;
            return { port, name, address };
        }).filter((seen) => seen.name || seen.address);
        if (fresh.length === 0) return;
        const token = ++this.sightingCounter;
        this.sightings.set(id, token);
        const probed = await Promise.all(fresh.map(async (seen) => {
            const [nameOk, addressOk] = await Promise.all([
                seen.name ? this.healthAt(seen.name, seen.port, cert).then((why) => why === null) : false,
                seen.address ? this.healthAt(seen.address, seen.port, cert).then((why) => why === null) : false,
            ]);
            return { ...seen, nameOk, addressOk };
        }));
        // a newer sighting, a re-pairing, a removal or another move came first
        const now = this.computers.get(id);
        if (this.sightings.get(id) !== token || !now || now.cert !== cert || now.host !== wasHost || now.address !== wasAddress || now.port !== wasPort) return;
        this.sightings.delete(id);
        const answered = probed.find((seen) => seen.nameOk || seen.addressOk);
        if (!answered) return;
        const { port, name, address, nameOk, addressOk } = answered;
        let host = wasHost;
        let known = wasAddress;
        if (nameOk && name) {
            // an IP or typed name it was dialed at stays as the address, until a sighting brings a newer one
            if (!isMdnsName(host)) known = known ?? host;
            host = name;
        }
        if (addressOk && address) {
            if (isMdnsName(host)) known = address;
            else host = address;
        }
        if (known === host) known = undefined;
        if (host === wasHost && known === wasAddress && port === wasPort) return;
        const dial: RosterDial = { host, ...(known ? { address: known } : {}), port };
        try {
            await this.ask("computers:update", { id: now.memberId, dial });
        } catch (err) {
            logger.warn(`[ConnectionPool] ${now.name}'s new address wasn't saved:`, err); // quiet: the next sighting finds it there again and saves it
            return;
        }
        logger.info(`[ConnectionPool] ${now.name} is now reached at ${dialHosts(dial).join(" or ")}, port ${port}`);
    }

    /**
     * Nearby computers changed: a paired one seen under its certificate's
     * fingerprint at a new address, name or port is followed there.
     * Settles once every sighting was checked.
     */
    public async followDiscovered(found: DiscoveredComputer[]): Promise<void> {
        if (!found.some((d) => d.fingerprint)) return;
        const checks: Promise<void>[] = [];
        for (const comp of this.computers.values()) {
            if (comp.isLocal || !comp.cert) continue;
            let fingerprint: string;
            try {
                fingerprint = certFingerprint(comp.cert);
            } catch {
                continue; // quiet: a certificate that doesn't parse fails that computer's own connection, which says so
            }
            const seen = found.filter((d) => d.fingerprint === fingerprint);
            if (seen.length) checks.push(this.follow(comp.id, seen.map((d) => ({ name: d.mdnsName, address: d.host, port: d.port }))));
        }
        await Promise.all(checks);
    }

    /**
     * Whether a paired computer answers, at any address it is known by and
     * under its pinned certificate: a different machine at its old address
     * is not it.
     */
    public async reach(id: string): Promise<ComputerReachResult> {
        const comp = this.known(id);
        if (!comp) throw new Error("Paperboard doesn't know this computer anymore.");
        if (comp.isLocal) {
            const status = this.getClient(comp.id).getStatus();
            return status.connected ? { reachable: true } : { reachable: false, error: status.error ?? "This computer's Paperboard Server isn't answering" };
        }
        const cert = comp.cert;
        if (!cert) return { reachable: false, error: `${comp.host} has no pinned certificate. Remove this computer and pair it again` };
        const why = await Promise.all(dialHosts(comp).map((h) => this.healthAt(h, comp.port, cert)));
        // the first address's reason: the name it is known by, when it has one
        return why.includes(null) ? { reachable: true } : { reachable: false, error: why[0]! };
    }

    // never a default id: operations must not land on the wrong machine.
    // The first ask connects.
    public getClient(id: string): PaperCraneClient {
        const comp = this.known(id);
        if (!comp) throw new Error(`Unknown computer: ${id}`);
        let client = this.clients.get(comp.id);
        if (client) return client;
        client = new PaperCraneClient();
        this.clients.set(comp.id, client);
        if (comp.isLocal) {
            client.on("status", (status: { connected: boolean }) => {
                this.emit("change");
                // a daemon that started again may hold a list changed meanwhile, and counts its changes anew
                if (!status.connected) return;
                this.revision = -1;
                void this.loadRoster();
            });
            client.on("event", (event: string) => {
                if (event === "computers:changed") void this.loadRoster();
            });
            // credentials resolved internally via handshake/embedded
            client.connect("127.0.0.1").catch((err) => logger.debug("[ConnectionPool] local connect failed:", err));
            return client;
        }
        const appId = comp.id;
        client.on("status", (status: { connected: boolean }) => {
            this.emit("change");
            // a paired computer that dropped may have moved: look for it again
            if (!status.connected) this.emit("unreachable", appId);
        });
        client.on("facts", (facts: RosterFacts & { mdnsName?: string }) => this.refreshFacts(appId, facts));
        client.connect(dialHosts(comp), comp.port, comp.token, comp.cert).catch((err) => logger.debug("[ConnectionPool] remote connect failed:", err));
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

    // the rail's selection is kept for the next launch, apart from the roster
    public setActive(id: string): boolean {
        const resolved = this.resolve(id);
        if (resolved === null) return false;
        writeJsonAtomicSync(path.join(getLocalDir(), ACTIVE_FILE), { activeId: resolved });
        this.activeId = resolved;
        this.getClient(resolved);
        this.emit("change");
        return true;
    }

    /** what the shell shows of each computer: never a pairing's token or pinned certificate */
    public listComputers(): ComputerInfo[] {
        return Array.from(this.computers.values()).map(({ token: _token, cert: _cert, memberId: _member, ...c }) => {
            const client = this.clients.get(c.id);
            const status =
                client?.getStatus() ??
                (c.isLocal
                    ? { connected: false, isRemote: false, host: "127.0.0.1", port: DEFAULT_PORT }
                    : { connected: false, isRemote: true, host: c.host, port: c.port });
            // the local daemon is dialed on loopback, which is no address
            // another machine can use; remote hosts are already the address
            // they were paired with. Computed per call: it follows the network.
            return { ...c, status, ...(c.isLocal ? { networkAddress: getNetworkIp() } : {}) };
        });
    }

    // the updater's fan-out: `visit` on every paired computer, eight at a time
    public async forEachComputer(visit: (computer: { id: string; name: string }) => Promise<void>): Promise<void> {
        const computers = Array.from(this.computers.values(), ({ id, name }) => ({ id, name }));
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
        } catch (err) {
            return { reachable: false, error: isLoopback(host) && isPlaintextAnswer(err) ? LOOPBACK_DAEMON : classifyProbeError(err) };
        }
    }

    // the address, port and name are checked as probe and renameComputer
    // check them before anything is dialed
    public async pairComputer(
        host: string,
        port: number | string = DEFAULT_PORT,
        code: string,
        customName?: unknown,
        // the certificate the computer must answer with, when something it
        // trusts already named it (`papercrane pair --json` over SSH)
        expect?: { fingerprint: string },
    ): Promise<KnownComputer> {
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
            // checked before the code goes out: whoever else answers there never sees it
            if (expect && certFingerprint(cert) !== expect.fingerprint) {
                throw new Error(`Pairing stopped: ${host}:${checked.port} answered with a certificate other than the one its Paperboard Server named over SSH, so the code wasn't sent.`);
            }
            // who answered is told by its certificate, never by the address:
            // an ssh tunnel and this computer's own daemon share 127.0.0.1
            const own = readTlsCert(getLocalDir());
            if (own && certFingerprint(own) === certFingerprint(cert)) throw new Error(OWN_DAEMON);
            // send our hostname, never the server name; customName stays local-only
            const pairRes = await tempClient.pair(code, os.hostname().replace(/\.local$/i, "") || "Paperboard App");
            if (!pairRes.success || !pairRes.token) {
                throw new Error("Pairing rejected: invalid code or daemon refused");
            }
            // the pairing socket trusted whatever certificate it was shown;
            // from here on the computer is dialed pinned, by a client that
            // reconnects on its own
            tempClient.disconnect();

            // a computer paired here before is paired again, not added twice:
            // the roster keeps it under its key, with its name and place
            const before = this.byMember.get(memberIdOf(cert));
            // its .local name, when that name leads to this same certificate
            // from here; else the address it was paired at
            const named = pairRes.mdnsName && pairRes.mdnsName !== host && (await this.healthAt(pairRes.mdnsName, checked.port, cert)) === null;
            let paired: RpcResult<"computers:pair">;
            try {
                paired = await this.ask("computers:pair", {
                    cert,
                    pairToken: pairRes.token,
                    name: name ?? (before ? undefined : pairRes.hostname || host),
                    dial: named ? { host: pairRes.mdnsName!, address: host, port: checked.port } : { host, port: checked.port },
                    facts: definedOnly({ ...osFactsOf(pairRes), arch: pairRes.arch }),
                });
            } catch (err) {
                // the remote issued a token we could not keep: say so
                throw new Error(`Paired, but this computer could not save the pairing: ${errorMessage(err)}`, { cause: err });
            }
            // the list applied now is this answer or a newer one
            const comp = this.byMember.get(paired.id);
            if (!comp) throw new Error("Paired, but the computer was removed from the list before it could connect.");
            this.getClient(comp.id);
            return comp;
        } finally {
            tempClient.disconnect();
        }
    }

    // the name the rail and every header show; false for a computer that's gone
    public async renameComputer(id: string, name: unknown): Promise<boolean> {
        const checked = checkComputerName(name);
        const comp = this.known(id);
        if (!comp) return false;
        await this.ask("computers:update", { id: this.memberOf(comp), name: checked });
        return true;
    }

    /**
     * The rail's order. The ids must be exactly the computers listed: a
     * list that drops or invents one is refused, so a stale renderer can
     * never lose a pairing.
     */
    public async reorderComputers(ids: string[]): Promise<void> {
        const members = ids.map((id) => this.known(id));
        if (members.some((comp) => !comp) || new Set(members).size !== this.computers.size || ids.length !== this.computers.size) {
            throw new Error("The computer list changed while you were reordering it. Try again.");
        }
        await this.ask("computers:reorder", { ids: members.map((comp) => this.memberOf(comp!)) });
    }

    /**
     * Forgets a paired computer, first asking it to forget this one's key.
     * Resolves to why it couldn't be asked, with nothing forgotten: it would
     * keep trusting a key nobody here remembers, so forgetting it anyway is
     * the person's call (`evenIfUntold`). Null once it's forgotten.
     */
    public async unpairComputer(id: string, evenIfUntold = false): Promise<string | null> {
        const comp = this.known(id);
        if (!comp) throw new Error("Paperboard doesn't know this computer anymore.");
        if (comp.isLocal) throw new Error("This computer can't be forgotten.");
        const client = this.clients.get(comp.id);
        if (comp.token && !evenIfUntold) {
            try {
                if (!client) throw new Error("it isn't connected");
                await client.call("auth:revoke-self", {}, 5000);
            } catch (err) {
                logger.warn(`[ConnectionPool] ${comp.id} wasn't told it is forgotten:`, err);
                return errorMessage(err);
            }
        }
        await this.ask("computers:remove", { id: comp.memberId });
        return null;
    }

    // this computer's member id is known once the roster loaded
    private memberOf(comp: KnownComputer): string {
        if (!comp.memberId) throw new Error("This computer's Paperboard Server hasn't listed the computers yet. Try again in a moment.");
        return comp.memberId;
    }

    // the machine woke or the network changed: recheck every computer now
    public wake(): void {
        for (const client of this.clients.values()) client.wake();
    }

    public getComputer(id: string): KnownComputer | undefined {
        return this.known(id);
    }

    // remote supervised processes intentionally survive
    public dispose(): void {
        for (const client of this.clients.values()) {
            client.removeAllListeners();
            // stop embedded daemons so supervised children terminate
            client.stopEmbeddedServer();
            client.disconnect();
        }
        this.clients.clear();
    }
}

/** The roster as the app names its computers, in the person's order. */
function computersOf(view: RosterView): { byId: Map<string, KnownComputer>; byMember: Map<string, KnownComputer> } {
    const formerId = new Map<string, string>();
    for (const [old, member] of Object.entries(view.aliases)) if (!formerId.has(member)) formerId.set(member, old);
    const byId = new Map<string, KnownComputer>();
    const byMember = new Map<string, KnownComputer>();
    for (const member of view.members) {
        const computer: KnownComputer = member.id === view.self
            ? { ...placeholderSelf(), ...definedOnly(member.facts), memberId: member.id, name: member.name ?? LOCAL_COMPUTER_NAME }
            : {
                ...definedOnly(member.facts),
                id: formerId.get(member.id) ?? member.id,
                memberId: member.id,
                name: member.name ?? member.dial?.host ?? member.id,
                host: member.dial?.host ?? "",
                ...(member.dial?.address ? { address: member.dial.address } : {}),
                port: member.dial?.port ?? DEFAULT_PORT,
                token: Object.hasOwn(view.tokens, member.id) ? view.tokens[member.id] : undefined,
                cert: member.cert,
                isLocal: false,
            };
        byId.set(computer.id, computer);
        byMember.set(member.id, computer);
    }
    return { byId, byMember };
}

export const connectionPool = new ConnectionPool();
export default connectionPool;
