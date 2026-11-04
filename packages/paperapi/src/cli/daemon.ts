// The developer CLI's connection to the Paperboard server daemon on this
// computer, as its host.
//
// The daemon writes its loopback port and host token to local/crane.json
// under the data directory (PAPERBOARD_DIR, or ~/.paperboard). The token is
// full access, so it is only sent to a listener that first proves it holds
// the same token: the socket opens with a random challenge header, and the
// daemon answers with an HMAC of it before anything else is sent.
import crypto from "crypto";
import fs from "fs";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../protocol";
import { CliError } from "./output";
import { handshakePath } from "./paths";

const CHALLENGE_HEADER = "x-papercrane-challenge";
const PROOF_TYPE = "daemon-proof";
const PROOF_CONTEXT = "papercrane-local-proof-v1\n";
const CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;


export interface Handshake {
    port: number;
    token: string;
    file: string;
}

const NOT_RUNNING_HINT = "Start Paperboard, or set PAPERBOARD_DIR to the data folder of the Paperboard you run.";

/** No daemon answers right now: it is stopped, starting, or restarting. Waiting can fix this one. */
export class DaemonUnavailable extends CliError {
    constructor(message: string, hint: string | undefined = NOT_RUNNING_HINT) {
        super(message, hint);
        this.name = "DaemonUnavailable";
    }
}

/** Reads crane.json, refusing anything that is not a running daemon's handshake. */
export function readHandshake(): Handshake {
    const file = handshakePath();
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new DaemonUnavailable(`Paperboard isn't running: there is no ${file}`);
        }
        throw new CliError(`Couldn't read ${file}: ${(err as Error).message}`);
    }
    let raw: any;
    try {
        raw = JSON.parse(text);
    } catch (err) {
        throw new CliError(`${file} is not valid JSON: ${(err as Error).message}`);
    }
    if (!raw || typeof raw !== "object" || typeof raw.port !== "number" || !Number.isInteger(raw.port) || raw.port <= 0) {
        throw new CliError(`${file} has no valid port`);
    }
    if (raw.token === null) {
        throw new CliError(
            `The Paperboard on port ${raw.port} runs with --no-auth, so it cannot prove who it is`,
            "The developer CLI only sends commands to a daemon that can; start it without --no-auth.",
        );
    }
    if (typeof raw.token !== "string" || raw.token.length === 0) {
        throw new CliError(`${file} has no valid token`);
    }
    return { port: raw.port, token: raw.token, file };
}

function proofFor(token: string, challenge: string): string {
    return crypto.createHmac("sha256", token).update(`${PROOF_CONTEXT}${challenge}`).digest("hex");
}

function proofMatches(token: string, challenge: string, proof: unknown): boolean {
    if (typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) return false;
    return crypto.timingSafeEqual(Buffer.from(proofFor(token, challenge)), Buffer.from(proof));
}

/** An answer the daemon refused, with its machine-readable code. */
export class DaemonError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(message);
        this.name = "DaemonError";
    }
}

interface Pending {
    resolve: (value: any) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
}

export interface CloseInfo {
    code: number;
    reason: string;
}

/** An authenticated host connection to the local daemon. */
export class HostConnection {
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private frameListeners = new Set<(frame: any) => void>();
    private closeListeners = new Set<(info: CloseInfo) => void>();
    private closed: CloseInfo | null = null;
    // why this side ended the connection, when it was this side
    private failure: string | null = null;

    private constructor(
        private socket: WebSocket,
        public readonly handshake: Handshake,
    ) {
        socket.on("message", (raw) => this.receive(raw.toString()));
        // the close that follows reports it; an unheard error event would throw
        socket.on("error", (err) => {
            this.failure ??= err.message;
        });
        socket.on("close", (code, reason) => {
            this.closed = { code, reason: this.failure ?? reason.toString() };
            const why = this.closed.reason || `connection closed (${code})`;
            for (const [, call] of this.pending) {
                clearTimeout(call.timer);
                call.reject(new CliError(`Paperboard closed the connection: ${why}`));
            }
            this.pending.clear();
            for (const listener of this.closeListeners) listener(this.closed);
        });
    }

    /** Opens, proves the daemon's identity, then signs in with the host token. */
    static async open(handshake: Handshake = readHandshake()): Promise<HostConnection> {
        const socket = await verifiedSocket(handshake);
        const connection = new HostConnection(socket, handshake);
        try {
            await connection.request("auth:verify", {}, CONNECT_TIMEOUT_MS);
        } catch (err) {
            connection.close();
            if (err instanceof DaemonError) {
                throw new CliError(`Paperboard refused this computer's host token: ${err.message}`, NOT_RUNNING_HINT);
            }
            throw err;
        }
        return connection;
    }

    get address(): string {
        return `127.0.0.1:${this.handshake.port}`;
    }

    /** Sends a request and resolves with its result, or rejects with the daemon's error. */
    request<T = any>(action: string, params: Record<string, unknown> = {}, timeoutMs: number | null = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
        if (this.closed) return Promise.reject(new CliError("The connection to Paperboard is closed"));
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const call: Pending = { resolve, reject };
            if (timeoutMs !== null) {
                call.timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new CliError(`Paperboard did not answer ${action} within ${Math.round(timeoutMs / 100) / 10} s`));
                }, timeoutMs);
            }
            this.pending.set(id, call);
            // the token goes last so no params object can replace it
            this.socket.send(JSON.stringify({ id, action, params: { ...params, token: this.handshake.token, v: PROTOCOL_VERSION } }));
        });
    }

    /** Every frame that is not an answer to a request: events, monitor records. */
    onFrame(listener: (frame: any) => void): () => void {
        this.frameListeners.add(listener);
        return () => this.frameListeners.delete(listener);
    }

    onClose(listener: (info: CloseInfo) => void): () => void {
        this.closeListeners.add(listener);
        return () => this.closeListeners.delete(listener);
    }

    close(): void {
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close(1000);
    }

    private receive(text: string): void {
        let frame: any;
        try {
            frame = JSON.parse(text);
        } catch (err) {
            // the daemon only speaks JSON; anything else is a broken peer
            this.failure = `Paperboard sent a frame that is not JSON: ${(err as Error).message}`;
            this.socket.close(1007, "Malformed frame");
            return;
        }
        if (frame?.type === "response" && typeof frame.id === "number") {
            const call = this.pending.get(frame.id);
            if (!call) return;
            this.pending.delete(frame.id);
            clearTimeout(call.timer);
            if (frame.error) call.reject(new DaemonError(String(frame.error), typeof frame.code === "string" ? frame.code : undefined));
            else call.resolve(frame.result);
            return;
        }
        for (const listener of this.frameListeners) listener(frame);
    }
}

function verifiedSocket(handshake: Handshake): Promise<WebSocket> {
    const challenge = crypto.randomBytes(32).toString("hex");
    const address = `127.0.0.1:${handshake.port}`;
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${address}`, {
            headers: { [CHALLENGE_HEADER]: challenge },
            handshakeTimeout: CONNECT_TIMEOUT_MS,
        });
        let settled = false;
        const fail = (err: CliError) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.terminate();
            reject(err);
        };
        const timer = setTimeout(() => fail(new DaemonUnavailable(`Paperboard on ${address} did not prove its identity in time`)), CONNECT_TIMEOUT_MS);
        socket.once("message", (raw) => {
            let frame: any = null;
            try {
                frame = JSON.parse(raw.toString());
            } catch (err) {
                fail(new CliError(`The listener on ${address} is not Paperboard: its first frame is not JSON (${(err as Error).message})`));
                return;
            }
            if (frame?.type !== PROOF_TYPE || !proofMatches(handshake.token, challenge, frame.proof)) {
                fail(new DaemonUnavailable(
                    `The listener on ${address} could not prove it is the Paperboard that wrote ${handshake.file}`,
                    "That handshake may be left over from a Paperboard that stopped; start Paperboard again.",
                ));
                return;
            }
            settled = true;
            clearTimeout(timer);
            socket.removeAllListeners();
            resolve(socket);
        });
        socket.once("error", (err: NodeJS.ErrnoException) => {
            fail(err.code === "ECONNREFUSED"
                ? new DaemonUnavailable(`Paperboard isn't running: nothing listens on ${address} (from ${handshake.file})`)
                : new DaemonUnavailable(`Couldn't reach Paperboard on ${address}: ${err.message}`, undefined));
        });
        socket.once("close", (code, reason) => {
            fail(new DaemonUnavailable(`Paperboard on ${address} closed the connection before proving its identity${reason.length ? `: ${reason}` : ` (${code})`}`, undefined));
        });
    });
}
