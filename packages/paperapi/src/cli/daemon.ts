// The developer CLI's connection to the Paperboard server daemon on this
// computer, as its host. The handshake and the daemon's proof are shared
// with the SDK transport (transport/localHandshake.ts).
import crypto from "crypto";
import fs from "fs";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type RpcAction, type RpcParams, type RpcResult } from "../protocol";
import { challengeDaemon, HandshakeError, NOT_RUNNING_HINT, readHandshake as readHandshakeFile, type Handshake } from "../transport/localHandshake";
import { CliError } from "./output";
import { handshakePath } from "./paths";

const CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type { Handshake };

/** No daemon answers right now: it is stopped, starting, or restarting. Waiting can fix this one. */
export class DaemonUnavailable extends CliError {
    constructor(message: string, hint: string | undefined = NOT_RUNNING_HINT) {
        super(message, hint);
        this.name = "DaemonUnavailable";
    }
}

function cliErrorOf(err: HandshakeError): CliError {
    return err.unavailable ? new DaemonUnavailable(err.message, err.hint) : new CliError(err.message, err.hint);
}

/** Reads crane.json, refusing anything that is not a running daemon's handshake. */
export function readHandshake(): Handshake {
    try {
        return readHandshakeFile(fs, handshakePath());
    } catch (err) {
        throw err instanceof HandshakeError ? cliErrorOf(err) : err;
    }
}

/** An answer the daemon refused, with its machine-readable code. */
export class DaemonError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(message);
        this.name = "DaemonError";
    }
}

interface Pending {
    resolve: (value: unknown) => void;
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

    /** Asks the daemon; params and answer types come from protocol/rpc.ts. */
    async call<A extends RpcAction>(action: A, params: RpcParams<A>, timeoutMs: number | null = DEFAULT_REQUEST_TIMEOUT_MS): Promise<RpcResult<A>> {
        return (await this.request(action, params, timeoutMs)) as RpcResult<A>;
    }

    /** Sends a request and resolves with its result, or rejects with the daemon's error. */
    request(action: string, params: Record<string, unknown> = {}, timeoutMs: number | null = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
        if (this.closed) return Promise.reject(new CliError("The connection to Paperboard is closed"));
        const id = this.nextId++;
        return new Promise<unknown>((resolve, reject) => {
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

/** Whether a daemon that proves it holds this data folder's token answers now. */
export async function daemonAnswers(): Promise<boolean> {
    let connection: HostConnection;
    try {
        connection = await HostConnection.open();
    } catch (err) {
        if (err instanceof DaemonUnavailable) return false;
        throw err;
    }
    connection.close();
    return true;
}

function verifiedSocket(handshake: Handshake): Promise<WebSocket> {
    const challenge = challengeDaemon(crypto, handshake);
    const address = `127.0.0.1:${handshake.port}`;
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${address}`, {
            headers: challenge.headers,
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
            const refused = challenge.refusal(raw.toString());
            if (refused) {
                fail(cliErrorOf(refused));
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
