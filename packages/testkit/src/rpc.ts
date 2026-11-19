// A plain WebSocket RPC client for the daemon's wire protocol: frames are
// {id, action, params} out and {type: "response", id, result, error, code}
// back. It keeps every frame it receives, so a test can assert both what it
// got and what it never got.
import { WebSocket } from "ws";
import { within } from "./wait";

export interface Answer {
	result: any;
	error?: string;
	code?: string;
}

export interface OpenOptions {
	headers?: Record<string, string>;
	// bind the client end to this local address (127.0.0.2 and up are
	// distinct loopback peers on Linux)
	localAddress?: string;
	timeoutMs?: number;
}

export class UpgradeRefused extends Error {
	constructor(readonly status: number) {
		super(`WebSocket upgrade refused with HTTP ${status}`);
	}
}

export class Rpc {
	readonly frames: any[] = [];
	readonly closed: Promise<{ code: number; reason: string }>;
	private nextId = 1;
	private waiters = new Set<{ match: (frame: any) => boolean; resolve: (frame: any) => void }>();
	private closeInfo: { code: number; reason: string } | null = null;

	// a socket error after open (the close that follows settles waiters)
	lastError: Error | null = null;

	private constructor(readonly ws: WebSocket) {
		ws.on("error", (err) => {
			this.lastError = err;
		});
		this.closed = new Promise((resolve) => {
			ws.on("close", (code, reason) => {
				this.closeInfo = { code, reason: reason.toString("utf8") };
				resolve(this.closeInfo);
			});
		});
		ws.on("message", (data) => {
			const frame = JSON.parse(String(data));
			this.frames.push(frame);
			for (const waiter of [...this.waiters]) {
				if (waiter.match(frame)) {
					this.waiters.delete(waiter);
					waiter.resolve(frame);
				}
			}
		});
	}

	// Opens a socket; rejects with UpgradeRefused when the daemon answers the
	// upgrade with an HTTP status instead.
	static open(url: string, options: OpenOptions = {}): Promise<Rpc> {
		const ws = new WebSocket(url, {
			headers: options.headers,
			localAddress: options.localAddress,
			handshakeTimeout: options.timeoutMs ?? 10_000,
		});
		const rpc = new Rpc(ws);
		return new Promise((resolve, reject) => {
			ws.once("open", () => resolve(rpc));
			ws.once("unexpected-response", (_req, res) => {
				reject(new UpgradeRefused(res.statusCode ?? 0));
				ws.terminate();
			});
			ws.once("error", (err) => reject(err));
		});
	}

	// Opens a socket and authenticates it with a token.
	static async authed(url: string, token: string, options: OpenOptions = {}): Promise<Rpc> {
		const rpc = await Rpc.open(url, options);
		await rpc.ok("auth:verify", { token });
		return rpc;
	}

	get isOpen(): boolean {
		return this.ws.readyState === WebSocket.OPEN;
	}

	get closeCode(): number | null {
		return this.closeInfo?.code ?? null;
	}

	send(frame: unknown): void {
		this.ws.send(typeof frame === "string" ? frame : JSON.stringify(frame));
	}

	// Resolves with the response to this call, whatever it says.
	call(action: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<Answer> {
		const id = `t${this.nextId++}`;
		const answer = this.next((frame) => frame?.type === "response" && frame.id === id, timeoutMs, `the answer to ${action}`);
		this.send({ id, action, params });
		return answer;
	}

	// The result of a call that must succeed.
	async ok(action: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<any> {
		const answer = await this.call(action, params, timeoutMs);
		if (answer.error) throw new Error(`${action} failed: ${answer.error} (${answer.code})`);
		return answer.result;
	}

	// The refusal of a call that must fail.
	async fail(action: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<{ error: string; code?: string }> {
		const answer = await this.call(action, params, timeoutMs);
		if (!answer.error) throw new Error(`${action} was expected to fail but answered ${JSON.stringify(answer.result)}`);
		return { error: answer.error, code: answer.code };
	}

	// The next frame (already received or still to come) that matches.
	next(match: (frame: any) => boolean, timeoutMs = 15_000, what = "a matching frame"): Promise<any> {
		const already = this.frames.find(match);
		if (already) return Promise.resolve(already);
		return new Promise<any>((resolve, reject) => {
			const waiter = {
				match,
				resolve: (frame: any) => {
					clearTimeout(timer);
					resolve(frame);
				},
			};
			const timer = setTimeout(() => {
				this.waiters.delete(waiter);
				reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`));
			}, timeoutMs);
			this.waiters.add(waiter);
			void this.closed.then((info) => {
				if (!this.waiters.has(waiter)) return;
				this.waiters.delete(waiter);
				clearTimeout(timer);
				reject(new Error(`Socket closed (${info.code} ${info.reason}) while waiting for ${what}`));
			});
		});
	}

	// A frame that arrives after this call (ignores frames already received).
	upcoming(match: (frame: any) => boolean, timeoutMs = 15_000, what = "an upcoming frame"): Promise<any> {
		const seen = this.frames.length;
		return this.next((frame) => this.frames.indexOf(frame) >= seen && match(frame), timeoutMs, what);
	}

	events(name: string): any[] {
		return this.frames.filter((frame) => frame?.type === "event" && frame.event === name);
	}

	async close(): Promise<void> {
		if (this.ws.readyState === WebSocket.CLOSED) return;
		this.ws.close();
		await within("the socket to close", this.closed, 10_000);
	}
}
