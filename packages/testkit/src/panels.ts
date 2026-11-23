// Installed panels for daemon tests, written into a data directory the way an
// install leaves them: panels/<id>/manifest.json plus a bundled service.
// A service is real TypeScript using the real PaperAPI SDK, bundled with
// Bun.build into one file the daemon runs in its own process.
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_DIR } from "./crane";
import { tempDir } from "./fs";

// Import PaperAPI from this path inside a service's source.
export const PAPERAPI = path.join(REPO_DIR, "packages/paperapi/src/index.ts");

// Bundles service source (TypeScript, may import PAPERAPI) into one file.
export async function bundleService(source: string, outFile: string): Promise<void> {
	const srcDir = tempDir("pb-service-src-");
	const entry = path.join(srcDir, "service.ts");
	fs.writeFileSync(entry, source);
	const result = await Bun.build({ entrypoints: [entry], target: "bun", format: "esm" });
	if (!result.success) {
		throw new Error(`Bundling the test service failed:\n${result.logs.map(String).join("\n")}`);
	}
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, await result.outputs[0]!.text());
}

export interface PanelFixture {
	id: string;
	version?: string;
	// TypeScript source for the panel's service (omit for a UI-only panel)
	service?: string;
	manifest?: Record<string, unknown>;
	// extra files, relative to the panel folder
	files?: Record<string, string | Buffer>;
}

// Writes an installed panel into dataDir/panels/<id>. Returns its folder.
export async function installPanelFiles(dataDir: string, panel: PanelFixture): Promise<string> {
	const dir = path.join(dataDir, "panels", panel.id);
	fs.mkdirSync(dir, { recursive: true });
	const manifest: Record<string, unknown> = {
		id: panel.id,
		name: panel.id,
		version: panel.version ?? "1.0.0",
		base: "./index.html",
		...(panel.service ? { service: "./service.js" } : {}),
		...(panel.manifest ?? {}),
	};
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
	fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><title>${panel.id}</title>`);
	for (const [rel, content] of Object.entries(panel.files ?? {})) {
		const file = path.join(dir, rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	}
	if (panel.service) await bundleService(panel.service, path.join(dir, "service.js"));
	return dir;
}

// A minimal service: registers the given calls source (an object literal
// of `name: async (ctx) => ...` entries) on a contract and reports ready.
export function serviceSource(body: { calls?: string; extra?: string; options?: string } = {}): string {
	return `import { defineContract, definePanelService, getPanelId, shape } from ${JSON.stringify(PAPERAPI)};
${body.extra ?? ""}
const __calls: Record<string, (ctx: any) => any> = ${body.calls ?? "{}"};
const __contract = defineContract(getPanelId(), {
	calls: Object.fromEntries(Object.keys(__calls).map((k) => [k, { output: shape.json() }])),
});
definePanelService({
	contract: __contract,
	calls: Object.fromEntries(Object.entries(__calls).map(([k, fn]) => [k, (_input: unknown, ctx: any) => fn(ctx)])),
	${body.options ?? ""}
});
`;
}

/** A service call's blocks:call params: the internal command a definePanelService call is. */
export function serviceCall(panelId: string, call: string, input?: unknown, timeoutMs?: number): Record<string, unknown> {
	const id = call.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
	return { panelId, entry: `command.call-${id}`, request: { inputs: input === undefined ? {} : { input } }, ...(timeoutMs ? { timeoutMs } : {}) };
}

/** The blocks:call params that read a service's whole state, as a panel's page does when it opens. */
export function stateRead(panelId: string): Record<string, unknown> {
	return { panelId, entry: "value.panel-state", request: { inputs: {} } };
}
