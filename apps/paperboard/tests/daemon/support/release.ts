// A loopback release registry signed with a fixture key. The daemon trusts
// releases signed by the key it is constructed with; tests build an engine
// with this fixture's public key and registry URL (production uses the
// compiled-in release key and origami.ariapis.com).
import * as crypto from "node:crypto";
import { releaseMessage } from "../../../papercrane/releaseSignature";

const pair = crypto.generateKeyPairSync("ed25519");
export const FIXTURE_PUBLIC_KEY = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

// a second key, for "signed by another key"
const other = crypto.generateKeyPairSync("ed25519");

export function sign(message: Buffer, key: "fixture" | "other" = "fixture"): string {
	return crypto.sign(null, message, key === "fixture" ? pair.privateKey : other.privateKey).toString("base64");
}

export const signPanel = (id: string, version: string, sha256: string, key?: "fixture" | "other") =>
	sign(releaseMessage.panel(id, version, sha256), key);
export const signPackage = (name: string, version: string, platform: string, sha256: string, recipeSha256?: string, key?: "fixture" | "other") =>
	sign(releaseMessage.package(name, version, platform, sha256, recipeSha256), key);
export const signCrane = (version: string, sha256: string, key?: "fixture" | "other") =>
	sign(releaseMessage.crane(version, sha256), key);

export function sha256(bytes: Buffer | string): string {
	return crypto.createHash("sha256").update(bytes).digest("hex");
}

type Route = Buffer | string | object | ((req: Request) => Response | Promise<Response>);

export interface LoopbackServer {
	url: string;
	port: number;
	// every path requested, in order
	hits: string[];
	routes: Map<string, Route>;
	set(path: string, route: Route): void;
	close(): Promise<void>;
}

// A loopback HTTP server answering from a route table (exact path match).
// Buffers and strings are served as bytes, objects as JSON, functions as-is.
export function serve(initial: Record<string, Route> = {}): LoopbackServer {
	const routes = new Map<string, Route>(Object.entries(initial));
	const hits: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			hits.push(url.pathname + url.search);
			const route = routes.get(url.pathname + url.search) ?? routes.get(url.pathname);
			if (route === undefined) return new Response("not found", { status: 404 });
			if (typeof route === "function") return route(req);
			if (Buffer.isBuffer(route) || typeof route === "string") return new Response(route);
			return Response.json(route);
		},
	});
	const port = server.port as number;
	return {
		url: `http://127.0.0.1:${port}`,
		port,
		hits,
		routes,
		set: (path, route) => {
			routes.set(path, route);
		},
		close: async () => {
			await server.stop(true);
		},
	};
}
