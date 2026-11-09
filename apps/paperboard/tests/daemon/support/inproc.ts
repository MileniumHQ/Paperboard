// The daemon in this test process: startPaperCraneServer() exactly as the
// desktop app embeds it, on a loopback port the OS picks, headless (no TUI,
// and stop() never exits the process), without mDNS.
//
// The daemon resolves its data directory from PAPERBOARD_DIR, so one in-process
// daemon runs at a time: start() points PAPERBOARD_DIR at the daemon's own
// data directory and stop() puts the previous value back. A test that needs
// two daemons at once runs the second as a compiled crane (crane.ts).
//
// In-process daemons cannot start supervised workloads: the test runner's own
// binary is not a crane. Workload tests use the compiled crane.
import * as http from "node:http";
import { startPaperCraneServer, type ServerInstance, type ServerOptions } from "../../../papercrane/index";
import { dataDir as makeDataDir } from "./fs";
import { Rpc } from "./rpc";
import { within } from "./wait";

export interface InProcessDaemon {
	instance: ServerInstance;
	dataDir: string;
	token: string;
	url: string;
	httpUrl: string;
	port: number;
	// host-authenticated RPC socket
	rpc(): Promise<Rpc>;
	// a socket authenticated as one panel (a host-minted pcp_ token)
	panelRpc(panelId: string): Promise<Rpc>;
	stop(): Promise<void>;
}

let current: InProcessDaemon | null = null;

export async function startDaemon(options: ServerOptions & { dataDir?: string } = {}): Promise<InProcessDaemon> {
	if (current) throw new Error("Another in-process daemon is still running; stop it first");
	const dir = options.dataDir ?? makeDataDir();
	const previous = process.env.PAPERBOARD_DIR;
	process.env.PAPERBOARD_DIR = dir;
	let instance: ServerInstance;
	try {
		instance = await startPaperCraneServer({
			host: "127.0.0.1",
			port: 0,
			headless: true,
			advertise: false,
			...options,
		});
	} catch (err) {
		process.env.PAPERBOARD_DIR = previous;
		throw err;
	}
	const token = options.noAuth ? "" : String(instance.auth.getAuthorizedClients().find((c) => c.clientName === "host")?.token ?? "");
	if (!options.noAuth && !token) throw new Error("The daemon has no host token");
	const url = `ws://127.0.0.1:${instance.localPort}`;
	const daemon: InProcessDaemon = {
		instance,
		dataDir: dir,
		token,
		url,
		httpUrl: `http://127.0.0.1:${instance.localPort}`,
		port: instance.port,
		rpc: () => Rpc.authed(url, token),
		panelRpc: async (panelId: string) => Rpc.authed(url, instance.auth.issuePanelToken(panelId)),
		stop: async () => {
			if (current !== daemon) return;
			const closed = new Promise<void>((resolve) => instance.server.once("close", () => resolve()));
			instance.stop();
			await within("the in-process daemon to close", closed, 15_000);
			current = null;
			process.env.PAPERBOARD_DIR = previous;
		},
	};
	current = daemon;
	return daemon;
}

// Stops whichever in-process daemon is running (for afterEach).
export async function stopDaemon(): Promise<void> {
	await current?.stop();
}

export interface HttpAnswer {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: Buffer;
}

// A raw HTTP request: the Host header and path go on the wire exactly as
// given (fetch would normalise both).
export function request(
	port: number,
	options: { method?: string; path: string; headers?: Record<string, string>; body?: Buffer | string; host?: string },
): Promise<HttpAnswer> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: "127.0.0.1",
				port,
				method: options.method ?? "GET",
				path: options.path,
				headers: {
					Host: options.host ?? `127.0.0.1:${port}`,
					// framed explicitly: Node sends a DELETE body without framing otherwise
					...(options.body !== undefined ? { "Content-Length": String(Buffer.byteLength(options.body)) } : {}),
					...(options.headers ?? {}),
				},
				setHost: false,
				agent: false,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
				res.on("error", reject);
			},
		);
		req.on("error", reject);
		if (options.body !== undefined) req.write(options.body);
		req.end();
	});
}
