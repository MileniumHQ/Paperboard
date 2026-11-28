// Links: how the computers of a network reach each other. Every pair of
// members keeps one WebSocket on /network, over TLS where both sides present
// their daemon certificate, and syncs its record stores over it. Who may link
// is the roster: a peer is accepted only when its key hashes to a current
// member id, and a member that stops being one is cut at once.
//
// ─── Who dials ───────────────────────────────────────────────────────────────
//
// A member is dialed at the name it answers to and the address this computer
// last reached it at (the roster). Of two members that can both be dialed,
// the one with the smaller id dials; the other waits, and dials too once it
// has gone takeoverMs (30 s) without a link. A computer that can't be dialed
// (no TLS listener, like the desktop app's own daemon on 127.0.0.1, or no
// address anyone knows for it) always dials out, so it syncs all the same.
// Two members that can't dial each other never link; records still reach
// them through any member both link to. A relay is what will join two that
// share none.
//
// Two links between one pair (both dialed at once, or a redial while the
// old socket is half open) collapse to one on both sides by the same rule:
// the link the smaller id dialed is kept; of two the same side dialed, the
// newer.
//
// ─── Over a link ─────────────────────────────────────────────────────────────
//
// JSON messages:
//   {"t":"req","n":<int>,"op":"changes","cursor":<cursor|null>,"limit":<int>}
//   {"t":"res","n":<int>,"ok":true,"value":<ChangeBatch>}
//   {"t":"res","n":<int>,"ok":false,"error":<text>}
//   {"t":"changed"}            this side accepted records the other may lack
// Each side pulls from the other (RecordStore.pull, one cursor per peer)
// when the link opens and when the other says it changed. A peer that sends
// what isn't one of these, or doesn't answer a request or a ping in time,
// loses its link and is dialed again after a backoff.
//
// ─── Presence ────────────────────────────────────────────────────────────────
//
// Online is a link that is up now, known only in memory. When a member was
// last linked and last synced is this computer's own observation, saved in
// its private roster file (rosterPrivate.ts).
import type * as http from "http";
import type { Duplex } from "stream";
import type * as tls from "tls";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import { logger } from "../core/logger";
import { TLS_SERVER_NAME, type TlsIdentity } from "../security/tlsIdentity";
import { memberIdOf } from "./memberId";
import { dialHosts, type Roster } from "./roster";
import type { ApplyResult, ChangeBatch, ChangeCursor, RecordStore } from "./store";

export const LINK_PATH = "/network";

/** Close codes a link ends with besides the standard ones. */
export const LINK_CLOSE = {
    /** another link between the same pair is kept */
    duplicate: 4001,
    /** the peer broke the protocol, or stopped answering */
    protocol: 4002,
    /** the peer isn't (or stopped being) a member here */
    notMember: 4003,
} as const;

// a batch is at most this many records, and a record's body at most 1 MiB
// (1.4 MB as base64): a full batch fits the payload limit
const PULL_LIMIT = 32;
const MAX_SERVED_LIMIT = 500;
const MAX_LINK_PAYLOAD = 64 * 1024 * 1024;
// requests a peer may have waiting on this side at once; a pull makes one
const MAX_INBOUND_REQUESTS = 4;

export interface LinkTiming {
    /** how often a link is pinged; one that misses a ping is ended */
    pingMs: number;
    /** how long a request may wait for its answer */
    requestTimeoutMs: number;
    /** how long a dial may take to open */
    connectTimeoutMs: number;
    /** backoff after a failed dial: from this, doubling... */
    backoffMinMs: number;
    /** ...up to this, each with up to half again of random jitter */
    backoffMaxMs: number;
    /** how long the member that waits for the other to dial waits before it dials too */
    takeoverMs: number;
    /** how long a change waits for more before the peers hear of it */
    noticeDebounceMs: number;
    /** how often held records are asked about again (clocks that were ahead) */
    readmitMs: number;
    /** how often a link's last-seen time is saved while it is up */
    presenceSaveMs: number;
}

export const DEFAULT_LINK_TIMING: LinkTiming = {
    pingMs: 15_000,
    requestTimeoutMs: 30_000,
    connectTimeoutMs: 10_000,
    backoffMinMs: 1_000,
    backoffMaxMs: 60_000,
    takeoverMs: 30_000,
    noticeDebounceMs: 200,
    readmitMs: 5 * 60_000,
    presenceSaveMs: 5 * 60_000,
};

export interface NetworkLinksOptions {
    identity: TlsIdentity;
    roster: Roster;
    store: RecordStore;
    /** whether other computers can dial this one: it has a TLS listener */
    listening: boolean;
    timing?: Partial<LinkTiming>;
    /** the wall clock, in ms; tests pass their own */
    now?: () => number;
    /** 0 ≤ x < 1, for jitter */
    random?: () => number;
}

/** How this computer reaches a member. */
export type Reach =
    | { state: "linked"; dialedBy: "this" | "peer"; since: number }
    | { state: "dialing"; attempts: number; lastError: string | null; nextAttemptAt: number | null }
    | { state: "waiting"; reason: string; dialsAt: number | null }
    | { state: "unreachable"; reason: string };

export interface PeerSync {
    /** "never": this computer has never pulled everything a member had */
    state: "never" | "synced";
    lastSuccessAt: number | null;
    /** the last pull, when it failed after the last success */
    lastFailure: { at: number; error: string } | null;
    /** what the last successful pull brought */
    lastPull: { accepted: number; known: number; held: number } | null;
}

export interface PeerStatus {
    id: string;
    online: boolean;
    /** the last time a link to it was up; now while it is */
    lastSeen: number | null;
    reach: Reach;
    sync: PeerSync;
}

export interface NetworkStatus {
    self: string;
    listening: boolean;
    /** records waiting to be admitted, from any peer */
    held: number;
    peers: PeerStatus[];
}

/** The peer answered, and said no: it doesn't count this computer as a member. */
class RefusedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RefusedError";
    }
}

class LinkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LinkError";
    }
}

interface LinkEvents {
    request(op: string, params: Record<string, unknown>): Promise<unknown>;
    notice(): void;
    closed(link: Link, code: number, reason: string): void;
}

/** One socket to one peer, either direction. */
class Link {
    private nextRequest = 1;
    private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    private inbound = 0;
    private answered = true;
    private readonly pinger: ReturnType<typeof setInterval>;
    closed = false;

    constructor(
        private readonly ws: WebSocket,
        readonly peer: string,
        /** the member id that dialed */
        readonly dialer: string,
        readonly opened: number,
        private readonly timing: LinkTiming,
        private readonly events: LinkEvents,
    ) {
        ws.on("message", (data) => this.receive(data));
        ws.on("pong", () => {
            this.answered = true;
        });
        ws.on("close", (code, reason) => this.ended(code, reason.toString() || `closed (${code})`));
        ws.on("error", (err) => {
            this.ended(LINK_CLOSE.protocol, errorMessage(err));
            ws.terminate();
        });
        this.pinger = setInterval(() => {
            if (!this.answered) return this.fail(`${peer} stopped answering`);
            this.answered = false;
            ws.ping();
        }, timing.pingMs);
        this.pinger.unref?.();
    }

    request(op: string, params: Record<string, unknown>): Promise<unknown> {
        if (this.closed) return Promise.reject(new LinkError(`The link to ${this.peer} is closed`));
        const n = this.nextRequest++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(n);
                const err = new LinkError(`${this.peer} didn't answer within ${this.timing.requestTimeoutMs} ms`);
                reject(err);
                this.fail(err.message);
            }, this.timing.requestTimeoutMs);
            timer.unref?.();
            this.pending.set(n, { resolve, reject, timer });
            this.send({ t: "req", n, op, ...params });
        });
    }

    notify(): void {
        this.send({ t: "changed" });
    }

    /** ends the link for a broken protocol; the peer hears why */
    fail(reason: string): void {
        this.close(LINK_CLOSE.protocol, reason);
    }

    close(code: number, reason: string): void {
        if (this.closed) return;
        // a close frame's reason is at most 123 bytes
        this.ws.close(code, Buffer.from(reason).subarray(0, 120).toString());
        this.ended(code, reason);
        // a peer that never answers the close is let go of anyway
        const hard = setTimeout(() => this.ws.terminate(), this.timing.connectTimeoutMs);
        hard.unref?.();
        this.ws.once("close", () => clearTimeout(hard));
    }

    private send(message: object): void {
        if (this.closed) return;
        this.ws.send(JSON.stringify(message), (err) => {
            if (err) this.ended(LINK_CLOSE.protocol, `sending to ${this.peer} failed: ${errorMessage(err)}`);
        });
    }

    private receive(data: RawData): void {
        this.answered = true;
        let message: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(data.toString());
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
            message = parsed as Record<string, unknown>;
        } catch (err) {
            return this.fail(`${this.peer} sent something that isn't a link message (${errorMessage(err)})`);
        }
        if (message.t === "changed") return this.events.notice();
        if (message.t === "res" && Number.isSafeInteger(message.n)) {
            const waiting = this.pending.get(message.n as number);
            // an answer to a request that timed out never comes: the timeout ended the link
            if (!waiting) return this.fail(`${this.peer} answered a request it wasn't asked`);
            this.pending.delete(message.n as number);
            clearTimeout(waiting.timer);
            if (message.ok === true) waiting.resolve(message.value);
            else waiting.reject(new LinkError(`${this.peer} couldn't answer: ${typeof message.error === "string" ? message.error : "no reason given"}`));
            return;
        }
        if (message.t === "req" && Number.isSafeInteger(message.n) && typeof message.op === "string") {
            if (this.inbound >= MAX_INBOUND_REQUESTS) return this.fail(`${this.peer} asked more than ${MAX_INBOUND_REQUESTS} things at once`);
            const n = message.n;
            this.inbound++;
            const { t: _t, n: _n, op, ...params } = message;
            this.events.request(op as string, params).then(
                (value) => this.send({ t: "res", n, ok: true, value }),
                (err) => this.send({ t: "res", n, ok: false, error: errorMessage(err) }),
            ).finally(() => {
                this.inbound--;
            });
            return;
        }
        this.fail(`${this.peer} sent a link message this computer doesn't know`);
    }

    private ended(code: number, reason: string): void {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.pinger);
        for (const [n, waiting] of this.pending) {
            clearTimeout(waiting.timer);
            waiting.reject(new LinkError(`The link to ${this.peer} ended: ${reason}`));
            this.pending.delete(n);
        }
        this.events.closed(this, code, reason);
    }
}

interface Peer {
    id: string;
    link: Link | null;
    /** a dial in flight, from its first address to its link being kept */
    dialing: boolean;
    /** the socket a dial in flight is opening */
    socket: WebSocket | null;
    attempts: number;
    lastDialError: string | null;
    retryAt: number | null;
    /** since when there has been no link: the waiting member dials once this is takeoverMs old */
    unlinkedSince: number;
    /** when a link to it was last up, in memory: saving it is behind */
    lastSeenAt: number | null;
    timer: ReturnType<typeof setTimeout> | null;
    noticeTimer: ReturnType<typeof setTimeout> | null;
    pulling: boolean;
    pullAgain: boolean;
    sync: { lastSuccessAt: number | null; lastFailure: { at: number; error: string } | null; lastPull: PeerSync["lastPull"] };
}

function pemOf(raw: Buffer): string {
    return `-----BEGIN CERTIFICATE-----\n${raw.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function memberIdOfRaw(raw: Buffer | undefined): string | null {
    if (!raw?.length) return null;
    try {
        return memberIdOf(pemOf(raw));
    } catch {
        return null; // quiet: a certificate that doesn't parse names no member, and the caller refuses the link
    }
}

const bracket = (host: string) => (host.includes(":") ? `[${host}]` : host);

function isCursor(value: unknown): value is ChangeCursor | null {
    if (value === null) return true;
    const { log, after } = (value ?? {}) as Partial<ChangeCursor>;
    return typeof log === "string" && Number.isSafeInteger(after);
}

function refuse(socket: Duplex, status: number, reason: string): void {
    socket.end(`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : status === 401 ? "Unauthorized" : "Service Unavailable"}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`);
}

/** This computer's links to the other members, and the sync over them. */
export class NetworkLinks {
    readonly self: string;
    private readonly timing: LinkTiming;
    private readonly now: () => number;
    private readonly random: () => number;
    private readonly peers = new Map<string, Peer>();
    private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_LINK_PAYLOAD, perMessageDeflate: false });
    private readonly listeners = new Set<() => void>();
    /** computers refused a link, so the log says it once each; bounded by who tries */
    private readonly refusedOnce = new Set<string>();
    private readonly cleanups: (() => void)[] = [];
    private started = false;
    private stopped = false;

    /** the record store the links sync */
    get store(): RecordStore {
        return this.options.store;
    }

    constructor(private readonly options: NetworkLinksOptions) {
        this.self = options.roster.self;
        this.timing = { ...DEFAULT_LINK_TIMING, ...options.timing };
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
    }

    /** Begins dialing the members this computer dials, and syncing over every link. */
    start(): void {
        if (this.started) throw new Error("The network links are already started");
        this.started = true;
        const { roster, store } = this.options;
        this.cleanups.push(roster.onChange(() => this.reconcile()));
        this.cleanups.push(store.onAccepted(() => this.tellPeers()));
        const readmit = setInterval(() => {
            store.readmit().catch((err) => {
                logger.error("[network] the records waiting to be admitted couldn't be asked about again (the next round asks):", err); // quiet: periodic; the next round and every roster change readmit again
            });
        }, this.timing.readmitMs);
        const presence = setInterval(() => {
            for (const peer of this.peers.values()) if (peer.link) this.saveSeen(peer);
        }, this.timing.presenceSaveMs);
        readmit.unref?.();
        presence.unref?.();
        this.cleanups.push(() => clearInterval(readmit), () => clearInterval(presence));
        this.reconcile();
    }

    /** Ends every link and dial; what each was last seen at is saved. */
    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        for (const cleanup of this.cleanups.splice(0)) cleanup();
        const saves: Promise<void>[] = [];
        for (const peer of this.peers.values()) {
            this.clearTimers(peer);
            peer.socket?.terminate();
            if (peer.link) {
                saves.push(this.saveSeen(peer));
                peer.link.close(1001, "This computer's Paperboard stopped");
            }
        }
        this.wss.close();
        await Promise.all(saves);
    }

    /** Hears every change to what status() reports. */
    onStatus(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * An address a member was seen at (an mDNS sighting): it is dialed there
     * now, and once its key answers there the roster keeps the address.
     */
    async addressSeen(id: string, dial: { host: string; address?: string; port: number }): Promise<boolean> {
        const peer = this.peers.get(id);
        const member = this.options.roster.member(id);
        if (!peer || !member || peer.link || this.stopped) return false;
        // its own attempt beside any dial under way: two links that result collapse to one
        const linked = (await this.reach(peer, dialHosts({ ...dial }), dial.port, member.cert)) === null;
        if (linked) await this.options.roster.update(id, { dial });
        return linked;
    }

    // ─── Accepting ───────────────────────────────────────────────────────────

    /**
     * An upgrade to /network on the daemon's TLS listener. The peer is who
     * its client certificate's key says; it is let in only as a member.
     */
    accept(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        if (this.stopped || !this.started) return refuse(socket, 503, "This computer isn't linking right now");
        const secure = socket as tls.TLSSocket;
        if (!secure.encrypted || typeof secure.getPeerCertificate !== "function") return refuse(socket, 403, "Links are made over TLS only");
        const id = memberIdOfRaw(secure.getPeerCertificate(true)?.raw);
        if (!id) return refuse(socket, 401, "A link needs this computer's daemon certificate");
        if (id === this.self || !this.options.roster.member(id)) {
            // said once per computer: one that counts this one as a member keeps asking
            if (!this.refusedOnce.has(id)) {
                this.refusedOnce.add(id);
                logger.warn(`[network] refused a link from ${id} at ${secure.remoteAddress ?? "an unknown address"}: not a member of this network (it is refused again without a word)`);
            }
            return refuse(socket, 403, "This computer isn't one of this network's members");
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => this.adopt(ws, id, id));
    }

    // ─── Dialing ─────────────────────────────────────────────────────────────

    /** Whether the members can dial this computer: it listens, and the roster says where. */
    private dialable(): boolean {
        return this.options.listening && !!this.options.roster.member(this.self)?.dial;
    }

    /** brings the peers in line with the roster: new members are reached, gone ones cut */
    private reconcile(): void {
        if (this.stopped) return;
        const { roster } = this.options;
        for (const [id, peer] of this.peers) {
            if (roster.member(id)) continue;
            this.clearTimers(peer);
            peer.socket?.terminate();
            peer.link?.close(LINK_CLOSE.notMember, "No longer a member of this network");
            this.peers.delete(id);
        }
        for (const member of roster.list()) {
            if (member.id === this.self) continue;
            let peer = this.peers.get(member.id);
            if (!peer) {
                peer = {
                    id: member.id,
                    link: null,
                    dialing: false,
                    socket: null,
                    lastSeenAt: null,
                    attempts: 0,
                    lastDialError: null,
                    retryAt: null,
                    unlinkedSince: this.now(),
                    timer: null,
                    noticeTimer: null,
                    pulling: false,
                    pullAgain: false,
                    sync: { lastSuccessAt: null, lastFailure: null, lastPull: null },
                };
                this.peers.set(member.id, peer);
            }
            this.consider(peer);
        }
        this.changed();
    }

    /** dials the peer now, later, or not at all, by the rule at the top of this file */
    private consider(peer: Peer): void {
        if (this.stopped || peer.link || peer.dialing) return;
        const member = this.options.roster.member(peer.id);
        if (!member?.dial) return;
        if (peer.timer) clearTimeout(peer.timer);
        peer.timer = null;
        const now = this.now();
        const waitsUntil = this.dialable() && peer.id < this.self ? peer.unlinkedSince + this.timing.takeoverMs : now;
        const at = Math.max(waitsUntil, peer.retryAt ?? now);
        if (at > now) {
            peer.timer = setTimeout(() => {
                peer.timer = null;
                this.consider(peer);
            }, at - now);
            peer.timer.unref?.();
            return;
        }
        const { cert, dial } = member;
        void this.dial(peer, dialHosts(dial), dial.port, cert).then((linked) => {
            if (linked || this.stopped || !this.peers.has(peer.id)) return;
            this.consider(peer);
        });
    }

    /** the dial the rule at the top of this file makes: each host in turn, a backoff when none links; true once a link is up */
    private async dial(peer: Peer, hosts: string[], port: number, cert: string): Promise<boolean> {
        if (peer.dialing) return false;
        peer.dialing = true;
        let failed: { why: string; refused: boolean } | null;
        try {
            failed = await this.reach(peer, hosts, port, cert);
        } finally {
            peer.dialing = false;
        }
        if (failed === null) return true;
        this.backOff(peer, failed.why, failed.refused);
        this.changed();
        return false;
    }

    /**
     * The next dial waits longer after each failure in a row, with jitter so
     * two computers don't retry in step. A peer that refused waits the
     * longest at once: it will say no until it learns this computer (a 0.4
     * pairing knows only one side).
     */
    private backOff(peer: Peer, why: string, refused = false): void {
        peer.attempts++;
        peer.lastDialError = why;
        const backoff = refused ? this.timing.backoffMaxMs : Math.min(this.timing.backoffMaxMs, this.timing.backoffMinMs * 2 ** Math.min(peer.attempts - 1, 30));
        peer.retryAt = this.now() + Math.round(backoff * (1 + this.random() / 2));
    }

    /** each host in turn until one links: null then, else why the last one didn't, and whether the peer itself said no */
    private async reach(peer: Peer, hosts: string[], port: number, cert: string): Promise<{ why: string; refused: boolean } | null> {
        let last = { why: "it has no address", refused: false };
        for (const host of hosts) {
            if (peer.link) return null;
            if (this.stopped || !this.peers.has(peer.id)) return { why: "this computer stopped linking to it", refused: false };
            try {
                const ws = await this.connect(peer, host, port, cert);
                if (this.stopped || !this.peers.has(peer.id)) {
                    ws.terminate();
                    return { why: "this computer stopped linking to it", refused: false };
                }
                this.adopt(ws, peer.id, this.self);
                return null;
            } catch (err) {
                last = { why: `${bracket(host)}:${port}: ${errorMessage(err)}`, refused: err instanceof RefusedError };
            }
        }
        return last;
    }

    /** one TLS WebSocket to one address, the peer's key checked before anything is sent */
    private connect(peer: Peer, host: string, port: number, cert: string): Promise<WebSocket> {
        const { identity } = this.options;
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`wss://${bracket(host)}:${port}${LINK_PATH}`, {
                cert: identity.cert,
                key: identity.key,
                // the member's own certificate is the only one trusted; its key is what is checked
                ca: [cert],
                servername: TLS_SERVER_NAME,
                checkServerIdentity: (_host: string, presented: { raw?: Buffer }) =>
                    memberIdOfRaw(presented.raw) === peer.id ? undefined : new Error("another computer answered there"),
                handshakeTimeout: this.timing.connectTimeoutMs,
                maxPayload: MAX_LINK_PAYLOAD,
                perMessageDeflate: false,
            } as ConstructorParameters<typeof WebSocket>[2]);
            peer.socket = ws;
            let settled = false;
            const settle = (err: Error | null) => {
                if (settled) return;
                settled = true;
                if (peer.socket === ws) peer.socket = null;
                if (err) {
                    ws.terminate();
                    reject(err);
                } else resolve(ws);
            };
            ws.once("open", () => settle(null));
            ws.once("unexpected-response", (_req, res) => {
                const why = res.statusCode === 403 ? "this computer isn't one of its members" : res.statusCode === 401 ? "it wanted this computer's certificate" : res.statusMessage || "no reason given";
                settle(new RefusedError(`refused the link (${res.statusCode}): ${why}`));
            });
            ws.once("error", (err) => settle(err));
            ws.once("close", (code, reason) => settle(new Error(`closed before it opened (${code}${reason.length ? `: ${reason}` : ""})`)));
        });
    }

    // ─── A link ──────────────────────────────────────────────────────────────

    /** a socket that opened, either way: kept as the peer's link unless a better one is up */
    private adopt(ws: WebSocket, id: string, dialer: string): void {
        const peer = this.peers.get(id);
        if (!peer || this.stopped) {
            ws.close(peer ? 1001 : LINK_CLOSE.notMember, peer ? "This computer's Paperboard stopped" : "Not a member of this network");
            return;
        }
        const link = new Link(ws, id, dialer, this.now(), this.timing, {
            request: (op, params) => this.answer(op, params),
            notice: () => void this.pull(peer),
            closed: (ended, code, reason) => this.linkClosed(peer, ended, code, reason),
        });
        const current = peer.link;
        if (current && !current.closed) {
            // the same rule on both sides: the smaller id's dial, else the newer
            const keepCurrent = current.dialer !== link.dialer ? current.dialer < link.dialer : false;
            const loser = keepCurrent ? link : current;
            if (keepCurrent) {
                loser.close(LINK_CLOSE.duplicate, "Another link to this computer is kept");
                return;
            }
            peer.link = link;
            loser.close(LINK_CLOSE.duplicate, "Another link to this computer is kept");
        }
        peer.link = link;
        peer.lastSeenAt = this.now();
        peer.attempts = 0;
        peer.retryAt = null;
        peer.lastDialError = null;
        this.clearTimers(peer);
        void this.saveSeen(peer);
        void this.pull(peer);
        this.changed();
    }

    private linkClosed(peer: Peer, link: Link, code: number, reason: string): void {
        if (peer.link !== link) return;
        peer.link = null;
        peer.unlinkedSince = this.now();
        peer.lastSeenAt = this.now();
        void this.saveSeen(peer);
        if (code !== 1000 && code !== 1001 && code !== LINK_CLOSE.duplicate) {
            // a link that broke is dialed again after a backoff, like a dial that failed
            this.backOff(peer, reason);
        }
        if (!this.stopped && this.peers.has(peer.id)) this.consider(peer);
        this.changed();
    }

    /** what a peer asks over its link */
    private async answer(op: string, params: Record<string, unknown>): Promise<unknown> {
        if (op !== "changes") throw new Error(`Unknown request ${JSON.stringify(op)}`);
        const { cursor, limit } = params;
        if (!isCursor(cursor)) throw new Error("A change cursor must be null or {log, after}");
        if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_SERVED_LIMIT) throw new Error(`A batch holds 1 to ${MAX_SERVED_LIMIT} records`);
        return this.options.store.changes(cursor, limit as number);
    }

    /** takes what the peer has that this computer hasn't, over its link; one pull per peer at a time */
    private async pull(peer: Peer): Promise<void> {
        const link = peer.link;
        if (!link || this.stopped) return;
        if (peer.pulling) {
            peer.pullAgain = true;
            return;
        }
        peer.pulling = true;
        try {
            const result: ApplyResult = await this.options.store.pull(peer.id, { changes: (cursor, limit) => link.request("changes", { cursor, limit }) as Promise<ChangeBatch> }, PULL_LIMIT);
            const first = peer.sync.lastSuccessAt === null && this.options.roster.observed(peer.id).lastSync === undefined;
            peer.sync = {
                lastSuccessAt: this.now(),
                lastFailure: null,
                lastPull: { accepted: result.accepted, known: result.known, held: result.held },
            };
            if (result.refused.length) {
                logger.warn(`[network] ${result.refused.length} record(s) from ${peer.id} were refused: ${result.refused.slice(0, 3).map((r) => r.message).join("; ")}`);
            }
            // the first sync is saved at once: "never synced" must not come back after a restart
            if (first) await this.saveSeen(peer);
        } catch (err) {
            peer.sync = { ...peer.sync, lastFailure: { at: this.now(), error: errorMessage(err) } };
            // a link that can't carry a pull is made again; a store that couldn't keep what came keeps the link
            if (err instanceof LinkError) {
                if (peer.link === link) link.fail(err.message);
            } else {
                logger.error(`[network] pulling from ${peer.id} failed:`, err); // quiet: the failure is the peer's sync state, which the network status reports
            }
        } finally {
            peer.pulling = false;
            this.changed();
        }
        if (peer.pullAgain) {
            peer.pullAgain = false;
            await this.pull(peer);
        }
    }

    /** every linked peer hears, once the changes settle, that there is something to pull */
    private tellPeers(): void {
        for (const peer of this.peers.values()) {
            if (!peer.link || peer.noticeTimer) continue;
            peer.noticeTimer = setTimeout(() => {
                peer.noticeTimer = null;
                peer.link?.notify();
            }, this.timing.noticeDebounceMs);
            peer.noticeTimer.unref?.();
        }
    }

    // ─── Presence ────────────────────────────────────────────────────────────

    private saveSeen(peer: Peer): Promise<void> {
        const seen = { lastSeen: this.now(), ...(peer.sync.lastSuccessAt !== null ? { lastSync: peer.sync.lastSuccessAt } : {}) };
        return this.options.roster.observe(peer.id, seen).catch((err) => {
            logger.error(`[network] when ${peer.id} was last seen couldn't be saved (it is kept in memory, and saved again):`, err); // quiet: presence is reported from memory; the next save writes it
        });
    }

    /** Who is online, how each member is reached, and how syncing with it went. */
    status(): NetworkStatus {
        const { roster, store } = this.options;
        const peers: PeerStatus[] = [];
        for (const member of roster.list()) {
            if (member.id === this.self) continue;
            const peer = this.peers.get(member.id);
            const seen = roster.observed(member.id);
            const lastSuccessAt = peer?.sync.lastSuccessAt ?? null;
            peers.push({
                id: member.id,
                online: !!peer?.link,
                lastSeen: peer?.link ? this.now() : (peer?.lastSeenAt ?? seen.lastSeen ?? null),
                reach: this.reachOf(member.id, peer, !!member.dial),
                sync: {
                    state: lastSuccessAt !== null || seen.lastSync !== undefined ? "synced" : "never",
                    lastSuccessAt: lastSuccessAt ?? seen.lastSync ?? null,
                    lastFailure: peer?.sync.lastFailure ?? null,
                    lastPull: peer?.sync.lastPull ?? null,
                },
            });
        }
        return { self: this.self, listening: this.options.listening, held: store.heldCount, peers };
    }

    private reachOf(id: string, peer: Peer | undefined, hasAddress: boolean): Reach {
        if (peer?.link) return { state: "linked", dialedBy: peer.link.dialer === this.self ? "this" : "peer", since: peer.link.opened };
        const dialable = this.dialable();
        if (!hasAddress) {
            return dialable
                ? { state: "waiting", reason: "This computer has no address for it; it dials this one", dialsAt: null }
                : {
                      state: "unreachable",
                      reason: this.options.listening
                          ? "Neither computer knows an address for the other"
                          : "This computer accepts no links, and has no address for it: they sync only through a computer both link to",
                  };
        }
        if (dialable && id < this.self && !(peer && (peer.attempts || peer.dialing)) && this.now() < (peer?.unlinkedSince ?? 0) + this.timing.takeoverMs) {
            return { state: "waiting", reason: "It dials this computer", dialsAt: (peer?.unlinkedSince ?? this.now()) + this.timing.takeoverMs };
        }
        return { state: "dialing", attempts: peer?.attempts ?? 0, lastError: peer?.lastDialError ?? null, nextAttemptAt: peer?.dialing ? null : (peer?.retryAt ?? null) };
    }

    private clearTimers(peer: Peer): void {
        if (peer.timer) clearTimeout(peer.timer);
        if (peer.noticeTimer) clearTimeout(peer.noticeTimer);
        peer.timer = null;
        peer.noticeTimer = null;
    }

    private changed(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                logger.error("[network] a status listener failed:", err); // quiet: one listener's failure must not stop the links or the other listeners
            }
        }
    }
}
