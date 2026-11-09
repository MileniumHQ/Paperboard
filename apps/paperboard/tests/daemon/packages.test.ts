import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { PaperCraneEngine } from "../../papercrane/engine";
import { streamToFileWithProgress } from "../../papercrane/storage";
import { parsePackageRecipe, recipeDigest } from "../../papercrane/packageRecipe";
import { RECORD_MAX_BYTES } from "../../papercrane/registryRecord";
import { tar, tarGz, zip, type TarMember } from "./support/archive";
import { killWorkloads, startCrane, workloadRecords } from "./support/crane";
import { dataDir, listTree, modeOf, tempDir } from "./support/fs";
import { startDaemon, stopDaemon } from "./support/inproc";
import { FIXTURE_PUBLIC_KEY, serve, sha256, signPackage, type LoopbackServer } from "./support/release";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const PLATFORM = `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;

let registry: LoopbackServer;
beforeAll(() => {
	registry = serve();
});
afterAll(async () => {
	await registry.close();
});
afterEach(stopDaemon);

interface Publish {
	name: string;
	version: string;
	bytes: Buffer;
	ext?: string;
	layout?: unknown;
	recipe?: unknown;
	signature?: "fixture" | "other" | "none" | { platform: string } | { recipe: unknown };
	platform?: string;
}

// Publishes a package record and its archive on the loopback registry.
function publish(p: Publish): string {
	const sha = sha256(p.bytes);
	const file = `/files/${p.name}-${p.version}${p.ext ?? ".tar.gz"}`;
	registry.set(file, p.bytes);
	let signature: string | undefined;
	const sig = p.signature ?? "fixture";
	const digestOf = (recipe: unknown) => (recipe === undefined ? undefined : recipeDigest(parsePackageRecipe(recipe)));
	if (sig === "fixture" || sig === "other") signature = signPackage(p.name, p.version, PLATFORM, sha, digestOf(p.recipe), sig);
	else if (sig !== "none" && "platform" in sig) signature = signPackage(p.name, p.version, sig.platform, sha, digestOf(p.recipe));
	else if (sig !== "none" && "recipe" in sig) signature = signPackage(p.name, p.version, PLATFORM, sha, digestOf(sig.recipe));
	registry.set(`/package/${p.name}.json`, {
		name: p.name,
		version: p.version,
		platforms: {
			[p.platform ?? PLATFORM]: {
				url: `${registry.url}${file}`,
				sha256: sha,
				...(signature ? { signature } : {}),
				...(p.layout !== undefined ? { layout: p.layout } : {}),
				...(p.recipe !== undefined ? { recipe: p.recipe } : {}),
			},
		},
	});
	return sha;
}

const engineFor = (dir: string) => new PaperCraneEngine(dir, undefined, registry.url, FIXTURE_PUBLIC_KEY);
const toolArchive = (body: string, extra: TarMember[] = []) =>
	tarGz([{ name: "rt/bin/", type: "dir" }, { name: "rt/bin/tool", content: `#!/bin/sh\n${body}\n`, mode: 0o755 }, ...extra]);
const downloadsOf = (name: string) => registry.hits.filter((h) => h.startsWith(`/files/${name}-`));

// Downloads are http(s), checksum-verified, and leave nothing on failure.
describe("downloads", () => {
	test("non-http schemes, unknown algorithms and mismatched checksums leave no file", async () => {
		registry.set("/blob", "payload");
		const daemon = await startDaemon();
		const panel = await daemon.panelRpc("test.dl");
		const root = path.join(daemon.dataDir, "files", "test.dl");
		for (const url of [`file://${path.join(daemon.dataDir, "local", "crane.json")}`, "data:text/plain,hi", "ftp://127.0.0.1/x"]) {
			expect((await panel.fail("file:download", { downloadId: "d", url, targetPath: "out.txt" })).error).toContain("Download refused");
		}
		const before = registry.hits.length;
		expect((await panel.fail("file:download", { downloadId: "d", url: `${registry.url}/blob`, targetPath: "out.txt", options: { checksum: { algorithm: "md5", value: "x" } } })).error).toContain("not supported");
		expect(registry.hits.length).toBe(before);
		for (const options of [{ sha256: "0".repeat(64) }, { checksum: { algorithm: "sha512", value: "0".repeat(128) } }]) {
			expect((await panel.fail("file:download", { downloadId: "d", url: `${registry.url}/blob`, targetPath: "out.txt", options })).error).toContain("mismatch");
		}
		expect(listTree(root)).toEqual([]);
		await panel.ok("file:download", { downloadId: "d", url: `${registry.url}/blob`, targetPath: "out.txt", options: { sha256: sha256("payload") } });
		expect(fs.readFileSync(path.join(root, "out.txt"), "utf8")).toBe("payload");
		await panel.close();
	});

	test("an exceeded byte cap or a throwing progress consumer leaves no partial file", async () => {
		registry.set("/big", Buffer.alloc(256 * 1024, 7));
		const dir = tempDir();
		const target = path.join(dir, "big.bin");
		await expect(streamToFileWithProgress(`${registry.url}/big`, target, undefined, undefined, undefined, { maxBytes: 1024 })).rejects.toThrow("cap");
		await expect(
			streamToFileWithProgress(`${registry.url}/big`, target, (p) => {
				if (p.stage === "downloading") throw new Error("consumer broke");
			}),
		).rejects.toThrow("consumer broke");
		expect(fs.readdirSync(dir)).toEqual([]);
	});
});

// Runtime packages install only signed bytes, exactly as declared.
describe("runtime packages install only signed bytes", () => {
	test("refusals happen before any download, and nothing is left behind", async () => {
		const dir = dataDir();
		const engine = engineFor(dir);
		await expect(engine.downloadPackage("nosha", "d", undefined, undefined)).rejects.toThrow("sha256");
		for (const bad of ["..", "/etc"]) await expect(engine.downloadPackage(bad, "d", undefined, "a".repeat(64))).rejects.toThrow();

		const cases: Array<[string, Publish, string]> = [
			["unsigned", { name: "p1", version: "1.0.0", bytes: toolArchive("true"), signature: "none" }, "not signed"],
			["signed by another key", { name: "p2", version: "1.0.0", bytes: toolArchive("true"), signature: "other" }, "does not verify"],
			["signed for another platform", { name: "p3", version: "1.0.0", bytes: toolArchive("true"), signature: { platform: "plan9-x64" } }, "does not verify"],
			[
				"a recipe whose steps were swapped",
				{ name: "p4", version: "1.0.0", bytes: toolArchive("true"), ext: ".tar", recipe: { unpack: "tar", take: { bin: "rt/bin" } }, signature: { recipe: { unpack: "tar", take: { bin: "rt" } } } },
				"does not verify",
			],
			["an unknown layout", { name: "p5", version: "1.0.0", bytes: toolArchive("true"), layout: "sideways" }, "Unsupported package layout"],
			["an unknown unpack kind", { name: "p6", version: "1.0.0", bytes: toolArchive("true"), recipe: { unpack: "rar", take: { bin: "rt/bin" } }, signature: "none" }, "Unsupported package recipe unpack"],
			["a recipe with a run step", { name: "p7", version: "1.0.0", bytes: toolArchive("true"), recipe: { unpack: "tar", take: { bin: "rt/bin" }, run: "rm -rf /" }, signature: "none" }, "unknown fields"],
			["a recipe that climbs", { name: "p8", version: "1.0.0", bytes: toolArchive("true"), recipe: { unpack: "tar", take: { bin: "../../bin" } }, signature: "none" }, "plain relative path"],
		];
		for (const [kind, release, message] of cases) {
			const sha = publish(release);
			await expect(engine.downloadPackage(release.name, "d", undefined, sha), kind).rejects.toThrow(message);
			expect(downloadsOf(release.name)).toEqual([]);
		}
		expect(listTree(path.join(dir, "packages"))).toEqual([]);

		registry.set("/package/huge.json", { name: "huge", padding: "x".repeat(RECORD_MAX_BYTES) });
		await expect(engine.downloadPackage("huge", "d", undefined, "a".repeat(64))).rejects.toThrow(`exceeds ${RECORD_MAX_BYTES} bytes`);
	});

	test("layouts install as declared, zips keep their modes, and recipes keep only what they take", async () => {
		const dir = dataDir();
		const engine = engineFor(dir);
		const pkg = path.join(dir, "packages");

		await engine.downloadPackage("rooted", "d", undefined, publish({ name: "rooted", version: "1.0.0", layout: "root", bytes: tarGz([{ name: "bin/run", content: "x", mode: 0o755 }, { name: "lib/a", content: "a" }]) }));
		expect(listTree(path.join(pkg, "rooted"))).toEqual(["bin", "bin/run", "lib", "lib/a"]);

		await engine.downloadPackage("flat", "d", undefined, publish({ name: "flat", version: "1.0.0", layout: "bin", bytes: tarGz([{ name: "flat-tool", content: "#!/bin/sh\n", mode: 0o755 }, { name: "lib/x.so", content: "x" }]) }));
		expect(listTree(path.join(pkg, "flat"))).toEqual(["bin", "bin/flat-tool", "bin/lib", "bin/lib/x.so"]);
		expect(modeOf(path.join(pkg, "flat", "bin", "flat-tool")) & 0o111).not.toBe(0);

		await engine.downloadPackage("zipped", "d", undefined, publish({ name: "zipped", version: "1.0.0", ext: ".zip", layout: "root", bytes: zip([{ name: "bin/opencode", content: "#!/bin/sh\n", mode: 0o755 }]) }));
		expect(modeOf(path.join(pkg, "zipped", "bin", "opencode")) & 0o111).not.toBe(0);

		const recipe = { unpack: "tar", take: { "bin/tool": "vendor/app/tool" } };
		await engine.downloadPackage("recipe", "d", undefined, publish({ name: "recipe", version: "1.0.0", ext: ".tar", recipe, bytes: tar([{ name: "vendor/app/tool", content: "t", mode: 0o755 }, { name: "vendor/app/junk", content: "j" }]) }));
		expect(listTree(path.join(pkg, "recipe"))).toEqual(["bin", "bin/tool"]);

		const missing = { unpack: "tar", take: { "bin/tool": "vendor/nope" } };
		const sha = publish({ name: "missing", version: "1.0.0", ext: ".tar", recipe: missing, bytes: tar([{ name: "vendor/app/tool", content: "t" }]) });
		await expect(engine.downloadPackage("missing", "d", undefined, sha)).rejects.toThrow("not in the archive");
		expect(fs.readdirSync(pkg).filter((f) => f.includes("missing"))).toEqual([]);
	});
});

// Signed rollbacks are refused by default.
describe("signed runtime rollbacks are refused", () => {
	test("an older or same-version-different-bytes release is refused, only the host may downgrade", async () => {
		const dir = dataDir();
		const engine = engineFor(dir);
		const v1 = toolArchive("echo one");
		const v2 = toolArchive("echo two");
		await engine.downloadPackage("roll", "d", undefined, publish({ name: "roll", version: "2.0.0", bytes: v2 }));
		const installed = fs.readFileSync(path.join(dir, "packages", "roll", "bin", "tool"));
		await expect(engine.downloadPackage("roll", "d", undefined, publish({ name: "roll", version: "1.0.0", bytes: v1 }))).rejects.toThrow("rollback");
		await expect(engine.downloadPackage("roll", "d", undefined, publish({ name: "roll", version: "2.0.0", bytes: toolArchive("echo other") }))).rejects.toThrow("rollback");
		expect(fs.readFileSync(path.join(dir, "packages", "roll", "bin", "tool")).equals(installed)).toBe(true);

		await engine.downloadPackage("roll", "d", undefined, publish({ name: "roll", version: "1.0.0", bytes: v1 }), { allowDowngrade: true });
		expect(fs.readFileSync(path.join(dir, "packages", "roll", "bin", "tool"), "utf8")).toContain("echo one");

		const daemon = await startDaemon();
		const panel = await daemon.panelRpc("test.roll");
		expect((await panel.fail("package:download", { downloadId: "d", packageName: "roll", sha256: "a".repeat(64), allowDowngrade: true })).code).toBe("FORBIDDEN");
		await panel.close();
	});
});

// Runtime updates wait for the workloads using them.
describe("runtime updates wait for their workloads", () => {
	test("an update installs at once when idle, waits for a live workload, survives a restart and installs when it stops", async () => {
		const dir = dataDir();
		const previous = process.env.PAPERBOARD_DIR;
		process.env.PAPERBOARD_DIR = dir;
		try {
			const first = engineFor(dir);
			await first.downloadPackage("rt", "d", undefined, publish({ name: "rt", version: "1.0.0", bytes: toolArchive("echo v1") }));
			// nothing runs from it: the next release replaces it at once
			const idle = await first.downloadPackage("rt", "d", undefined, publish({ name: "rt", version: "1.1.0", bytes: toolArchive("while :; do sleep 1; done") }));
			expect(idle.waiting).toBeUndefined();
			const tool = path.join(dir, "packages", "rt", "bin", "tool");
			const v11 = fs.readFileSync(tool);

			// a workload runs from it (started by the compiled crane, which then stops: the workload stays)
			const crane = await startCrane({ dataDir: dir });
			const rpc = await crane.rpc();
			await rpc.ok("process:run", { id: "uses-rt", command: tool });
			await rpc.ok("process:run", { id: "unrelated", command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] });
			await rpc.close();
			expect((await crane.stop()).code).toBe(0);

			const second = engineFor(dir);
			await second.recoverRunningSupervisors();
			const staged = await second.downloadPackage("rt", "d", undefined, publish({ name: "rt", version: "2.0.0", bytes: toolArchive("echo v2") }));
			expect(staged.waiting?.version).toBe("2.0.0");
			expect(staged.waiting?.blockedBy.map((b) => b.processId)).toEqual(["uses-rt"]);
			expect(fs.readFileSync(tool).equals(v11)).toBe(true);
			// a staged release is a floor too
			await expect(second.downloadPackage("rt", "d", undefined, publish({ name: "rt", version: "1.5.0", bytes: toolArchive("echo v15") }))).rejects.toThrow("rollback");
			second.releaseAllClients();

			const third = engineFor(dir);
			await third.recoverRunningSupervisors();
			expect(third.pendingPackageUpdates().map((u) => u.version)).toEqual(["2.0.0"]);
			await third.killProcess("uses-rt");
			await waitFor("the staged update to install", () => fs.readFileSync(tool, "utf8").includes("echo v2"));
			expect(third.pendingPackageUpdates()).toEqual([]);
			third.releaseAllClients();

			// an adopted workload whose command is unknown holds back every package
			const [unrelated] = workloadRecords(dir);
			const meta = JSON.parse(fs.readFileSync(unrelated!.file, "utf8"));
			delete meta.config.command;
			fs.writeFileSync(unrelated!.file, JSON.stringify(meta));
			const fourth = engineFor(dir);
			await fourth.recoverRunningSupervisors();
			const held = await fourth.downloadPackage("rt", "d", undefined, publish({ name: "rt", version: "3.0.0", bytes: toolArchive("echo v3") }));
			expect(held.waiting?.blockedBy.map((b) => b.processId)).toEqual(["unrelated"]);
			await fourth.killProcess("unrelated");
			await waitFor("the held update to install", () => fs.readFileSync(tool, "utf8").includes("echo v3"));
		} finally {
			process.env.PAPERBOARD_DIR = previous;
			await killWorkloads(dir);
		}
	});
});
