// Links: how the computers of a network reach each other. Every pair of
// members keeps one WebSocket on /network, on the daemon's TLS port, and
// syncs its record stores over it. Who may link is the roster: a peer is
// accepted only when it proves it holds a key that hashes to a current
// member id, and a member that stops being one is cut at once.
//
// ─── Proving who is on each end ──────────────────────────────────────────────
//
// The dialer knows whom it dialed: it trusts only that member's certificate
// and checks the key the TLS handshake presents hashes to its id. The
// answering side asks for no client certificate (browsers, WebDAV clients
// and the app share the port, and a certificate request shows a browser's
// picker or breaks some clients), so the dialer proves itself in the link's
// first messages, and nothing else is read until it has:
//
//   answerer → {"t":"hello","v":1,"nonce":"<base64, 32 random bytes>"}
//   dialer   → {"t":"proof","cert":<PEM>,"dialed":<member id>,"sig":"<base64>"}
//   answerer → {"t":"welcome"}     or closes with 4003 (not a member) or
//                                  4004 (not proven)
//
//   proof = "PBL1"                  4 ASCII bytes: a link proof, version 1
//           u8(32) nonce            the answerer's nonce for this socket
//           str(dialer)             member id of cert's key (memberId.ts)
//           str(dialed)             member id of the key the dialer pinned
//   sig   = ECDSA P-256 with SHA-256 over `proof` by the dialer's daemon key,
//           IEEE P1363 (r ‖ s, 64 bytes), as records are signed (record.ts)
//
//   str(s) = u16(byte length of UTF-8 s) ‖ UTF-8 s
//
// Why each field:
//   "PBL1"  the same key signs records ("PBR1", record.ts): no proof is ever
//           a record's signature, nor a record's signature a proof
//   nonce   fresh from the answerer for each socket, so a proof seen once
//           opens no other socket: a replay signs the wrong nonce
//   dialer  the id the signature is for, checked against the cert's key:
//           the signature counts only for the computer it names
//   dialed  whom the dialer was talking to. Without it a member M that C
//           dials could hand C a nonce it got from dialing B, and pass C's
//           answer to B as its own link from C. C signs "dialed = M", which B
//           refuses: it isn't M.
// The answering side accepts when the cert's key hashes to a current member
// id other than its own, `dialed` is its own id, and sig verifies. The link
// needs no binding to the TLS session: only the dialer could have opened it
// (it pinned the answerer's key), and the nonce came over that session.
//
// An unproven socket may send one frame (at most 64 KiB, below), and only
// a proof; it must prove itself within proofTimeoutMs, and only a few may be
// open at once, in all and per address. The link endpoint holds nothing for
// anyone who can't prove.
//
// ─── Who dials ───────────────────────────────────────────────────────────────
//
// A member is dialed where this computer last reached it, then where it says
// it listens (Roster.dialsOf). Of two members that can both be dialed,
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
// Each message is one text frame, or, when its JSON is longer than 16384
// UTF-16 units, its JSON cut into frames of that many: "+" ‖ part for each
// but the last, "=" ‖ part for the last (a whole message begins with "{").
// So no frame is bigger than 64 KiB, and a whole message at most 64 MiB.
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
import * as crypto from "crypto";
import type * as http from "http";
import type { Socket } from "net";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import { logger } from "../core/logger";
import { TLS_SERVER_NAME, type TlsIdentity } from "../security/tlsIdentity";
import { memberIdOf } from "./memberId";
import type { Roster } from "./roster";
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
    /** the dialer didn't prove it holds the key it claims, in time */
    unproven: 4004,
} as const;

// a batch is at most this many records, and a record's body at most 1 MiB
// (1.4 MB as base64): a full batch fits the payload limit
const PULL_LIMIT = 32;
const MAX_SERVED_LIMIT = 500;
const MAX_LINK_PAYLOAD = 64 * 1024 * 1024;
// No WebSocket frame is bigger than this, proven or not: a message longer
// than PART_CHARS goes as parts (the format at the top of this file), and a
// UTF-8 character is at most 3 bytes per UTF-16 unit. So a socket that hasn't
// proven itself can make this computer hold one small frame, never a whole
// batch, on Bun's ws and Node's alike.
const PART_CHARS = 16 * 1024;
const MAX_FRAME = 64 * 1024;
// requests a peer may have waiting on this side at once; a pull makes one
const MAX_INBOUND_REQUESTS = 4;
// the largest certificate a proof may carry: what a roster record holds
const MAX_PROOF_CERT = 16 * 1024;
const NONCE_BYTES = 32;
const PROOF_TAG = "PBL1";
// refused computers each said once, up to this many lines an hour; the rest are counted in one line
const REFUSALS_REMEMBERED = 64;
const REFUSAL_LINES_PER_HOUR = 16;
const HOUR_MS = 60 * 60_000;

function str(value: string): Buffer {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length);
    return Buffer.concat([length, bytes]);
}

/** The bytes a dialer signs to prove it holds `dialer`'s key to the computer `dialed`, on the socket `nonce` was sent on (the format above). */
export function linkProofBytes(nonce: Buffer, dialer: string, dialed: string): Buffer {
    if (nonce.length !== NONCE_BYTES) throw new Error(`A link nonce is ${NONCE_BYTES} bytes`);
    return Buffer.concat([Buffer.from(PROOF_TAG, "ascii"), Buffer.from([NONCE_BYTES]), nonce, str(dialer), str(dialed)]);
}

/** The proof message a dialer holding `identity` answers a hello with, having dialed the computer `dialed`. */
export function linkProof(identity: TlsIdentity, nonce: Buffer, dialed: string): { t: "proof"; cert: string; dialed: string; sig: string } {
    const sig = crypto.sign("sha256", linkProofBytes(nonce, memberIdOf(identity.cert), dialed), { key: identity.key, dsaEncoding: "ieee-p1363" });
    return { t: "proof", cert: identity.cert, dialed, sig: sig.toString("base64") };
}

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
    /** how long a dialer has to prove itself */
    proofTimeoutMs: number;
}

export interface LinkLimits {
    /** sockets not yet proven that may be open at once */
    unprovenTotal: number;
    /** ...from one address */
    unprovenPerAddress: number;
}

export const DEFAULT_LINK_LIMITS: LinkLimits = { unprovenTotal: 64, unprovenPerAddress: 8 };

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
    proofTimeoutMs: 10_000,
};

export interface NetworkLinksOptions {
    identity: TlsIdentity;
    roster: Roster;
    store: RecordStore;
    /** whether other computers can dial this one: it has a TLS listener */
    listening: boolean;
    timing?: Partial<LinkTiming>;
    limits?: Partial<LinkLimits>;
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
    /** sockets on /network whose dialer hasn't proven itself yet */
    unproven: number;
    peers: PeerStatus[];
}

const ANOTHER_COMPUTER = "another computer answered there";

/** Why a dial linked at none of a member's addresses: every address and what it did, and what that says most of. */
interface DialFailure {
    why: string;
    /** "refused": the computer said no (it doesn't count this one as a member); "other-computer": something else answered; "no-answer": nothing that could link did */
    kind: "refused" | "other-computer" | "no-answer";
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
    /** the parts of a message still coming */
    private parts: string[] = [];
    private partsLength = 0;
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

    /** what came after the proof exchange, before this link listened, read now in order */
    begin(early: RawData[]): void {
        for (const data of early) {
            if (this.closed) return;
            this.receive(data);
        }
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
        const failed = (err?: Error | null) => {
            if (err) this.ended(LINK_CLOSE.protocol, `sending to ${this.peer} failed: ${errorMessage(err)}`);
        };
        const text = JSON.stringify(message);
        if (text.length <= PART_CHARS) return this.ws.send(text, failed);
        for (let at = 0; at < text.length; ) {
            let end = Math.min(at + PART_CHARS, text.length);
            // never between the two halves of a surrogate pair: half of one would go as U+FFFD
            const before = text.charCodeAt(end - 1);
            if (end < text.length && before >= 0xd800 && before <= 0xdbff) end--;
            this.ws.send(`${end === text.length ? "=" : "+"}${text.slice(at, end)}`, failed);
            at = end;
        }
    }

    /** a frame: a whole message, or a part of one (the format at the top of this file) */
    private receive(data: RawData): void {
        this.answered = true;
        const frame = data.toString();
        if (frame[0] === "+" || frame[0] === "=") {
            // an empty part adds nothing to the length that bounds them: endless ones would still be kept
            if (frame.length === 1 && frame[0] === "+") return this.fail(`${this.peer} sent an empty part of a message`);
            this.partsLength += frame.length - 1;
            if (this.partsLength > MAX_LINK_PAYLOAD) return this.fail(`${this.peer} sent a message over ${MAX_LINK_PAYLOAD} characters`);
            this.parts.push(frame.slice(1));
            if (frame[0] === "+") return;
            const whole = this.parts.join("");
            this.parts = [];
            this.partsLength = 0;
            return this.handle(whole);
        }
        if (this.parts.length) return this.fail(`${this.peer} began a message before it finished the last`);
        this.handle(frame);
    }

    private handle(text: string): void {
        let message: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(text);
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
    return memberIdOfPem(pemOf(raw));
}

function memberIdOfPem(pem: string): string | null {
    try {
        return memberIdOf(pem);
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

function refuse(socket: Duplex, reason: string): void {
    socket.end(`HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`);
}

/**
 * Whether `sig` is the P-256 signature of the key in `cert` over `proof`. A
 * certificate anyone may send: any other kind of key proves nothing, and
 * nothing in it makes this throw.
 */
function proofVerifies(cert: string, proof: Buffer, sig: Buffer): boolean {
    try {
        const key = new crypto.X509Certificate(cert).publicKey;
        if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return false;
        return crypto.verify("sha256", proof, { key, dsaEncoding: "ieee-p1363" }, sig);
    } catch {
        return false; // quiet: a certificate verification can't use proves nothing, and the caller closes the socket for it
    }
}

/** a link message's JSON object, or null for anything else */
function parseMessage(data: RawData): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(data.toString());
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null; // quiet: what isn't JSON isn't a link message, and the caller closes the socket for it
    }
}

function decodeBase64(value: unknown, bytes: number): Buffer | null {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
    const decoded = Buffer.from(value, "base64");
    return decoded.length === bytes ? decoded : null;
}

/** closes a socket that never became a link, and lets go of it if the other end doesn't answer the close */
function closeUnlinked(ws: WebSocket, code: number, reason: string, graceMs: number): void {
    ws.close(code, Buffer.from(reason).subarray(0, 120).toString());
    const hard = setTimeout(() => ws.terminate(), graceMs);
    hard.unref?.();
    ws.once("close", () => clearTimeout(hard));
}

/**
 * Says each refused computer once, and no more than a few lines an hour;
 * past that, one line counts the rest. A stranger with a new key for every
 * try grows neither memory nor the log.
 */
class RefusalLog {
    private readonly said = new Set<string>();
    private windowStart: number;
    private lines = 0;
    private unsaid = 0;

    constructor(private readonly now: () => number) {
        this.windowStart = now();
    }

    refused(who: string, line: () => string): void {
        const now = this.now();
        if (now - this.windowStart >= HOUR_MS) {
            this.flush();
            this.windowStart = now;
            this.lines = 0;
        }
        if (this.said.has(who)) return;
        if (this.lines >= REFUSAL_LINES_PER_HOUR) {
            this.unsaid++;
            return;
        }
        this.lines++;
        this.said.add(who);
        // the oldest is forgotten first: it may be said once more
        if (this.said.size > REFUSALS_REMEMBERED) this.said.delete(this.said.values().next().value!);
        logger.warn(`${line()} (it is refused again without a word)`);
    }

    /** the one line for what wasn't said */
    flush(): void {
        if (!this.unsaid) return;
        logger.warn(`[network] refused ${this.unsaid} more link(s) in the last hour, past what the log says one by one`);
        this.unsaid = 0;
    }
}

/** This computer's links to the other members, and the sync over them. */
export class NetworkLinks {
    readonly self: string;
    private readonly timing: LinkTiming;
    private readonly now: () => number;
    private readonly random: () => number;
    private readonly peers = new Map<string, Peer>();
    private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
    private readonly listeners = new Set<() => void>();
    private readonly limits: LinkLimits;
    private readonly refusals: RefusalLog;
    /** sockets on /network that haven't proven themselves, by address */
    private readonly unproven = new Map<string, Set<WebSocket | Duplex>>();
    private unprovenCount = 0;
    private readonly pulls = new Set<Promise<void>>();
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
        this.limits = { ...DEFAULT_LINK_LIMITS, ...options.limits };
        this.refusals = new RefusalLog(this.now);
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
        for (const sockets of this.unproven.values()) {
            for (const socket of sockets) socket instanceof WebSocket ? socket.terminate() : socket.destroy();
        }
        this.wss.close();
        this.refusals.flush();
        // a pull mid-write finishes its write; its next request fails at once, its link being closed
        await Promise.all([...saves, ...this.pulls]);
    }

    /** Hears every change to what status() reports. */
    onStatus(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // ─── Accepting ───────────────────────────────────────────────────────────

    /**
     * An upgrade to /network on the daemon's TLS listener. Whoever dialed
     * is told a nonce and has proofTimeoutMs to prove, by the format at the
     * top of this file, that it holds a member's key; until then nothing
     * it sends is read but its proof.
     */
    accept(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        if (this.stopped || !this.started) return refuse(socket, "This computer isn't linking right now");
        const address = ((socket as Socket).remoteAddress ?? "unknown").replace(/^::ffff:/, "");
        const fromAddress = this.unproven.get(address)?.size ?? 0;
        if (this.unprovenCount >= this.limits.unprovenTotal || fromAddress >= this.limits.unprovenPerAddress) {
            this.refusals.refused(`busy:${address}`, () => `[network] refused a link from ${address}: ${fromAddress >= this.limits.unprovenPerAddress ? `${fromAddress} links from there are` : `${this.unprovenCount} links are`} still to prove themselves`);
            return refuse(socket, "Too many links are being made to this computer right now");
        }
        // counted from here until the socket proves itself or closes, whatever the upgrade does
        let current: WebSocket | Duplex = socket;
        const sockets = this.unproven.get(address) ?? new Set();
        this.unproven.set(address, sockets);
        sockets.add(current);
        this.unprovenCount++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            sockets.delete(current);
            if (!sockets.size && this.unproven.get(address) === sockets) this.unproven.delete(address);
            this.unprovenCount--;
        };
        socket.once("close", release);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
            sockets.delete(current);
            current = ws;
            sockets.add(ws);
            this.challenge(ws, address, release);
        });
    }

    /** the proof exchange on an accepted socket: a link when the dialer proves it is a member, closed otherwise */
    private challenge(ws: WebSocket, address: string, release: () => void): void {
        const nonce = crypto.randomBytes(NONCE_BYTES);
        let done = false;
        const finish = () => {
            done = true;
            clearTimeout(deadline);
            ws.off("message", onMessage);
            release();
        };
        const fail = (code: number, why: string) => {
            if (done) return;
            finish();
            closeUnlinked(ws, code, why, this.timing.connectTimeoutMs);
        };
        const deadline = setTimeout(() => fail(LINK_CLOSE.unproven, `Didn't prove itself within ${this.timing.proofTimeoutMs} ms`), this.timing.proofTimeoutMs);
        deadline.unref?.();
        const onMessage = (data: RawData) => {
            if (done) return;
            const message = parseMessage(data);
            if (message?.t !== "proof") return fail(LINK_CLOSE.unproven, "Sent something other than a proof before proving itself");
            const { cert, dialed } = message;
            const sig = decodeBase64(message.sig, 64);
            const id = typeof cert === "string" && cert.length <= MAX_PROOF_CERT ? memberIdOfPem(cert) : null;
            if (!id || !sig) return fail(LINK_CLOSE.unproven, "Its proof is damaged");
            if (dialed !== this.self) return fail(LINK_CLOSE.unproven, "Its proof is for another computer");
            if (!proofVerifies(cert as string, linkProofBytes(nonce, id, this.self), sig)) return fail(LINK_CLOSE.unproven, "Its proof doesn't verify on this link");
            if (id === this.self || !this.options.roster.isMember(id)) {
                this.refusals.refused(id, () => `[network] refused a link from ${id} at ${address}: not a member of this network`);
                return fail(LINK_CLOSE.notMember, "This computer isn't one of this network's members");
            }
            finish();
            ws.send(JSON.stringify({ t: "welcome" }));
            this.adopt(ws, id, id, () => []);
        };
        // a part of a longer message is something other than a proof too: a proof is one frame
        ws.on("message", onMessage);
        ws.on("error", () => fail(LINK_CLOSE.protocol, "Its socket failed")); // quiet: an unproven socket's failure is nobody's link failing
        ws.once("close", finish);
        ws.send(JSON.stringify({ t: "hello", v: 1, nonce: nonce.toString("base64") }));
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
            if (roster.isMember(id)) continue;
            this.clearTimers(peer);
            peer.socket?.terminate();
            peer.link?.close(LINK_CLOSE.notMember, "No longer a member of this network");
            this.peers.delete(id);
        }
        for (const member of roster.list()) {
            if (!roster.isMember(member.id)) continue;
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
        const dials = this.options.roster.dialsOf(peer.id);
        if (!member || !dials.length) return;
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
        void this.dial(peer, dials, member.cert).then((linked) => {
            if (linked || this.stopped || !this.peers.has(peer.id)) return;
            this.consider(peer);
        });
    }

    /** the dial the rule at the top of this file makes: each address in turn, a backoff when none links; true once a link is up */
    private async dial(peer: Peer, dials: { host: string; port: number }[], cert: string): Promise<boolean> {
        if (peer.dialing) return false;
        peer.dialing = true;
        let failed: DialFailure | null;
        try {
            failed = await this.reach(peer, dials, cert);
        } finally {
            peer.dialing = false;
        }
        if (failed === null) return true;
        this.backOff(peer, failed.why, failed.kind === "refused");
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

    /** each address in turn until one links: null then, else why the last one didn't, and whether the peer itself said no */
    private async reach(peer: Peer, dials: { host: string; port: number }[], cert: string): Promise<DialFailure | null> {
        const failures: { at: string; error: string; kind: DialFailure["kind"] }[] = [];
        const stoppedHere: DialFailure = { why: "this computer stopped linking to it", kind: "no-answer" };
        for (const { host, port } of dials) {
            if (peer.link) return null;
            if (this.stopped || !this.peers.has(peer.id)) return stoppedHere;
            const at = `${bracket(host)}:${port}`;
            try {
                const { ws, take } = await this.connect(peer, host, port, cert);
                if (this.stopped || !this.peers.has(peer.id)) {
                    ws.terminate();
                    return stoppedHere;
                }
                if (this.adopt(ws, peer.id, this.self, take)) {
                    // where this computer reached it before didn't answer, and where it says it listens did: it is reached there from now on
                    this.options.roster.reachedAt(peer.id, { host, port }).catch((err) => {
                        logger.error(`[network] where ${peer.id} answered couldn't be saved (it is dialed there first again next time):`, err); // quiet: the dial order only; the next link tries again
                    });
                    return null;
                }
                failures.push({ at, error: "the link closed as it opened", kind: "no-answer" });
            } catch (err) {
                const error = errorMessage(err);
                const kind = err instanceof RefusedError ? "refused" : error.includes(ANOTHER_COMPUTER) ? "other-computer" : "no-answer";
                failures.push({ at, error, kind });
            }
        }
        if (!failures.length) return { why: "it has no address", kind: "no-answer" };
        // the one that says most about why: it said no, then something else answered, then nothing did
        const kind = failures.some((f) => f.kind === "refused") ? "refused" : failures.some((f) => f.kind === "other-computer") ? "other-computer" : "no-answer";
        return { why: failures.map((f) => `${f.at}: ${f.error}`).join("; "), kind };
    }

    /**
     * One TLS WebSocket to one address: the peer's key is checked before
     * anything is sent, then this computer proves itself (the format at the
     * top of this file). What the peer sends after its welcome, before the
     * link listens, is handed over in order.
     */
    private connect(peer: Peer, host: string, port: number, cert: string): Promise<{ ws: WebSocket; take: () => RawData[] }> {
        const { identity } = this.options;
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`wss://${bracket(host)}:${port}${LINK_PATH}`, {
                // the member's own certificate is the only one trusted; its key is what is checked
                ca: [cert],
                servername: TLS_SERVER_NAME,
                checkServerIdentity: (_host: string, presented: { raw?: Buffer }) =>
                    memberIdOfRaw(presented.raw) === peer.id ? undefined : new Error(ANOTHER_COMPUTER),
                handshakeTimeout: this.timing.connectTimeoutMs,
                maxPayload: MAX_FRAME,
                perMessageDeflate: false,
            } as ConstructorParameters<typeof WebSocket>[2]);
            peer.socket = ws;
            const early: RawData[] = [];
            let phase: "hello" | "welcome" | "linked" = "hello";
            let settled = false;
            const settle = (err: Error | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(deadline);
                if (peer.socket === ws) peer.socket = null;
                if (err) {
                    ws.terminate();
                    reject(err);
                } else {
                    resolve({
                        ws,
                        take: () => {
                            ws.off("message", onMessage);
                            return early.splice(0);
                        },
                    });
                }
            };
            // the upgrade, the hello and the welcome, all within one connect timeout
            const deadline = setTimeout(() => settle(new Error(`didn't link within ${this.timing.connectTimeoutMs} ms`)), this.timing.connectTimeoutMs);
            deadline.unref?.();
            const onMessage = (data: RawData) => {
                // after the welcome, kept for the link until it takes them
                if (phase === "linked") {
                    early.push(data);
                    return;
                }
                const message = parseMessage(data);
                if (phase === "hello" && message?.t === "hello" && message.v === 1) {
                    const nonce = decodeBase64(message.nonce, NONCE_BYTES);
                    if (!nonce) return settle(new Error("it sent a damaged hello"));
                    phase = "welcome";
                    ws.send(JSON.stringify(linkProof(identity, nonce, peer.id)));
                    return;
                }
                if (phase === "welcome" && message?.t === "welcome") {
                    phase = "linked";
                    return settle(null);
                }
                settle(new Error("it sent something that isn't a link message"));
            };
            ws.on("message", onMessage);
            ws.once("unexpected-response", (_req, res) => settle(new Error(`refused the link (${res.statusCode}): ${res.statusMessage || "no reason given"}`)));
            ws.on("error", (err) => settle(err)); // the link listens for its own once it has one
            ws.once("close", (code, reason) => {
                const why = reason.length ? reason.toString() : "no reason given";
                if (code === LINK_CLOSE.notMember) settle(new RefusedError(`refused the link (${code}): this computer isn't one of its members`));
                else settle(new Error(`closed before it linked (${code}: ${why})`));
            });
        });
    }

    // ─── A link ──────────────────────────────────────────────────────────────

    /**
     * A proven socket, either way: kept as the peer's link unless a better
     * one is up. `take` hands over what came before the link listened.
     * True when the peer has a link after it.
     */
    private adopt(ws: WebSocket, id: string, dialer: string, take: () => RawData[]): boolean {
        // a member the roster has and the links haven't taken in yet (its change is on its way)
        if (!this.peers.has(id) && !this.stopped && this.options.roster.isMember(id)) this.reconcile();
        const peer = this.peers.get(id);
        if (!peer || this.stopped) {
            closeUnlinked(ws, peer ? 1001 : LINK_CLOSE.notMember, peer ? "This computer's Paperboard stopped" : "Not a member of this network", this.timing.connectTimeoutMs);
            return false;
        }
        // a socket that closed between its welcome and now
        if (ws.readyState !== WebSocket.OPEN) {
            ws.terminate();
            return !!peer.link;
        }
        const early = take();
        const link = new Link(ws, id, dialer, this.now(), this.timing, {
            request: (op, params) => this.answer(op, params),
            notice: () => this.startPull(peer),
            closed: (ended, code, reason) => this.linkClosed(peer, ended, code, reason),
        });
        const current = peer.link;
        if (current && !current.closed) {
            // the same rule on both sides: the smaller id's dial, else the newer
            const keepCurrent = current.dialer !== link.dialer ? current.dialer < link.dialer : false;
            const loser = keepCurrent ? link : current;
            if (keepCurrent) {
                loser.close(LINK_CLOSE.duplicate, "Another link to this computer is kept");
                return true;
            }
            // first, so the old link's close isn't taken for the peer going; its pull fails, and the new link's (queued behind it) takes over
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
        link.begin(early);
        this.startPull(peer);
        this.changed();
        return true;
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

    /** a pull stop() waits for: its store writes end before the store closes */
    private startPull(peer: Peer): void {
        const pulling = this.pull(peer);
        this.pulls.add(pulling);
        void pulling.finally(() => this.pulls.delete(pulling));
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
            // a link replaced by another mid-pull didn't fail to sync: the pull over the new one is queued
            const superseded = err instanceof LinkError && peer.link !== null && peer.link !== link;
            if (!superseded) peer.sync = { ...peer.sync, lastFailure: { at: this.now(), error: errorMessage(err) } };
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
            if (!roster.isMember(member.id)) continue;
            if (member.id === this.self) continue;
            const peer = this.peers.get(member.id);
            const seen = roster.observed(member.id);
            const lastSuccessAt = peer?.sync.lastSuccessAt ?? null;
            peers.push({
                id: member.id,
                online: !!peer?.link,
                lastSeen: peer?.link ? this.now() : (peer?.lastSeenAt ?? seen.lastSeen ?? null),
                reach: this.reachOf(member.id, peer, this.options.roster.dialsOf(member.id).length > 0),
                sync: {
                    state: lastSuccessAt !== null || seen.lastSync !== undefined ? "synced" : "never",
                    lastSuccessAt: lastSuccessAt ?? seen.lastSync ?? null,
                    lastFailure: peer?.sync.lastFailure ?? null,
                    lastPull: peer?.sync.lastPull ?? null,
                },
            });
        }
        return { self: this.self, listening: this.options.listening, held: store.heldCount, unproven: this.unprovenCount, peers };
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
