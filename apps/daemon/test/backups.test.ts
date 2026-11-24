import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as tarLib from "tar";
import { PaperCraneEngine } from "../src/engine/index";
import { BackupService, backupContents } from "../src/backups/service";
import { createBackupArchive, extractBackupArchive } from "../src/backups/archive";
import { recoverRestores, swapIn } from "../src/backups/restore";
import { LocalBackupStore } from "../src/backups/localStore";
import { S3BackupStore, signS3Request } from "../src/backups/s3Store";
import { DriveBackupStore } from "../src/backups/driveStore";
import { backupPathsProblem, newBackupId, parseBackupRecord, type BackupRecord } from "../src/backups/types";
import { tarGz } from "testkit/archive";
import { fakeDrive, fakeS3 } from "testkit/cloud";
import { killWorkloads, startCrane } from "testkit/crane";
import { dataDir, listTree, tempDir } from "testkit/fs";
import { startDaemon, stopDaemon } from "testkit/inproc";
import { installPanelFiles, PAPERAPI, serviceCall, serviceSource } from "testkit/panels";
import type { Rpc } from "testkit/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(stopDaemon);

async function readyService(rpc: Rpc, panelId: string, call = "ping") {
	await waitFor(`${panelId}'s service`, async () => !(await rpc.call("blocks:call", serviceCall(panelId, call))).error);
}

const PING = "{ ping: async () => 'pong' }";
const lines = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : []);

// A service that logs each start and each hook it hears to `log`, and
// backs up what `contents` names. Its afterRestore writes the data it was
// handed to settings.json, and refuses restored files when `refuse` exists.
function hookedService(log: string, contents: string, refuse = "/nonexistent") {
	const note = (what: string) => `fs.appendFileSync(${JSON.stringify(log)}, ${what} + "\\n")`;
	return serviceSource({
		calls: PING,
		extra: `import * as fs from "node:fs";\n${note('"start"')};`,
		options: `
			beforeBackup: async (_ctx, { target }) => { ${note('"before-backup " + target')}; return ${contents}; },
			afterBackup: async (_ctx, copied) => { ${note('"after-backup " + JSON.stringify(copied)')}; },
			beforeRestore: async (_ctx, { target }) => { ${note('"before-restore " + target')}; },
			afterRestore: async (ctx, ended) => {
				${note('"after-restore " + ended.ok')};
				if (ended.ok && fs.existsSync(${JSON.stringify(refuse)})) throw new Error("the restored files are not usable");
				if (ended.ok) fs.writeFileSync(${JSON.stringify(path.join(path.dirname(log), "settings.json"))}, JSON.stringify(ended.data));
			},`,
	});
}

async function members(archive: string): Promise<string[]> {
	const out: string[] = [];
	await tarLib.t({ file: archive, onReadEntry: (e) => out.push(e.path.replace(/\/$/, "")) });
	return out.sort();
}

describe("a panel's service runs its own backups", () => {
	test("a backup holds what beforeBackup names, nothing restarts, and a restore swaps only those files and hands back the data", async () => {
		const dir = dataDir();
		const log = path.join(tempDir(), "hooks.log");
		const contents = `{ paths: ["world"], exclude: ["world/cache"], skip: ["session.lock"], data: { difficulty: "hard" } }`;
		await installPanelFiles(dir, { id: "test.saver", version: "1.2.3", service: hookedService(log, contents) });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		const panel = await daemon.panelRpc("test.saver");
		await readyService(host, "test.saver");
		const storage = path.join(dir, "files", "test.saver");
		for (const [name, content] of [["world/level.dat", "original"], ["world/deep/session.lock", "lock"], ["world/cache/big.bin", "cache-1"], ["notes.txt", "notes-1"]]) {
			await panel.ok("file:write", { targetPath: name!, content: content! });
		}

		expect((await panel.fail("backup:create", { panelId: "test.saver", target: "w1" })).code).toBe("CONFLICT");
		await host.ok("backup:panel-location-set", { panelId: "test.saver", locationId: "local" });
		const record: BackupRecord = await panel.ok("backup:create", { panelId: "test.saver", target: "w1", label: "before change" });
		expect(record).toMatchObject({ format: 2, panelId: "test.saver", target: "w1", panelVersion: "1.2.3", label: "before change", paths: ["world"], exclude: ["world/cache"] });
		expect(lines(log)).toEqual(["start", "before-backup w1", 'after-backup {"target":"w1","ok":true}']);
		const archive = path.join(dir, "backups", "panels", "test.saver", "w1", `${record.id}.pbbackup`);
		expect(await members(archive)).toEqual(["data.json", "files/world", "files/world/deep", "files/world/level.dat"]);
		// the panel as a whole and other targets have their own history
		expect((await panel.ok("backup:list", { panelId: "test.saver", target: "w1" })).backups.map((b: BackupRecord) => b.id)).toEqual([record.id]);
		expect((await panel.ok("backup:list", { panelId: "test.saver" })).backups).toEqual([]);

		await panel.ok("file:write", { targetPath: "world/level.dat", content: "changed" });
		await panel.ok("file:write", { targetPath: "world/new.dat", content: "new" });
		await panel.ok("file:write", { targetPath: "world/cache/big.bin", content: "cache-2" });
		await panel.ok("file:write", { targetPath: "notes.txt", content: "notes-2" });
		await panel.ok("backup:restore", { panelId: "test.saver", target: "w1", backupId: record.id });
		expect(fs.readFileSync(path.join(storage, "world", "level.dat"), "utf8")).toBe("original");
		expect(fs.existsSync(path.join(storage, "world", "new.dat"))).toBe(false);
		// what the backup left out, and what it never named, stay as they are
		expect(fs.readFileSync(path.join(storage, "world", "cache", "big.bin"), "utf8")).toBe("cache-2");
		expect(fs.readFileSync(path.join(storage, "notes.txt"), "utf8")).toBe("notes-2");
		expect(JSON.parse(fs.readFileSync(path.join(path.dirname(log), "settings.json"), "utf8"))).toEqual({ difficulty: "hard" });
		expect(lines(log).slice(3)).toEqual(["before-restore w1", "after-restore true"]);
		expect(lines(log).filter((l) => l === "start")).toHaveLength(1);
		expect(fs.readdirSync(path.join(dir, "backups", ".work"))).toEqual([]);

		// a backup made by a newer panel version is refused before files move
		const manifest = path.join(dir, "panels", "test.saver", "manifest.json");
		fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, "utf8")), version: "1.0.0" }));
		await panel.ok("file:write", { targetPath: "world/level.dat", content: "keep me" });
		expect((await panel.fail("backup:restore", { panelId: "test.saver", target: "w1", backupId: record.id })).code).toBe("CONFLICT");
		expect(fs.readFileSync(path.join(storage, "world", "level.dat"), "utf8")).toBe("keep me");
		await panel.close();
		await host.close();
	});

	test("backups of two targets of one panel take turns instead of refusing each other", async () => {
		const dir = dataDir();
		const log = path.join(tempDir(), "hooks.log");
		const gate = path.join(tempDir(), "gate");
		// the first target's beforeBackup holds until the test opens the gate
		const contents = `await (async () => {
			if (target === "t1") while (!fs.existsSync(${JSON.stringify(gate)})) await new Promise((r) => setTimeout(r, 20));
			return { paths: [target] };
		})()`;
		await installPanelFiles(dir, { id: "test.turns", service: hookedService(log, contents) });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		await readyService(host, "test.turns");
		for (const target of ["t1", "t2"]) await host.ok("file:write", { appId: "test.turns", targetPath: `${target}/a.txt`, content: target });
		await host.ok("backup:panel-location-set", { panelId: "test.turns", locationId: "local" });

		const first = host.call("backup:create", { panelId: "test.turns", target: "t1" });
		await waitFor("t1's beforeBackup", async () => lines(log).includes("before-backup t1"));
		const second = host.call("backup:create", { panelId: "test.turns", target: "t2" });
		await waitFor("t2's queued backup", async () => (await host.ok("backup:status", { panelId: "test.turns", target: "t2" })).progress !== null);
		expect((await host.ok("backup:status", { panelId: "test.turns", target: "t2" })).progress).toMatchObject({ kind: "create", step: "preparing" });
		expect(lines(log)).not.toContain("before-backup t2");

		fs.writeFileSync(gate, "");
		const [made1, made2] = await Promise.all([first, second]);
		expect([made1.error, made2.error]).toEqual([undefined, undefined]);
		expect([made1.result.target, made2.result.target]).toEqual(["t1", "t2"]);
		expect(lines(log).filter((l) => l.startsWith("before-backup"))).toEqual(["before-backup t1", "before-backup t2"]);
		await host.close();
	});

	test("restored files the panel can't pick up from are put back, and it hears the failure", async () => {
		const dir = dataDir();
		const log = path.join(tempDir(), "hooks.log");
		const refuse = path.join(tempDir(), "refuse");
		await installPanelFiles(dir, { id: "test.fragile", service: hookedService(log, `{ paths: [""], data: null }`, refuse) });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		await readyService(host, "test.fragile");
		await host.ok("file:write", { appId: "test.fragile", targetPath: "state.txt", content: "old" });
		await host.ok("backup:panel-location-set", { panelId: "test.fragile", locationId: "local" });
		const record = await host.ok("backup:create", { panelId: "test.fragile" });
		await host.ok("file:write", { appId: "test.fragile", targetPath: "state.txt", content: "current" });
		await host.ok("file:write", { appId: "test.fragile", targetPath: "added.txt", content: "added" });

		fs.writeFileSync(refuse, "");
		const failed = await host.call("backup:restore", { panelId: "test.fragile", backupId: record.id });
		expect(failed.error).toContain("put back");
		const storage = path.join(dir, "files", "test.fragile");
		expect(fs.readFileSync(path.join(storage, "state.txt"), "utf8")).toBe("current");
		expect(fs.readFileSync(path.join(storage, "added.txt"), "utf8")).toBe("added");
		expect(lines(log).slice(-3)).toEqual(["before-restore null", "after-restore true", "after-restore false"]);
		expect(fs.readdirSync(path.join(dir, "backups", ".work"))).toEqual([]);
		await host.close();
	});

	test("a refused, failed or malformed backup lets the panel carry on, and keeps nothing", async () => {
		const dir = dataDir();
		const cases: Array<[string, string, string]> = [
			["test.busy", "(() => { throw new Error('world is busy'); })()", "world is busy"],
			["test.missing", `{ paths: ["nowhere"] }`, "nothing there"],
			["test.escape", `{ paths: ["../other"] }`, "not a path"],
			["test.nested", `{ paths: ["a", "a/b"] }`, "inside"],
			["test.empty", `{ paths: [] }`, "no files"],
		];
		const logs = new Map<string, string>();
		for (const [id, contents] of cases) {
			const log = path.join(tempDir(), "hooks.log");
			logs.set(id, log);
			await installPanelFiles(dir, { id, service: hookedService(log, contents) });
		}
		await installPanelFiles(dir, { id: "test.nohooks", service: serviceSource({ calls: PING }) });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		for (const id of [...logs.keys(), "test.nohooks"]) {
			await readyService(host, id);
			await host.ok("backup:panel-location-set", { panelId: id, locationId: "local" });
		}
		for (const [id, , why] of cases) {
			expect({ id, error: (await host.call("backup:create", { panelId: id })).error }).toEqual({ id, error: expect.stringContaining(why) });
			expect((await host.ok("backup:list", { panelId: id })).backups).toEqual([]);
		}
		// a copy that failed after the panel got ready is told to it
		expect(lines(logs.get("test.missing")!).at(-1)).toContain('"ok":false');
		expect((await host.fail("backup:create", { panelId: "test.nohooks" })).error).toContain("no beforeBackup");
		expect((await host.fail("backup:restore", { panelId: "test.nohooks", backupId: newBackupId() })).error).toContain("no afterRestore");
		expect(fs.readdirSync(path.join(dir, "backups", ".work"))).toEqual([]);
		await host.close();
	});

	test("a block in the panel's own service backs it up and restores it while the service keeps answering", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, {
			id: "test.blocksave",
			service: serviceSource({
				extra: `import { backupApi, blocksApi } from ${JSON.stringify(PAPERAPI)};`,
				calls: PING,
				options: `onInit: () => blocksApi.panel("test.blocksave").register({ commands: [
					{ id: "save", name: "Save", run: () => backupApi.create("test.blocksave", { label: "from block" }) },
					{ id: "put-back", name: "Put Back", inputs: { id: { type: "text", name: "Backup ID" } }, run: ({ id }) => backupApi.restore("test.blocksave", id) },
				] }),
				beforeBackup: async () => ({ paths: [""] }),
				afterRestore: async () => {},`,
			}),
		});
		const crane = await startCrane({ dataDir: dir });
		try {
			const host = await crane.rpc();
			await readyService(host, "test.blocksave");
			await host.ok("file:write", { appId: "test.blocksave", targetPath: "data.txt", content: "saved" });
			await host.ok("backup:panel-location-set", { panelId: "test.blocksave", locationId: "local" });
			const block = (entry: string, inputs: Record<string, unknown> = {}) =>
				host.ok("blocks:call", { panelId: "test.blocksave", entry, request: { inputs }, timeoutMs: 60_000 }, 70_000);

			await block("command.save");
			const [made] = (await host.ok("backup:list", { panelId: "test.blocksave" })).backups;
			expect(made).toMatchObject({ panelId: "test.blocksave", target: null, label: "from block" });
			await host.ok("file:write", { appId: "test.blocksave", targetPath: "data.txt", content: "changed" });
			await block("command.put-back", { id: made.id });
			expect(fs.readFileSync(path.join(dir, "files", "test.blocksave", "data.txt"), "utf8")).toBe("saved");
			expect((await host.call("blocks:call", serviceCall("test.blocksave", "ping"))).result).toBeTruthy();
			await host.close();
		} finally {
			await crane.stop();
			await killWorkloads(dir);
		}
	});
});

describe("backup archives and restores never reach past the panel's files", () => {
	const archiveOf = (members: Parameters<typeof tarGz>[0]) => {
		const file = path.join(tempDir(), "backup.pbbackup");
		fs.writeFileSync(file, tarGz(members));
		return file;
	};

	test("members outside files/ and data.json, links, and archives over the entry budget are refused with staging left empty", async () => {
		const data = { name: "data.json", content: "null" };
		const cases = [
			[data, { name: "files/ok.txt", content: "ok" }, { name: "configs/test.other.json", content: "{}" }],
			[data, { name: "../escape.txt", content: "x" }],
			[data, { name: "files/link", type: "symlink" as const, target: "../../local/secrets.json" }],
			[data, ...Array.from({ length: 100_001 }, (_, i) => ({ name: `files/f${i}`, content: "" }))],
			[{ name: "files/ok.txt", content: "no data.json" }],
		];
		for (const members of cases) {
			const staging = tempDir();
			await expect(extractBackupArchive(archiveOf(members), staging)).rejects.toThrow();
			if (members[0] === data) expect(listTree(staging)).toEqual([]);
		}
	});

	test("an archive round-trips its files and data, and skips links and named files", async () => {
		const storage = tempDir();
		fs.mkdirSync(path.join(storage, "a", "b"), { recursive: true });
		fs.writeFileSync(path.join(storage, "a", "b", "f.txt"), "f");
		fs.writeFileSync(path.join(storage, "a", "session.lock"), "lock");
		fs.symlinkSync(path.join(storage, "a", "b", "f.txt"), path.join(storage, "a", "link"));
		const file = path.join(tempDir(), "x.pbbackup");
		await createBackupArchive(storage, { paths: ["a"], exclude: [], skip: ["session.lock"], data: { kept: [1, 2] } }, file);
		const staging = tempDir();
		const { filesDir, data } = await extractBackupArchive(file, staging);
		expect(data).toEqual({ kept: [1, 2] });
		expect(listTree(filesDir)).toEqual(["a", "a/b", "a/b/f.txt"]);
	});

	test("a restore a crash interrupted is rolled back at the next start, keeping what the backup left out", async () => {
		const storage = tempDir();
		const work = tempDir();
		fs.mkdirSync(path.join(storage, "servers", "x", "install"), { recursive: true });
		fs.writeFileSync(path.join(storage, "servers", "x", "world.dat"), "live");
		fs.writeFileSync(path.join(storage, "servers", "x", "install", "game.bin"), "game");
		const staged = tempDir();
		fs.mkdirSync(path.join(staged, "servers", "x"), { recursive: true });
		fs.writeFileSync(path.join(staged, "servers", "x", "world.dat"), "backup");
		fs.writeFileSync(path.join(work, "leftover.pbbackup"), "x");

		fs.mkdirSync(path.join(staged, "notes"), { recursive: true });
		fs.writeFileSync(path.join(staged, "notes", "new.txt"), "only in the backup");

		swapIn(work, "test.crash", storage, staged, { paths: ["servers/x", "notes"], exclude: ["servers/x/install"] });
		expect(fs.readFileSync(path.join(storage, "servers", "x", "world.dat"), "utf8")).toBe("backup");
		expect(fs.readFileSync(path.join(storage, "servers", "x", "install", "game.bin"), "utf8")).toBe("game");
		expect(fs.existsSync(path.join(storage, "notes", "new.txt"))).toBe(true);
		// the daemon died here, before afterRestore and the commit
		expect(recoverRestores(work, () => storage)).toEqual([]);
		expect(fs.readFileSync(path.join(storage, "servers", "x", "world.dat"), "utf8")).toBe("live");
		expect(fs.readFileSync(path.join(storage, "servers", "x", "install", "game.bin"), "utf8")).toBe("game");
		// a path the storage didn't have goes again
		expect(fs.existsSync(path.join(storage, "notes"))).toBe(false);
		expect(fs.readdirSync(work)).toEqual([]);
	});

	test("once a restore is committed, a crash in its cleanup keeps the restored files", async () => {
		const storage = tempDir();
		const work = tempDir();
		fs.mkdirSync(path.join(storage, "world"), { recursive: true });
		fs.writeFileSync(path.join(storage, "world", "level.dat"), "live");
		const staged = tempDir();
		fs.mkdirSync(path.join(staged, "world"), { recursive: true });
		fs.writeFileSync(path.join(staged, "world", "level.dat"), "backup");

		const swap = swapIn(work, "test.commit", storage, staged, { paths: ["world"], exclude: [] });
		swap.commit();
		// the daemon died here, before the parked originals were cleared
		const [ended] = fs.readdirSync(work);
		expect(fs.readFileSync(path.join(work, ended!, "parked", "world", "level.dat"), "utf8")).toBe("live");
		expect(recoverRestores(work, () => storage)).toEqual([]);
		expect(fs.readFileSync(path.join(storage, "world", "level.dat"), "utf8")).toBe("backup");
		expect(fs.readdirSync(work)).toEqual([]);
	});

	test("a whole-storage restore never moves what it leaves out, and rolls back without it", async () => {
		const storage = tempDir();
		const work = tempDir();
		fs.mkdirSync(path.join(storage, "servers", "other"), { recursive: true });
		fs.writeFileSync(path.join(storage, "servers", "other", "world.dat"), "running sibling");
		fs.writeFileSync(path.join(storage, "level.dat"), "live");
		const staged = tempDir();
		fs.writeFileSync(path.join(staged, "level.dat"), "backup");
		const sibling = fs.statSync(path.join(storage, "servers")).ino;

		const swap = swapIn(work, "test.whole", storage, staged, { paths: [""], exclude: ["servers"] });
		expect(fs.statSync(path.join(storage, "servers")).ino).toBe(sibling);
		expect(fs.readFileSync(path.join(storage, "level.dat"), "utf8")).toBe("backup");
		swap.rollback();
		expect(fs.statSync(path.join(storage, "servers")).ino).toBe(sibling);
		expect(fs.readFileSync(path.join(storage, "level.dat"), "utf8")).toBe("live");
		expect(fs.readFileSync(path.join(storage, "servers", "other", "world.dat"), "utf8")).toBe("running sibling");
	});

	test("what a backup left out never comes from its archive, even where the storage had nothing", async () => {
		const storage = tempDir();
		const work = tempDir();
		fs.mkdirSync(path.join(storage, "servers", "x"), { recursive: true });
		fs.writeFileSync(path.join(storage, "servers", "x", "world.dat"), "live");
		const staged = tempDir();
		fs.mkdirSync(path.join(staged, "servers", "x", "install"), { recursive: true });
		fs.writeFileSync(path.join(staged, "servers", "x", "world.dat"), "backup");
		fs.writeFileSync(path.join(staged, "servers", "x", "install", "planted.bin"), "not from this storage");

		const swap = swapIn(work, "test.planted", storage, staged, { paths: ["servers/x"], exclude: ["servers/x/install"] });
		expect(fs.readFileSync(path.join(storage, "servers", "x", "world.dat"), "utf8")).toBe("backup");
		expect(fs.existsSync(path.join(storage, "servers", "x", "install"))).toBe(false);
		swap.commit();
		await swap.clear();
		expect(fs.readdirSync(work)).toEqual([]);
	});

	test("a restore whose journal can't be deleted keeps the backup's files and names the journal", () => {
		const storage = tempDir();
		const work = tempDir();
		fs.writeFileSync(path.join(storage, "a.txt"), "live");
		const staged = tempDir();
		fs.writeFileSync(path.join(staged, "a.txt"), "backup");
		const swap = swapIn(work, "test.stuck", storage, staged, { paths: ["a.txt"], exclude: [] });
		const [dir] = fs.readdirSync(work);
		fs.chmodSync(path.join(work, dir!), 0o555);
		try {
			expect(() => swap.commit()).toThrow(path.join(work, dir!, "journal.json"));
		} finally {
			fs.chmodSync(path.join(work, dir!), 0o755);
		}
		expect(fs.readFileSync(path.join(storage, "a.txt"), "utf8")).toBe("backup");
	});

	test("a rollback whose swap folder can't be deleted still puts the files back, and no later start undoes it again", () => {
		const storage = tempDir();
		const work = tempDir();
		fs.writeFileSync(path.join(storage, "a.txt"), "live");
		const staged = tempDir();
		fs.writeFileSync(path.join(staged, "a.txt"), "backup");
		const swap = swapIn(work, "test.busy", storage, staged, { paths: ["a.txt"], exclude: [] });
		const [dir] = fs.readdirSync(work);
		// something in the swap folder that won't go, as an open file on Windows wouldn't
		const busy = path.join(work, dir!, "busy");
		fs.mkdirSync(path.join(busy, "inner"), { recursive: true });
		fs.writeFileSync(path.join(busy, "inner", "x"), "x");
		fs.chmodSync(busy, 0o555);
		try {
			swap.rollback();
			expect(fs.readFileSync(path.join(storage, "a.txt"), "utf8")).toBe("live");
			expect(fs.existsSync(path.join(work, dir!, "journal.json"))).toBe(false);
			fs.writeFileSync(path.join(storage, "a.txt"), "changed after");
			expect(recoverRestores(work, () => storage)).toEqual([]);
			expect(fs.readFileSync(path.join(storage, "a.txt"), "utf8")).toBe("changed after");
		} finally {
			fs.chmodSync(busy, 0o755);
		}
	});

	test("each interrupted restore is recovered on its own, and one that can't be is named, not thrown", async () => {
		const work = tempDir();
		const good = tempDir();
		fs.writeFileSync(path.join(good, "a.txt"), "live");
		const staged = tempDir();
		fs.writeFileSync(path.join(staged, "a.txt"), "backup");
		swapIn(work, "test.good", good, staged, { paths: ["a.txt"], exclude: [] });
		// a second swap whose journal names a panel whose storage can't be reached
		fs.mkdirSync(path.join(work, "restore-broken", "parked"), { recursive: true });
		fs.writeFileSync(path.join(work, "restore-broken", "parked", "b.txt"), "original");
		fs.writeFileSync(path.join(work, "restore-broken", "journal.json"), JSON.stringify({ panelId: "test.broken", units: [{ path: "b.txt", existed: true }], exclude: [] }));
		fs.mkdirSync(path.join(work, "restore-unreadable"));
		fs.writeFileSync(path.join(work, "restore-unreadable", "journal.json"), "{damaged");
		// a journal that can't be read at all is named the same way
		fs.mkdirSync(path.join(work, "restore-locked", "journal.json"), { recursive: true });
		// a leftover that can't be deleted doesn't stop the swaps after it
		const stuck = path.join(work, "aaa-leftover");
		fs.mkdirSync(path.join(stuck, "inner"), { recursive: true });
		fs.writeFileSync(path.join(stuck, "inner", "x"), "x");
		fs.chmodSync(stuck, 0o555);

		const failed = recoverRestores(work, (panelId) => {
			if (panelId === "test.broken") throw new Error("no storage for test.broken");
			return good;
		});
		fs.chmodSync(stuck, 0o755);
		expect(failed.map((f) => [f.panelId, f.error])).toEqual(expect.arrayContaining([["test.broken", "no storage for test.broken"], [null, expect.any(String)]]));
		expect(failed).toHaveLength(3);
		expect(failed.filter((f) => f.panelId === null)).toHaveLength(2);
		expect(fs.readFileSync(path.join(good, "a.txt"), "utf8")).toBe("live");
		// what could not be undone is kept where the problem says
		expect(fs.readFileSync(path.join(work, "restore-broken", "parked", "b.txt"), "utf8")).toBe("original");
	});

	test("paths and excludes that a swap can't keep apart are refused, from a panel and from a store's record", () => {
		const refused: Array<[string[], string[]]> = [
			[["a", "a"], []],
			[["a", "a/b"], []],
			[["", "a"], []],
			[["s"], ["s/a/b", "s/a"]],
			[["s"], [""]],
			[["s"], ["s"]],
			[["s"], ["t/x"]],
		];
		for (const [paths, exclude] of refused) {
			expect({ paths, exclude, refused: backupPathsProblem(paths, exclude) !== null }).toEqual({ paths, exclude, refused: true });
			expect(() => backupContents({ paths, exclude })).toThrow();
			const record = { format: 2, id: newBackupId(), panelId: "test.paths", target: null, createdAt: new Date().toISOString(), size: 1, sha256: "a".repeat(64), panelVersion: null, label: null, paths, exclude };
			expect(parseBackupRecord(record)).toBeNull();
		}
		expect(backupPathsProblem([""], ["servers", "cache/tmp"])).toBeNull();
		expect(backupPathsProblem(["servers/a"], ["servers/a/install"])).toBeNull();
	});
});

async function archiveRecord(panelId: string, target: string | null = null): Promise<{ record: BackupRecord; file: string }> {
	const storage = tempDir();
	fs.writeFileSync(path.join(storage, "data.bin"), Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251)));
	const file = path.join(tempDir(), "archive.pbbackup");
	const made = await createBackupArchive(storage, { paths: [""], exclude: [], skip: [], data: null }, file);
	return {
		file,
		record: { format: 2, id: newBackupId(), panelId, target, createdAt: new Date().toISOString(), size: made.size, sha256: made.sha256, panelVersion: "1.0.0", label: null, paths: [""], exclude: [] },
	};
}

describe("backup stores", () => {
	const s3 = fakeS3("bucket");
	const drive = fakeDrive();
	drive.accounts.set("refresh-alice", "alice");
	drive.accounts.set("refresh-bob", "bob");
	afterAll(async () => {
		await s3.close();
		await drive.close();
	});

	test("an S3 backup whose record can't be saved takes its uploaded archive with it", async () => {
		const store = new S3BackupStore({ endpoint: s3.url, region: "us-east-1", bucket: "bucket", prefix: "orphan", accessKeyId: "AKID", pathStyle: true }, { secretAccessKey: "s3cret" });
		const { record, file } = await archiveRecord("test.orphan");
		s3.refusePut = (key) => key.endsWith(".json");
		try {
			await expect(store.put(record, file)).rejects.toThrow("Saving the backup record");
		} finally {
			s3.refusePut = null;
		}
		expect([...s3.objects.keys()].filter((key) => key.startsWith("orphan/"))).toEqual([]);
		expect((await store.usage()).used).toBe(0);
	});

	test("SigV4 reproduces AWS's published example signature", () => {
		const authorization = signS3Request({
			method: "GET",
			url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
			headers: {
				host: "examplebucket.s3.amazonaws.com",
				range: "bytes=0-9",
				"x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				"x-amz-date": "20130524T000000Z",
			},
			payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			region: "us-east-1",
			accessKeyId: "AKIAIOSFODNN7EXAMPLE",
			secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
			amzDate: "20130524T000000Z",
		});
		expect(authorization).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
		);
	});

	test("local, S3 and Drive stores check, put, list by target, count usage, get byte-identical and remove", async () => {
		const driveStore = new DriveBackupStore("d-alice", { clientId: "client", folderId: "" }, { clientSecret: "secret", refreshToken: "refresh-alice" }, drive.endpoints);
		const folderId = await driveStore.createFolder();
		const stores = {
			local: new LocalBackupStore(path.join(tempDir(), "panels")),
			s3: new S3BackupStore({ endpoint: s3.url, region: "us-east-1", bucket: "bucket", prefix: "pb", accessKeyId: "AKID", pathStyle: true }, { secretAccessKey: "s3cret" }),
			drive: new DriveBackupStore("d-alice", { clientId: "client", folderId }, { clientSecret: "secret", refreshToken: "refresh-alice" }, drive.endpoints),
		};
		for (const [kind, store] of Object.entries(stores)) {
			const { record, file } = await archiveRecord("test.cloud", "alpha");
			const other = await archiveRecord("test.cloud", null);
			await store.check();
			await store.put(record, file);
			await store.put(other.record, other.file);
			expect({ kind, alpha: (await store.list("test.cloud", "alpha")).map((r) => r.id), panel: (await store.list("test.cloud", null)).map((r) => r.id) })
				.toEqual({ kind, alpha: [record.id], panel: [other.record.id] });
			expect((await store.usage()).used).toBe(record.size + other.record.size);
			const back = path.join(tempDir(), "back.pbbackup");
			await store.get(record, back);
			expect(fs.readFileSync(back).equals(fs.readFileSync(file))).toBe(true);
			await store.remove(record);
			await store.remove(other.record);
			expect(await store.list("test.cloud", "alpha")).toEqual([]);
		}
		expect(s3.requests.every((r) => r.authorization?.startsWith("AWS4-HMAC-SHA256 Credential=AKID/"))).toBe(true);
	});

	test("backups in the old format are not listed and stay where they are", async () => {
		const root = path.join(tempDir(), "panels");
		const id = newBackupId();
		const old = path.join(root, "test.old");
		fs.mkdirSync(old, { recursive: true });
		fs.writeFileSync(path.join(old, `${id}.json`), JSON.stringify({ format: 1, id, panelId: "test.old", createdAt: new Date().toISOString(), size: 1, sha256: "a".repeat(64), panelVersion: null, label: null }));
		fs.writeFileSync(path.join(old, `${id}.pbbackup`), "x");
		expect(await new LocalBackupStore(root).list("test.old", null)).toEqual([]);
		expect(fs.readdirSync(old).sort()).toEqual([`${id}.json`, `${id}.pbbackup`]);
	});

	test("reconnecting Drive keeps the location, folder and backups, and a different account is refused", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.cloud" });
		const engine = new PaperCraneEngine(dir);
		const locations = new BackupService(engine, drive.endpoints).locations;
		const location = await locations.add({ kind: "gdrive", label: "Drive", clientId: "client", clientSecret: "secret", refreshToken: "refresh-alice" });
		await locations.setForPanel("test.cloud", location.id);
		const { record, file } = await archiveRecord("test.cloud");
		await locations.storeFor("test.cloud").put(record, file);
		const vaulted = () => engine.getSecret(`${location.id}.refresh-token`, "shell-backups").value;

		drive.accounts.set("refresh-alice-2", "alice");
		const again = await locations.reconnect(location.id, { clientId: "client", clientSecret: "secret", refreshToken: "refresh-alice-2" });
		expect(again.id).toBe(location.id);
		expect(vaulted()).toBe("refresh-alice-2");
		expect((await locations.storeFor("test.cloud").list("test.cloud", null)).map((r) => r.id)).toEqual([record.id]);

		await expect(locations.reconnect(location.id, { clientId: "client", clientSecret: "secret", refreshToken: "refresh-bob" })).rejects.toThrow();
		expect(vaulted()).toBe("refresh-alice-2");
		expect(locations.list().filter((l) => l.kind === "gdrive").map((l) => l.id)).toEqual([location.id]);
	});
});

// Unreadable backup metadata fails loudly and is never overwritten.
describe("unreadable backup metadata", () => {
	test("a corrupt record makes list throw for local, S3 and Drive stores", async () => {
		const s3 = fakeS3("bucket");
		const drive = fakeDrive();
		drive.accounts.set("refresh", "alice");
		try {
			const id = newBackupId();
			const root = path.join(tempDir(), "panels");
			fs.mkdirSync(path.join(root, "test.bad", "_panel"), { recursive: true });
			fs.writeFileSync(path.join(root, "test.bad", "_panel", `${id}.json`), "{not a record");
			fs.writeFileSync(path.join(root, "test.bad", "_panel", `${id}.pbbackup`), "x");
			await expect(new LocalBackupStore(root).list("test.bad", null)).rejects.toThrow("could not be read");

			s3.objects.set(`test.bad/_panel/${id}.pbbackup`, Buffer.from("x"));
			s3.objects.set(`test.bad/_panel/${id}.json`, Buffer.from("{not a record"));
			const s3Store = new S3BackupStore({ endpoint: s3.url, region: "us-east-1", bucket: "bucket", prefix: "", accessKeyId: "AKID", pathStyle: true }, { secretAccessKey: "k" });
			await expect(s3Store.list("test.bad", null)).rejects.toThrow("could not be read");

			const store = new DriveBackupStore("d-bad", { clientId: "c", folderId: "" }, { clientSecret: "s", refreshToken: "refresh" }, drive.endpoints);
			const folderId = await store.createFolder();
			const { panelKey } = await import("../src/backups/driveStore");
			drive.files.set("broken", { id: "broken", account: "alice", name: "x.pbbackup", mimeType: "application/gzip", parents: [folderId], description: "{not a record", appProperties: { pbFormat: "2", pbPanel: panelKey("test.bad"), pbTarget: "_panel" }, trashed: false });
			const listed = new DriveBackupStore("d-bad", { clientId: "c", folderId }, { clientSecret: "s", refreshToken: "refresh" }, drive.endpoints);
			await expect(listed.list("test.bad", null)).rejects.toThrow("could not be read");
		} finally {
			await s3.close();
			await drive.close();
		}
	});

	test("an unreadable destinations.json refuses listing and changes until recovered, and keeps its bytes", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.meta" });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		const file = path.join(dir, "backups", "destinations.json");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "{damaged");
		expect((await host.call("backup:locations")).error).toBeTruthy();
		expect((await host.call("backup:panel-location-set", { panelId: "test.meta", locationId: "local" })).error).toBeTruthy();
		expect(fs.readFileSync(file, "utf8")).toBe("{damaged");
		expect((await host.ok("backup:locations-problem")).problem).toBeTruthy();
		const { keptAs } = await host.ok("backup:locations-recover");
		expect(fs.readFileSync(path.join(path.dirname(file), keptAs), "utf8")).toBe("{damaged");
		expect((await host.ok("backup:locations")).locations.map((l: { id: string }) => l.id)).toEqual(["local"]);
		await host.close();
	});
});
