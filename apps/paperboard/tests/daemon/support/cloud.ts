// Loopback stand-ins for the two cloud backup providers, speaking their wire
// formats: an S3 bucket (path-style ListObjectsV2, PUT, GET, DELETE) and
// Google's token endpoint plus the Drive v3 files API with resumable
// uploads. Each records the requests it served, so a test can assert that a
// refusal happened before any network.
import { serve, type LoopbackServer } from "./release";

export interface FakeS3 extends LoopbackServer {
	objects: Map<string, Buffer>;
	requests: Array<{ method: string; path: string; authorization: string | null }>;
}

function xmlEscape(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fakeS3(bucket: string): FakeS3 {
	const objects = new Map<string, Buffer>();
	const requests: FakeS3["requests"] = [];
	const server = serve();
	const handler = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		requests.push({ method: req.method, path: url.pathname + url.search, authorization: req.headers.get("authorization") });
		if (!req.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 Credential=")) return new Response("unsigned", { status: 403 });
		const [, bucketName, ...rest] = url.pathname.split("/");
		if (bucketName !== bucket) return new Response("NoSuchBucket", { status: 404 });
		const key = decodeURIComponent(rest.join("/"));
		if (req.method === "GET" && !key && url.searchParams.get("list-type") === "2") {
			const prefix = url.searchParams.get("prefix") ?? "";
			const max = Number(url.searchParams.get("max-keys") ?? 1000);
			const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, max);
			const contents = keys.map((k) => `<Contents><Key>${xmlEscape(k)}</Key><Size>${objects.get(k)!.length}</Size></Contents>`).join("");
			return new Response(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`, { headers: { "content-type": "application/xml" } });
		}
		if (req.method === "PUT") {
			objects.set(key, Buffer.from(await req.arrayBuffer()));
			return new Response("");
		}
		if (req.method === "GET") {
			const body = objects.get(key);
			return body ? new Response(body) : new Response("NoSuchKey", { status: 404 });
		}
		if (req.method === "DELETE") {
			objects.delete(key);
			return new Response(null, { status: 204 });
		}
		return new Response("unsupported", { status: 400 });
	};
	server.set(`/${bucket}/`, handler);
	// every object path goes through the same handler
	const routes = server.routes;
	const original = routes.get.bind(routes);
	routes.get = (path: string) => original(path) ?? (path.startsWith(`/${bucket}/`) ? handler : undefined);
	return Object.assign(server, { objects, requests });
}

interface DriveFile {
	id: string;
	account: string;
	name: string;
	mimeType: string;
	parents: string[];
	description?: string;
	appProperties: Record<string, string>;
	content?: Buffer;
	trashed: boolean;
}

export interface FakeDrive extends LoopbackServer {
	files: Map<string, DriveFile>;
	// refresh token -> Google account
	accounts: Map<string, string>;
	requests: string[];
	endpoints: { tokenUrl: string; apiBase: string; uploadBase: string };
}

// the subset of Drive's query language the store sends
function matches(file: DriveFile, q: string): boolean {
	if (/trashed = false/.test(q) && file.trashed) return false;
	const parent = /'([^']+)' in parents/.exec(q);
	if (parent && !file.parents.includes(parent[1]!)) return false;
	for (const m of q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)) {
		if (file.appProperties[m[1]!] !== m[2]) return false;
	}
	return true;
}

export function fakeDrive(): FakeDrive {
	const files = new Map<string, DriveFile>();
	const accounts = new Map<string, string>();
	const tokens = new Map<string, string>();
	const sessions = new Map<string, Omit<DriveFile, "content">>();
	const requests: string[] = [];
	let next = 1;
	const server = serve();
	const account = (req: Request) => tokens.get((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
	const visible = (id: string, who: string | undefined) => {
		const file = files.get(id);
		return file && file.account === who ? file : undefined;
	};
	const handler = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		requests.push(`${req.method} ${url.pathname}${url.search}`);
		if (url.pathname === "/token") {
			const form = new URLSearchParams(await req.text());
			const who = accounts.get(form.get("refresh_token") ?? "");
			if (form.get("grant_type") !== "refresh_token" || !who) return Response.json({ error: "invalid_grant" }, { status: 400 });
			const token = `at-${next++}`;
			tokens.set(token, who);
			return Response.json({ access_token: token, expires_in: 3600 });
		}
		const who = account(req);
		if (!who) return new Response("unauthorized", { status: 401 });
		if (url.pathname === "/api/about") return Response.json({ storageQuota: { limit: "1000000000", usage: "1000" } });
		if (url.pathname === "/api/files" && req.method === "POST") {
			const meta = await req.json();
			const id = `f${next++}`;
			files.set(id, { id, account: who, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], appProperties: {}, trashed: false });
			return Response.json({ id });
		}
		if (url.pathname === "/api/files" && req.method === "GET") {
			const q = url.searchParams.get("q") ?? "";
			const found = [...files.values()].filter((f) => f.account === who && matches(f, q));
			return Response.json({ files: found.map((f) => ({ id: f.id, description: f.description, size: String(f.content?.length ?? 0) })) });
		}
		if (url.pathname === "/upload/files" && req.method === "POST") {
			const meta = await req.json();
			const session = `s${next++}`;
			sessions.set(session, { id: `f${next++}`, account: who, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, description: meta.description, appProperties: meta.appProperties, trashed: false });
			return new Response("", { headers: { location: `${server.url}/upload/session/${session}` } });
		}
		const fileMatch = /^\/api\/files\/([^/]+)$/.exec(url.pathname);
		if (fileMatch) {
			const file = visible(decodeURIComponent(fileMatch[1]!), who);
			if (!file) return Response.json({ error: { code: 404 } }, { status: 404 });
			if (req.method === "DELETE") {
				files.delete(file.id);
				return new Response(null, { status: 204 });
			}
			if (url.searchParams.get("alt") === "media") return new Response(file.content ?? Buffer.alloc(0));
			return Response.json({ id: file.id, trashed: file.trashed });
		}
		return new Response("unsupported", { status: 400 });
	};
	const sessionHandler = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		requests.push(`${req.method} ${url.pathname}`);
		const meta = sessions.get(url.pathname.split("/").pop()!);
		if (!meta || req.method !== "PUT") return new Response("no session", { status: 404 });
		files.set(meta.id, { ...meta, content: Buffer.from(await req.arrayBuffer()) });
		return Response.json({ id: meta.id });
	};
	const routes = server.routes;
	const original = routes.get.bind(routes);
	routes.get = (path: string) => original(path) ?? (path.startsWith("/upload/session/") ? sessionHandler : handler);
	return Object.assign(server, {
		files,
		accounts,
		requests,
		endpoints: { tokenUrl: `${server.url}/token`, apiBase: `${server.url}/api`, uploadBase: `${server.url}/upload` },
	});
}
