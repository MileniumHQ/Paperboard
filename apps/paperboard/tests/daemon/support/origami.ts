// The real Origami registry worker on a loopback Bun.serve, over an
// in-memory KV namespace and R2 bucket. Panels reach it the way they reach
// production: packed with paperapi's packPanel, signed offline (here with
// the fixture key) and written by the operator publisher (publishPanel).
import * as fs from "node:fs";
import * as path from "node:path";
import worker from "../../../../origami/src/index";
import { type PanelStorage, publishPanel } from "../../../../origami/scripts/lib/panelPublish";
import { packPanel } from "../../../../../packages/paperapi/src/pack";
import { bundleService } from "./panels";
import { signPanel } from "./release";
import { tempDir } from "./fs";

export interface Origami {
	url: string;
	kv: Map<string, string>;
	objects: Map<string, Uint8Array>;
	// every path the worker served, in order
	hits: string[];
	storage: PanelStorage;
	record(id: string): any;
	setRecord(id: string, record: unknown): void;
	close(): Promise<void>;
}

export function startOrigami(): Origami {
	const kv = new Map<string, string>([["panels:index", "{}"]]);
	const objects = new Map<string, Uint8Array>();
	const hits: string[] = [];
	const KV = {
		async get(key: string, options?: { type?: string } | string) {
			const value = kv.get(key);
			if (value === undefined) return null;
			const type = typeof options === "string" ? options : options?.type;
			return type === "json" ? JSON.parse(value) : value;
		},
		async list(options: { prefix?: string } = {}) {
			const keys = [...kv.keys()].filter((k) => k.startsWith(options.prefix ?? "")).map((name) => ({ name }));
			return { keys, list_complete: true, cursor: "" };
		},
		async put(key: string, value: string) {
			kv.set(key, value);
		},
	};
	const R2 = {
		async get(key: string) {
			const bytes = objects.get(key);
			if (!bytes) return null;
			return {
				body: new Blob([bytes]).stream(),
				httpEtag: `"${bytes.length}"`,
				writeHttpMetadata() {
					// objects carry no stored HTTP metadata here
				},
			};
		},
	};
	const env = { PACKAGES: KV, PANELS_BUCKET: R2 } as never;
	// the worker schedules no background work on these routes
	const ctx = {
		waitUntil(promise: Promise<unknown>) {
			void promise;
		},
		passThroughOnException() {
			throw new Error("the Origami worker asked to pass a request through");
		},
	} as never;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req) {
			hits.push(new URL(req.url).pathname);
			return worker.fetch(req, env, ctx);
		},
	});
	const storage: PanelStorage = {
		async getJson<T>(key: string) {
			const value = kv.get(key);
			return value === undefined ? null : (JSON.parse(value) as T);
		},
		async putJson(key, value) {
			kv.set(key, JSON.stringify(value));
		},
		async putObject(key, bytes) {
			objects.set(key, bytes);
		},
	};
	return {
		url: `http://127.0.0.1:${server.port}`,
		kv,
		objects,
		hits,
		storage,
		record: (id) => JSON.parse(kv.get(`panel:${id}`) ?? "null"),
		setRecord: (id, record) => kv.set(`panel:${id}`, JSON.stringify(record)),
		close: async () => {
			await server.stop(true);
		},
	};
}

export interface PanelProject {
	id: string;
	version: string;
	// a service source (bundled into dist/service.js)
	service?: string;
	files?: Record<string, string>;
	manifest?: Record<string, unknown>;
}

// A panel project as a developer has it before `pack`: manifest plus a built dist/.
export async function panelProject(project: PanelProject): Promise<string> {
	const dir = tempDir("panel-project-");
	fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "manifest.json"),
		JSON.stringify({
			id: project.id,
			name: project.id,
			version: project.version,
			base: "./dist/index.html",
			...(project.service ? { service: "./dist/service.js" } : {}),
			...(project.manifest ?? {}),
		}),
	);
	fs.writeFileSync(path.join(dir, "dist", "index.html"), `<!doctype html><title>${project.id} ${project.version}</title>`);
	for (const [rel, content] of Object.entries(project.files ?? {})) {
		fs.mkdirSync(path.dirname(path.join(dir, "dist", rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, "dist", rel), content);
	}
	if (project.service) await bundleService(project.service, path.join(dir, "dist", "service.js"));
	return dir;
}

// pack, sign offline with the fixture key, publish through the operator publisher
export async function release(origami: Origami, project: PanelProject, publishAs?: { id?: string; version?: string }) {
	const packed = packPanel({ targetDir: await panelProject(project), outputDir: tempDir("panel-out-"), autoBuild: false, log: (line) => void line });
	const id = publishAs?.id ?? packed.id;
	const version = publishAs?.version ?? packed.version;
	const record = await publishPanel(
		{
			id,
			name: packed.name,
			version,
			signature: signPanel(id, version, packed.sha256),
			manifest: { ...packed.manifest, id },
			archive: new Uint8Array(fs.readFileSync(packed.archivePath)),
		},
		{ storage: origami.storage, origin: origami.url },
	);
	return { packed, record };
}
