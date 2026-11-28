// The folder claim (core/folderClaim.ts) is taken by two runtimes on one
// computer: the desktop app's embedded daemon runs in Electron's Node, and a
// standalone daemon in Bun. If the two named one folder's claim apart, both
// would start on it. So here each holds the real claim while the other is
// refused, both ways, on every platform CI runs this on: the same names for
// one folder (Linux's abstract sockets, Windows' named pipes, from device and
// inode, volume serial and file id), the same lock on macOS (O_EXLOCK |
// O_NONBLOCK on the folder, and its EAGAIN read as held), and the same path's
// name once the folder at the path is another.
//
// The app bundles the daemon's TypeScript into its main process
// (electron-vite); this bundles the same module for Node and runs it under
// the app's own Electron binary with ELECTRON_RUN_AS_NODE, as Node. Bun runs
// the source, as the standalone daemon does. Every failure says which
// platform, which runtime, and which step.
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { spawnChild } from "testkit/crane";
import { dataDir, tempDir } from "testkit/fs";
import { TEST_TIMEOUT_MS, waitFor, within } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS * 4);

const CLAIM_SOURCE = path.join(import.meta.dir, "..", "..", "src", "core", "folderClaim.ts");
const APP_DIR = path.join(import.meta.dir, "..", "..", "..", "paperboard");
const PLATFORM = `${process.platform}-${process.arch}`;

// Runs in either runtime: loads the claim module, then names, takes or holds
// the claim of PAPERBOARD_DIR, and writes what happened to the answer file.
const RUNNER = `
const fs = require("node:fs");
const [modulePath, mode, answer] = process.argv.slice(-3);
const say = (value) => fs.writeFileSync(answer, JSON.stringify(value));
let step = "loading the claim module";
try {
	const claim = require(modulePath);
	if (mode === "names") {
		step = "naming the claim";
		say({ names: claim.claimNamesOf(process.env.PAPERBOARD_DIR) });
		process.exit(0);
	}
	step = "taking the claim";
	claim.claimDataFolder().then(
		(held) => {
			say({ held: true });
			if (mode === "hold") setInterval(() => {}, 1000);
			else held.releaseAfter(Promise.resolve()).then(() => process.exit(0));
		},
		(err) => {
			say(err instanceof claim.FolderClaimedError ? { refused: err.held, message: err.message } : { error: String((err && err.stack) || err), step });
			process.exit(0);
		},
	);
} catch (err) {
	say({ error: String((err && err.stack) || err), step });
	process.exit(0);
}
`;

interface Runtime {
	name: string;
	command: string;
	module: string;
	env: Record<string, string>;
}

type Answer = { names: { folder: string; path: string | null } } | { held: true } | { refused: "folder" | "path"; message: string } | { error: string; step: string };

let runner: string;
let runtimes: Runtime[];

beforeAll(async () => {
	const work = tempDir("pb-claim-runtimes-");
	runner = path.join(work, "runner.cjs");
	fs.writeFileSync(runner, RUNNER);
	// the claim module for Node, bundled as the app bundles the daemon
	const built = await Bun.build({ entrypoints: [CLAIM_SOURCE], target: "node", format: "cjs", outdir: path.join(work, "node") });
	if (!built.success) throw new Error(`${PLATFORM}: bundling ${CLAIM_SOURCE} for Electron's Node failed:\n${built.logs.map(String).join("\n")}`);
	const bundle = built.outputs[0]!.path;
	let electron: string;
	try {
		electron = createRequire(path.join(APP_DIR, "package.json"))("electron") as string;
	} catch (err) {
		throw new Error(`${PLATFORM}: Electron isn't installed for apps/paperboard (CI's platform job fetches it with electron/install.js): ${String(err)}`);
	}
	const version = spawnSync(electron, ["-p", "process.versions.node + ' ' + process.versions.electron"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" });
	if (version.status !== 0) throw new Error(`${PLATFORM}: ${electron} doesn't run as Node (exit ${version.status}):\n${version.stdout}\n${version.stderr}`);
	const [node, electronVersion] = version.stdout.trim().split(" ");
	runtimes = [
		{ name: `Bun ${Bun.version}`, command: process.execPath, module: CLAIM_SOURCE, env: {} },
		{ name: `Electron ${electronVersion}'s Node ${node}`, command: electron, module: bundle, env: { ELECTRON_RUN_AS_NODE: "1" } },
	];
});

const running: Array<ReturnType<typeof spawnChild>> = [];
afterEach(async () => {
	for (const child of running.splice(0)) {
		if (child.proc.exitCode === null && child.proc.signalCode === null) child.proc.kill("SIGKILL");
		await child.exited;
	}
});

/** runs the claim in `runtime` on `dir`; with "hold", resolves once it holds the claim and leaves it running */
async function run(runtime: Runtime, mode: "names" | "claim" | "hold", dir: string): Promise<Answer> {
	const answer = path.join(tempDir("pb-claim-answer-"), "answer.json");
	const env = { ...process.env, ...runtime.env, PAPERBOARD_DIR: dir };
	const child = spawnChild(runtime.command, [runner, runtime.module, mode, answer], env);
	running.push(child);
	const said = await waitFor(
		`${runtime.name} to answer "${mode}"`,
		() => {
			if (fs.existsSync(answer)) {
				const text = fs.readFileSync(answer, "utf8");
				if (text) return JSON.parse(text) as Answer;
			}
			if (child.proc.exitCode !== null) throw new Error(`${PLATFORM}: ${runtime.name} exited ${child.proc.exitCode} before it answered "${mode}" on ${dir}:\n${child.output()}`);
			return null;
		},
		{ timeoutMs: 30_000 },
	);
	if ("error" in said) throw new Error(`${PLATFORM}: ${runtime.name}, ${said.step} on ${dir}, failed:\n${said.error}\n${child.output()}`);
	if (mode !== "hold") await within(`${runtime.name} to exit after "${mode}"`, child.exited, 20_000);
	else if (!("held" in said)) throw new Error(`${PLATFORM}: ${runtime.name} was to hold ${dir}, but: ${JSON.stringify(said)}`);
	return said;
}

/** every runtime holding while each other one claims */
const pairs = () => runtimes.flatMap((holder) => runtimes.filter((r) => r !== holder).map((claimer) => [holder, claimer] as const));

describe("the folder claim in Electron's Node and in Bun", () => {
	// Inventory: Data loss — the app's daemon (Electron's Node) and a standalone one (Bun) must name one folder's claim alike, or both start on it.
	test("both name one folder's claim alike, by its own path and through a link to it", async () => {
		const dir = dataDir();
		const link = path.join(dataDir(), "linked");
		fs.symlinkSync(dir, link, process.platform === "win32" ? "junction" : "dir");
		const named: Record<string, unknown> = {};
		for (const runtime of runtimes) {
			const own = await run(runtime, "names", dir);
			const linked = await run(runtime, "names", link);
			if (!("names" in own) || !("names" in linked)) throw new Error(`${PLATFORM}: ${runtime.name} named nothing: ${JSON.stringify({ own, linked })}`);
			if (own.names.folder !== linked.names.folder) {
				throw new Error(`${PLATFORM}: ${runtime.name} names one folder's claim ${own.names.folder} by its path and ${linked.names.folder} through a link`);
			}
			named[runtime.name] = own.names;
		}
		const [first, ...rest] = Object.values(named).map((n) => JSON.stringify(n));
		if (rest.some((n) => n !== first)) throw new Error(`${PLATFORM}: the runtimes name the claim of ${dir} apart: ${JSON.stringify(named)}`);
		expect(rest.length).toBe(runtimes.length - 1);
	});

	// Inventory: Data loss — a folder one runtime's daemon holds is refused to the other's.
	test("a folder one runtime holds is refused to the other, both ways", async () => {
		for (const [holder, claimer] of pairs()) {
			const dir = dataDir();
			await run(holder, "hold", dir);
			const said = await run(claimer, "claim", dir);
			if (!("refused" in said) || said.refused !== "folder") {
				throw new Error(`${PLATFORM}: ${holder.name} holds ${dir}, and ${claimer.name} taking the claim answered ${JSON.stringify(said)}, not refused for the folder`);
			}
		}
		expect(pairs().length).toBe(2);
	});

	// Inventory: Data loss — a path that leads to another folder while one runtime's daemon runs is refused to the other's (but on macOS, where the lock is the folder's alone).
	test("once the folder a runtime holds is moved away and another made at its path, the other runtime is refused the path, and the moved folder, both ways", async () => {
		for (const [holder, claimer] of pairs()) {
			const dir = path.join(dataDir(), "data");
			await run(holder, "hold", dir);
			const moved = `${dir}.moved`;
			fs.renameSync(dir, moved);
			fs.mkdirSync(dir);
			const atPath = await run(claimer, "claim", dir);
			const expected = process.platform === "darwin" ? "held" : "refused for the path";
			const got = "held" in atPath ? "held" : "refused" in atPath ? `refused for the ${atPath.refused}` : JSON.stringify(atPath);
			if (got !== expected) throw new Error(`${PLATFORM}: ${holder.name} holds the folder moved from ${dir}, and ${claimer.name} taking the claim of the new folder at the path answered "${got}", not "${expected}"`);
			const atMoved = await run(claimer, "claim", moved);
			if (!("refused" in atMoved) || atMoved.refused !== "folder") {
				throw new Error(`${PLATFORM}: ${holder.name} holds ${moved}, and ${claimer.name} taking its claim answered ${JSON.stringify(atMoved)}, not refused for the folder`);
			}
		}
		expect(pairs().length).toBe(2);
	});
});
