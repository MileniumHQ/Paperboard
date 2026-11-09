import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as tarLib from "tar";
import { PaperCraneEngine } from "../../papercrane/engine";
import { BackupService } from "../../papercrane/backups/service";
import { createPanelArchive, extractPanelArchive } from "../../papercrane/backups/archive";
import { LocalBackupStore } from "../../papercrane/backups/localStore";
import { S3BackupStore, signS3Request } from "../../papercrane/backups/s3Store";
import { DriveBackupStore } from "../../papercrane/backups/driveStore";
import { BUSY_RETRY_MS, MAX_KEEP, SCHEDULE_HOURS, SCHEDULED_LABEL } from "../../papercrane/backups/schedules";
import { newBackupId, type BackupRecord } from "../../papercrane/backups/types";
import { MAX_ROUTINE_BACKUPS_KEPT, ROUTINE_BACKUP_HOURS, ROUTINE_BACKUP_LABEL } from "../../../../packages/paperapi/src/backups";
import { tarGz } from "./support/archive";
import { fakeDrive, fakeS3 } from "./support/cloud";
import { killWorkloads, startCrane } from "./support/crane";
import { dataDir, listTree, tempDir } from "./support/fs";
import { startDaemon, stopDaemon, type InProcessDaemon } from "./support/inproc";
import { installPanelFiles, PAPERAPI, serviceSource } from "./support/panels";
import type { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(stopDaemon);

// A service that writes a line to `log` each time it starts.
function countedService(log: string, body: { actions?: string; options?: string; extra?: string } = {}) {
	return serviceSource({
		...body,
		extra: `import * as fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(log)}, "start\\n");\n${body.extra ?? ""}`,
	});
}
const starts = (log: string) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0);

async function readyService(rpc: Rpc, panelId: string, action = "ping") {
	await waitFor(`${panelId}'s service`, async () => !(await rpc.call("actions:call", { panelId, action, args: [] })).error);
}

const PING = "{ ping: async () => 'pong' }";

// A panel backs up and restores its own data.
describe("a panel backs up and restores its own data", () => {
	test("backup needs a location, records the version, restarts the service, and restore puts the data back", async () => {
		const dir = dataDir();
		const log = path.join(tempDir(), "starts.log");
		await installPanelFiles(dir, { id: "test.saver", version: "1.2.3", service: countedService(log, { actions: PING }) });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		const panel = await daemon.panelRpc("test.saver");
		await readyService(host, "test.saver");
		await panel.ok("file:write", { targetPath: "world/level.dat", content: "original" });
		await panel.ok("config:set", { id: "test.saver", data: { difficulty: "hard" } });

		expect((await panel.fail("backup:create", { panelId: "test.saver" })).code).toBe("CONFLICT");
		await host.ok("backup:panel-destination-set", { panelId: "test.saver", destinationId: "local" });
		const before = starts(log);
		const record = await panel.ok("backup:create", { panelId: "test.saver", label: "before change" });
		expect(record.panelVersion).toBe("1.2.3");
		expect(starts(log)).toBe(before + 1);
		await readyService(host, "test.saver");

		await panel.ok("file:write", { targetPath: "world/level.dat", content: "changed" });
		await panel.ok("file:write", { targetPath: "world/new.dat", content: "new" });
		await panel.ok("config:set", { id: "test.saver", data: { difficulty: "easy" } });
		await panel.ok("backup:restore", { panelId: "test.saver", backupId: record.id });
		expect(fs.readFileSync(path.join(dir, "files", "test.saver", "world", "level.dat"), "utf8")).toBe("original");
		expect(fs.existsSync(path.join(dir, "files", "test.saver", "world", "new.dat"))).toBe(false);
		expect(JSON.parse(fs.readFileSync(path.join(dir, "configs", "test.saver.json"), "utf8"))).toEqual({ difficulty: "hard" });
		expect(starts(log)).toBe(before + 2);
		await readyService(host, "test.saver");
		expect(listTree(dir).filter((f) => f.includes(".restore-parked"))).toEqual([]);

		// a backup made by a newer panel version is refused before data moves
		const manifest = path.join(dir, "panels", "test.saver", "manifest.json");
		fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, "utf8")), version: "1.0.0" }));
		await panel.ok("file:write", { targetPath: "world/level.dat", content: "keep me" });
		expect((await panel.fail("backup:restore", { panelId: "test.saver", backupId: record.id })).code).toBe("CONFLICT");
		expect(fs.readFileSync(path.join(dir, "files", "test.saver", "world", "level.dat"), "utf8")).toBe("keep me");
		await panel.close();
		await host.close();
	});

	test("a restore whose service never gets ready puts the previous data back and runs on it", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.fragile", service: serviceSource({ actions: PING }) });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		await readyService(host, "test.fragile");
		await host.ok("file:write", { appId: "test.fragile", targetPath: "state.txt", content: "old" });
		await host.ok("backup:panel-destination-set", { panelId: "test.fragile", destinationId: "local" });
		const record = await host.ok("backup:create", { panelId: "test.fragile" });
		await readyService(host, "test.fragile");
		await host.ok("file:write", { appId: "test.fragile", targetPath: "state.txt", content: "current" });

		// the next service build cannot start on the old data
		const stateFile = path.join(dir, "files", "test.fragile", "state.txt");
		await installPanelFiles(dir, {
			id: "test.fragile",
			service: serviceSource({ actions: PING, extra: `import * as fs from "node:fs"; if (fs.readFileSync(${JSON.stringify(stateFile)}, "utf8") === "old") process.exit(1);` }),
		});
		expect((await host.call("backup:restore", { panelId: "test.fragile", backupId: record.id })).error).toBeTruthy();
		expect(fs.readFileSync(stateFile, "utf8")).toBe("current");
		await readyService(host, "test.fragile");
		expect(listTree(dir).filter((f) => f.includes(".restore-parked"))).toEqual([]);
		await host.close();
	});
});

// Named sources and `beforeBackup` prepare only what's backed up.
describe("named sources and beforeBackup", () => {
	test("sources are fixed once defined, skip names at every depth, and leave other sources alone on restore", async () => {
		const dir = dataDir();
		const seen = path.join(tempDir(), "before-backup.log");
		await installPanelFiles(dir, {
			id: "test.multi",
			service: serviceSource({ actions: PING, extra: 'import * as fs from "node:fs";', options: `beforeBackup: async (_ctx, options) => { fs.appendFileSync(${JSON.stringify(seen)}, String(options.sourceId) + "\\n"); },` }),
		});
		const daemon = await startDaemon({ dataDir: dir });
		const panel = await daemon.panelRpc("test.multi");
		const host = await daemon.rpc();
		await readyService(host, "test.multi");
		const source = (id: string, directory: string, extra: Record<string, unknown> = {}) => ({ id, directory, config: ["servers", { id }], processes: [], skip: ["session.lock"], ...extra });
		await panel.ok("config:set", { id: "test.multi", data: { servers: [{ id: "alpha", motd: "a" }, { id: "beta", motd: "b" }] } });
		await panel.ok("backup:source-define", { panelId: "test.multi", source: source("alpha", "servers/alpha") });
		await panel.ok("backup:source-define", { panelId: "test.multi", source: source("beta", "servers/beta") });
		expect((await panel.call("backup:source-define", { panelId: "test.multi", source: source("alpha", "servers/elsewhere") })).error).toContain("cannot change");
		expect((await panel.call("backup:source-define", { panelId: "test.multi", source: source("alpha", "servers/alpha", { skip: ["../x"] }) })).error).toBeTruthy();
		expect((await panel.call("backup:source-define", { panelId: "test.multi", source: source("alpha", "servers/alpha", { skip: ["a/b"] }) })).error).toBeTruthy();

		for (const [name, content] of [["servers/alpha/world.dat", "alpha-1"], ["servers/alpha/session.lock", "lock"], ["servers/alpha/deep/session.lock", "lock"], ["servers/beta/world.dat", "beta-1"]]) {
			await panel.ok("file:write", { targetPath: name!, content: content! });
		}
		await host.ok("backup:panel-destination-set", { panelId: "test.multi", sourceId: "alpha", destinationId: "local" });
		const record = await panel.ok("backup:create", { panelId: "test.multi", sourceId: "alpha" });
		expect(record.sourceId).toBe("alpha");
		expect(fs.readFileSync(seen, "utf8")).toBe("alpha\n");
		const archive = listTree(path.join(dir, "backups", "panels")).find((f) => f.endsWith(`${record.id}.pbbackup`))!;
		const members: string[] = [];
		await tarLib.t({ file: path.join(dir, "backups", "panels", archive), onReadEntry: (e) => members.push(e.path) });
		expect(members.some((m) => m.endsWith("session.lock"))).toBe(false);
		expect(members.some((m) => m.endsWith("world.dat"))).toBe(true);

		await panel.ok("file:write", { targetPath: "servers/alpha/world.dat", content: "alpha-2" });
		await panel.ok("file:write", { targetPath: "servers/beta/world.dat", content: "beta-2" });
		await panel.ok("config:set", { id: "test.multi", data: { servers: [{ id: "alpha", motd: "a2" }, { id: "beta", motd: "b2" }] } });
		await panel.ok("backup:restore", { panelId: "test.multi", sourceId: "alpha", backupId: record.id });
		expect(fs.readFileSync(path.join(dir, "files", "test.multi", "servers", "alpha", "world.dat"), "utf8")).toBe("alpha-1");
		expect(fs.readFileSync(path.join(dir, "files", "test.multi", "servers", "beta", "world.dat"), "utf8")).toBe("beta-2");
		expect((await panel.ok("config:get", { id: "test.multi" })).data.servers).toEqual([{ id: "alpha", motd: "a" }, { id: "beta", motd: "b2" }]);
		await panel.close();
		await host.close();
	});

	test("a beforeBackup error refuses the backup and restarts the service; progress lists a running backup", async () => {
		const dir = dataDir();
		const log = path.join(tempDir(), "starts.log");
		await installPanelFiles(dir, {
			id: "test.prep",
			service: countedService(log, {
				extra: "let release: () => void = () => {}; let mode = 'refuse';",
				actions: "{ ping: async () => 'pong', allow: async () => { mode = 'wait'; return true; }, release: async () => { release(); return true; } }",
				options: "beforeBackup: async () => { if (mode === 'refuse') throw new Error('world is busy'); await new Promise<void>((r) => { release = r; }); },",
			}),
		});
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		const panel = await daemon.panelRpc("test.prep");
		await readyService(host, "test.prep");
		await panel.ok("file:write", { targetPath: "x.txt", content: "x" });
		await host.ok("backup:panel-destination-set", { panelId: "test.prep", destinationId: "local" });
		const before = starts(log);
		const refused = await panel.fail("backup:create", { panelId: "test.prep" });
		expect(refused.code).toBe("CONFLICT");
		expect(refused.error).toContain("world is busy");
		expect(starts(log)).toBe(before + 1);
		await readyService(host, "test.prep");

		await host.ok("actions:call", { panelId: "test.prep", action: "allow", args: [] });
		const running = panel.call("backup:create", { panelId: "test.prep" }, 30_000);
		const progress = await waitFor("the running backup in progress", async () => {
			const list = (await panel.ok("backup:progress", { panelId: "test.prep" })).progress;
			return list.length ? list : null;
		});
		expect(progress[0]).toMatchObject({ panelId: "test.prep", kind: "create" });
		await host.ok("actions:call", { panelId: "test.prep", action: "release", args: [] });
		expect((await running).error).toBeUndefined();
		await panel.close();
		await host.close();
	});
});

// A service backing up its own panel from an action gets the backup as the answer.
describe("a service that backs up its own panel from an action", () => {
	test("gets the backup record as the action's answer, answers the next call, and a foreign duringCall is refused", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, {
			id: "test.selfsave",
			service: serviceSource({
				extra: `import { backupApi } from ${JSON.stringify(PAPERAPI)};`,
				actions: "{ ping: async () => 'pong', save: async () => backupApi.create('test.selfsave', { label: 'from action' })}",
			}),
		});
		const crane = await startCrane({ dataDir: dir });
		try {
			const host = await crane.rpc();
			await readyService(host, "test.selfsave");
			await host.ok("file:write", { appId: "test.selfsave", targetPath: "data.txt", content: "d" });
			await host.ok("backup:panel-destination-set", { panelId: "test.selfsave", destinationId: "local" });
			const answer = await host.ok("actions:call", { panelId: "test.selfsave", action: "save", args: [], timeoutMs: 60_000 }, 70_000);
			expect(answer.result).toMatchObject({ panelId: "test.selfsave", label: "from action" });
			await readyService(host, "test.selfsave");

			// a call that went to another connection cannot be carried by this one
			const served = await crane.rpc();
			await served.ok("actions:register", { panelId: "test.carrier", action: "hold" });
			const held = host.call("actions:call", { panelId: "test.carrier", action: "hold", args: [], timeoutMs: 60_000 }, 70_000);
			const call = await served.next((f) => f.type === "action_call" && f.action === "hold");
			const intruder = await crane.rpc();
			expect((await intruder.fail("backup:create", { panelId: "test.selfsave", duringCall: call.callId })).code).toBe("FORBIDDEN");
			served.send({ type: "action_reply", callId: call.callId, result: "done" });
			expect((await held).result).toEqual({ result: "done" });
			await intruder.close();
			await served.close();
			await host.close();
		} finally {
			await crane.stop();
			await killWorkloads(dir);
		}
	});
});

// Backup archives hold only this panel's data and release every handle.
describe("backup archives hold only the panel's data", () => {
	const entries = { files: "files/test.arch", config: "configs/test.arch.json" };
	const archiveOf = (members: Parameters<typeof tarGz>[0]) => {
		const file = path.join(tempDir(), "backup.pbbackup");
		fs.writeFileSync(file, tarGz(members));
		return file;
	};

	test("another panel's members, symlinks and archives over the entry budget are refused with staging left empty", async () => {
		const cases = [
			[{ name: "files/test.arch/ok.txt", content: "ok" }, { name: "files/test.other/steal.txt", content: "x" }],
			[{ name: "configs/test.other.json", content: "{}" }],
			[{ name: "files/test.arch/link", type: "symlink" as const, target: "../../local/secrets.json" }],
			Array.from({ length: 100_001 }, (_, i) => ({ name: `files/test.arch/f${i}`, content: "" })),
		];
		for (const members of cases) {
			const staging = tempDir();
			await expect(extractPanelArchive(archiveOf(members), entries, staging)).rejects.toThrow();
			expect(listTree(staging)).toEqual([]);
		}
	});

	if (process.platform === "linux") {
		test("packing that fails on an unreadable file leaves no open handle", async () => {
			if (process.getuid?.() === 0) throw new Error("This test needs a non-root user: root reads a file with mode 000");
			const dir = dataDir();
			const files = path.join(dir, "files", "test.arch");
			fs.mkdirSync(files, { recursive: true });
			fs.writeFileSync(path.join(files, "a.txt"), "a");
			fs.writeFileSync(path.join(files, "locked.txt"), "secret");
			fs.chmodSync(path.join(files, "locked.txt"), 0o000);
			const out = path.join(tempDir(), "out.pbbackup");
			const openInto = () =>
				fs.readdirSync("/proc/self/fd").flatMap((fd) => {
					try {
						const target = fs.readlinkSync(`/proc/self/fd/${fd}`);
						return target === out || target.startsWith(files) ? [target] : [];
					} catch (err) {
						// the fd the listing itself used is closed by now
						if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
						throw err;
					}
				});
			await expect(createPanelArchive(dir, entries, out)).rejects.toThrow();
			expect(openInto()).toEqual([]);
			fs.chmodSync(path.join(files, "locked.txt"), 0o600);
		});
	}
});

async function archiveRecord(panelId: string): Promise<{ record: BackupRecord; file: string }> {
	const dir = dataDir();
	fs.mkdirSync(path.join(dir, "files", panelId), { recursive: true });
	fs.writeFileSync(path.join(dir, "files", panelId, "data.bin"), Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251)));
	const file = path.join(tempDir(), "archive.pbbackup");
	const made = await createPanelArchive(dir, { files: `files/${panelId}`, config: `configs/${panelId}.json` }, file);
	return { file, record: { format: 1, id: newBackupId(), panelId, createdAt: new Date().toISOString(), size: made.size, sha256: made.sha256, panelVersion: "1.0.0", label: null } };
}

// S3 and Google Drive stores round-trip and reconnect without loss.
describe("cloud stores round-trip", () => {
	const s3 = fakeS3("bucket");
	const drive = fakeDrive();
	drive.accounts.set("refresh-alice", "alice");
	drive.accounts.set("refresh-bob", "bob");
	afterAll(async () => {
		await s3.close();
		await drive.close();
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

	test("local, S3 and Drive stores check, put, list, count usage, get byte-identical and remove", async () => {
		const driveStore = new DriveBackupStore("d-alice", { clientId: "client", folderId: "" }, { clientSecret: "secret", refreshToken: "refresh-alice" }, drive.endpoints);
		const folderId = await driveStore.createFolder();
		const stores = {
			local: new LocalBackupStore(path.join(tempDir(), "panels")),
			s3: new S3BackupStore({ endpoint: s3.url, region: "us-east-1", bucket: "bucket", prefix: "pb", accessKeyId: "AKID", pathStyle: true }, { secretAccessKey: "s3cret" }),
			drive: new DriveBackupStore("d-alice", { clientId: "client", folderId }, { clientSecret: "secret", refreshToken: "refresh-alice" }, drive.endpoints),
		};
		for (const [kind, store] of Object.entries(stores)) {
			const { record, file } = await archiveRecord("test.cloud");
			await store.check();
			await store.put(record, file);
			expect({ kind, ids: (await store.list("test.cloud")).map((r) => r.id) }).toEqual({ kind, ids: [record.id] });
			expect((await store.usage()).used).toBe(record.size);
			const back = path.join(tempDir(), "back.pbbackup");
			await store.get(record, back);
			expect(fs.readFileSync(back).equals(fs.readFileSync(file))).toBe(true);
			await store.remove(record);
			expect(await store.list("test.cloud")).toEqual([]);
		}
		expect(s3.requests.every((r) => r.authorization?.startsWith("AWS4-HMAC-SHA256 Credential=AKID/"))).toBe(true);
	});

	test("reconnecting Drive keeps the location, folder and backups, and a different account is refused", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.cloud" });
		const engine = new PaperCraneEngine(dir);
		const service = new BackupService(engine, drive.endpoints);
		const location = await service.addDestination({ kind: "gdrive", label: "Drive", clientId: "client", clientSecret: "secret", refreshToken: "refresh-alice" });
		await service.setPanelDestination("test.cloud", location.id);
		await engine.writeFile("data.txt", "keep", "test.cloud");
		const record = await service.create("test.cloud", null);
		const vaulted = () => engine.getSecret(`${location.id}.refresh-token`, "shell-backups").value;

		drive.accounts.set("refresh-alice-2", "alice");
		const again = await service.reconnectDestination(location.id, { clientId: "client", clientSecret: "secret", refreshToken: "refresh-alice-2" });
		expect(again.id).toBe(location.id);
		expect(vaulted()).toBe("refresh-alice-2");
		expect((await service.list("test.cloud")).map((r) => r.id)).toEqual([record.id]);

		await expect(service.reconnectDestination(location.id, { clientId: "client", clientSecret: "secret", refreshToken: "refresh-bob" })).rejects.toThrow();
		expect(vaulted()).toBe("refresh-alice-2");
		expect(service.listDestinations().filter((d) => d.kind === "gdrive").map((d) => d.id)).toEqual([location.id]);
		service.dispose();
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
			fs.mkdirSync(path.join(root, "test.bad"), { recursive: true });
			fs.writeFileSync(path.join(root, "test.bad", `${id}.json`), "{not a record");
			fs.writeFileSync(path.join(root, "test.bad", `${id}.pbbackup`), "x");
			await expect(new LocalBackupStore(root).list("test.bad")).rejects.toThrow("could not be read");

			s3.objects.set(`test.bad/${id}.pbbackup`, Buffer.from("x"));
			s3.objects.set(`test.bad/${id}.json`, Buffer.from("{not a record"));
			const s3Store = new S3BackupStore({ endpoint: s3.url, region: "us-east-1", bucket: "bucket", prefix: "", accessKeyId: "AKID", pathStyle: true }, { secretAccessKey: "k" });
			await expect(s3Store.list("test.bad")).rejects.toThrow("could not be read");

			const store = new DriveBackupStore("d-bad", { clientId: "c", folderId: "" }, { clientSecret: "s", refreshToken: "refresh" }, drive.endpoints);
			const folderId = await store.createFolder();
			const { panelKey } = await import("../../papercrane/backups/driveStore");
			drive.files.set("broken", { id: "broken", account: "alice", name: "x.pbbackup", mimeType: "application/gzip", parents: [folderId], description: "{not a record", appProperties: { pbPanel: panelKey("test.bad") }, trashed: false });
			const listed = new DriveBackupStore("d-bad", { clientId: "c", folderId }, { clientSecret: "s", refreshToken: "refresh" }, drive.endpoints);
			await expect(listed.list("test.bad")).rejects.toThrow("could not be read");
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
		expect((await host.call("backup:destinations")).error).toBeTruthy();
		expect((await host.call("backup:panel-destination-set", { panelId: "test.meta", destinationId: "local" })).error).toBeTruthy();
		expect(fs.readFileSync(file, "utf8")).toBe("{damaged");
		expect((await host.ok("backup:destinations-problem")).problem).toBeTruthy();
		const { keptAs } = await host.ok("backup:destinations-recover");
		expect(fs.readFileSync(path.join(path.dirname(file), keptAs), "utf8")).toBe("{damaged");
		expect((await host.ok("backup:destinations")).destinations.map((d: any) => d.id)).toEqual(["local"]);

		await host.ok("backup:panel-destination-set", { panelId: "test.meta", destinationId: "local" });
		const schedules = path.join(dir, "backups", "schedules.json");
		fs.writeFileSync(schedules, "{damaged");
		expect((await host.call("backup:schedule-set", { panelId: "test.meta", schedule: { everyHours: 24, keep: 3 } })).error).toBeTruthy();
		expect(fs.readFileSync(schedules, "utf8")).toBe("{damaged");
		await host.close();
	});
});

// Routine backups run, prune only routine copies, and retry.
describe("routine backups", () => {
	test("paperapi's routine backup constants equal the daemon's", () => {
		expect([...ROUTINE_BACKUP_HOURS]).toEqual([...SCHEDULE_HOURS]);
		expect(MAX_ROUTINE_BACKUPS_KEPT).toBe(MAX_KEEP);
		expect(ROUTINE_BACKUP_LABEL).toBe(SCHEDULED_LABEL);
	});

	test("a due schedule runs from the timer, prunes only routine backups, survives code-only uninstall, and a failure retries in 15 minutes", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.routine" });
		const engine = new PaperCraneEngine(dir);
		let now = Date.now();
		const service = new BackupService(engine, undefined, { now: () => now });
		await engine.writeFile("data.txt", "d", "test.routine");
		await expect(service.setSchedule("test.routine", { everyHours: 1, keep: 1 })).rejects.toThrow("Choose where");
		await service.setPanelDestination("test.routine", "local");
		const manual = await service.create("test.routine", "keep me");
		await service.setSchedule("test.routine", { everyHours: 1, keep: 1 });
		const schedulesFile = path.join(dir, "backups", "schedules.json");
		const schedule = () => JSON.parse(fs.readFileSync(schedulesFile, "utf8")).panels["test.routine"];

		service.startScheduler();
		for (let run = 1; run <= 2; run++) {
			now += 61 * 60 * 1000;
			const before = schedule().last?.at;
			await service.runDue();
			await waitFor(`routine run ${run} to be recorded`, () => schedule().last?.at !== before && schedule().last);
			expect(schedule().last.ok).toBe(true);
		}
		const listed = await service.list("test.routine");
		expect(listed.filter((r) => r.label === SCHEDULED_LABEL)).toHaveLength(1);
		expect(listed.map((r) => r.id)).toContain(manual.id);

		await engine.uninstallPanel("test.routine");
		expect(schedule()).toBeTruthy();

		// a failing run is recorded and comes back in 15 minutes
		await installPanelFiles(dir, { id: "test.routine" });
		fs.rmSync(path.join(dir, "files", "test.routine"), { recursive: true });
		now = Date.parse(schedule().nextRunAt) + 1;
		await service.runDue();
		expect(schedule().last.ok).toBe(false);
		expect(Date.parse(schedule().nextRunAt)).toBe(now + BUSY_RETRY_MS);
		service.dispose();
	});

	test("the daemon's own timer runs a due schedule", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.timer" });
		fs.mkdirSync(path.join(dir, "files", "test.timer"), { recursive: true });
		fs.writeFileSync(path.join(dir, "files", "test.timer", "a.txt"), "a");
		fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
		fs.writeFileSync(path.join(dir, "backups", "destinations.json"), JSON.stringify({ version: 1, destinations: [], panels: { "test.timer": "local" } }));
		const due = new Date(Date.now() - 1000).toISOString();
		fs.writeFileSync(path.join(dir, "backups", "schedules.json"), JSON.stringify({ version: 1, panels: { "test.timer": { everyHours: 24, keep: 2, nextRunAt: due, last: null } } }));
		const daemon: InProcessDaemon = await startDaemon({ dataDir: dir });
		await waitFor("the daemon's timer to run the routine backup", () => {
			const last = JSON.parse(fs.readFileSync(path.join(dir, "backups", "schedules.json"), "utf8")).panels["test.timer"].last;
			return last?.ok === true;
		});
		await daemon.stop();
	});
});
