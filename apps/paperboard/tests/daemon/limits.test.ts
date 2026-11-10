import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_ACTION_SCHEMA_BYTES, MAX_ACTIONS_PER_SOCKET, MAX_PENDING_CALLS, MAX_PENDING_CALLS_PER_SOCKET } from "../../papercrane/actions";
import { DriveBackupStore } from "../../papercrane/backups/driveStore";
import { S3BackupStore } from "../../papercrane/backups/s3Store";
import { BACKUP_ARCHIVE_MAX_BYTES, newBackupId } from "../../papercrane/backups/types";
import { CONFIG_MAX_BYTES, FILE_READ_MAX_BYTES } from "../../papercrane/engine";
import { MAX_LIVE_CLIENTS, spawnSupervisedClient } from "../../papercrane/engineSupervisor";
import { fakeDrive, fakeS3 } from "./support/cloud";
import { tempDir } from "./support/fs";
import { type InProcessDaemon, request, startDaemon } from "./support/inproc";
import type { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const UPLOAD_CAP = 4096;
let daemon: InProcessDaemon;
const previousCap = process.env.PAPERCRANE_DAV_MAX_UPLOAD;
beforeAll(async () => {
	// the daemon reads its upload cap per request
	process.env.PAPERCRANE_DAV_MAX_UPLOAD = String(UPLOAD_CAP);
	daemon = await startDaemon();
});
afterAll(async () => {
	await daemon.stop();
	if (previousCap === undefined) delete process.env.PAPERCRANE_DAV_MAX_UPLOAD;
	else process.env.PAPERCRANE_DAV_MAX_UPLOAD = previousCap;
});

const registered = async (rpc: Rpc, panelId: string) =>
	((await rpc.ok("actions:list")).actions as Array<{ panelId: string; action: string }>).filter((a) => a.panelId === panelId).map((a) => a.action);

// The daemon refuses oversize or unbounded input instead of exhausting memory or disk.
describe("resource limits", () => {
	test("an action schema over the cap and actions past the per-socket budget are refused and register nothing", async () => {
		const owner = await daemon.rpc();
		const big = { description: "x".repeat(MAX_ACTION_SCHEMA_BYTES) };
		expect((await owner.fail("actions:register", { panelId: "test.limits", action: "too-big", schema: big })).code).toBe("INVALID_PARAMS");
		await owner.ok("actions:register", { panelId: "test.limits", action: "fits", schema: { description: "x".repeat(MAX_ACTION_SCHEMA_BYTES - 64) } });
		expect(await registered(owner, "test.limits")).toEqual(["fits"]);

		const many = await daemon.rpc();
		const names = Array.from({ length: MAX_ACTIONS_PER_SOCKET }, (_, i) => `a${i}`);
		await many.ok("actions:register", { panelId: "test.many", actions: names });
		expect((await many.fail("actions:register", { panelId: "test.many", action: "one-more" })).code).toBe("INVALID_PARAMS");
		expect((await registered(many, "test.many")).length).toBe(MAX_ACTIONS_PER_SOCKET);
		await many.close();
		await owner.close();
	});

	test("one socket holds at most 1000 outstanding action calls, and closing it frees them", async () => {
		const owner = await daemon.rpc();
		await owner.ok("actions:register", { panelId: "test.slow", action: "hang" });
		const callers: Rpc[] = [];
		const callerCount = MAX_PENDING_CALLS / MAX_PENDING_CALLS_PER_SOCKET;
		const reached = (n: number) => waitFor(`${n} calls to reach the owner`, () => owner.frames.filter((f) => f.type === "action_call").length === n, { timeoutMs: 30_000 });
		const fill = async (c: number) => {
			const caller = await daemon.rpc();
			callers.push(caller);
			for (let i = 0; i < MAX_PENDING_CALLS_PER_SOCKET; i++) {
				caller.send({ id: `c${c}-${i}`, action: "actions:call", params: { panelId: "test.slow", action: "hang", args: [], timeoutMs: 60_000 } });
			}
			await reached((c + 1) * MAX_PENDING_CALLS_PER_SOCKET);
		};
		await fill(0);
		const refused = await callers[0]!.fail("actions:call", { panelId: "test.slow", action: "hang", args: [] });
		expect(refused.code).toBe("FORBIDDEN");
		expect(refused.error).toContain("on this connection");
		for (let c = 1; c < callerCount; c++) await fill(c);

		// every slot in the daemon is now taken; closing one caller frees its thousand
		const fresh = await daemon.rpc();
		expect((await fresh.fail("actions:call", { panelId: "test.slow", action: "hang", args: [] })).error).toContain("global cap");
		await callers[0]!.close();
		const answered = fresh.call("actions:call", { panelId: "test.slow", action: "hang", args: [] });
		const call = await owner.next((f) => f.type === "action_call" && owner.frames.filter((g) => g.type === "action_call").length > MAX_PENDING_CALLS);
		owner.send({ type: "action_reply", callId: call.callId, result: "freed" });
		expect((await answered).result).toEqual({ result: "freed" });
		for (const caller of callers.slice(1)) await caller.close();
		await fresh.close();
		await owner.close();
	});

	test("a file read over its byte cap and a config write over its cap are refused; just under works and nothing is overwritten", async () => {
		const panel = await daemon.panelRpc("test.caps");
		const files = path.join(daemon.dataDir, "files", "test.caps");
		fs.mkdirSync(files, { recursive: true });
		fs.writeFileSync(path.join(files, "big.bin"), Buffer.alloc(FILE_READ_MAX_BYTES + 1, 0x61));
		fs.writeFileSync(path.join(files, "fits.bin"), Buffer.alloc(FILE_READ_MAX_BYTES, 0x61));
		expect((await panel.fail("file:read", { targetPath: "big.bin" })).code).toBe("INVALID_PARAMS");
		expect((await panel.ok("file:read", { targetPath: "fits.bin" }, 60_000)).content.length).toBe(FILE_READ_MAX_BYTES);

		await panel.ok("config:set", { id: "test.caps", data: { kept: true } });
		const configFile = path.join(daemon.dataDir, "configs", "test.caps.json");
		const before = fs.readFileSync(configFile);
		expect((await panel.fail("config:set", { id: "test.caps", data: { blob: "x".repeat(CONFIG_MAX_BYTES) } })).code).toBe("INVALID_PARAMS");
		expect(fs.readFileSync(configFile).equals(before)).toBe(true);
		await panel.ok("config:set", { id: "test.caps", data: { blob: "x".repeat(CONFIG_MAX_BYTES - 64) } });
		await panel.close();
	});

	test("a WebDAV or panel-file upload over the cap gets 413, keeps the old file and leaves no partial file", async () => {
		const files = path.join(daemon.dataDir, "files", "test.uploads");
		fs.mkdirSync(files, { recursive: true });
		const auth = { Authorization: `Bearer ${daemon.token}` };
		for (const [route, name] of [["/dav/files/test.uploads/", "dav.bin"], ["/panel-files/test.uploads/", "panel.bin"]] as const) {
			fs.writeFileSync(path.join(files, name), "old");
			const over = await request(daemon.instance.localPort, { method: "PUT", path: `${route}${name}`, headers: auth, body: Buffer.alloc(UPLOAD_CAP + 1, 1) });
			expect({ route, status: over.status }).toEqual({ route, status: 413 });
			expect(fs.readFileSync(path.join(files, name), "utf8")).toBe("old");
			const fits = await request(daemon.instance.localPort, { method: "PUT", path: `${route}${name}`, headers: auth, body: Buffer.alloc(UPLOAD_CAP, 2) });
			expect({ route, status: fits.status }).toEqual({ route, status: 204 });
			expect(fs.readFileSync(path.join(files, name)).equals(Buffer.alloc(UPLOAD_CAP, 2))).toBe(true);
		}
		expect(fs.readdirSync(files).sort()).toEqual(["dav.bin", "panel.bin"]);
	});

	test("a backup over 5 GiB is refused before any network for S3 and Drive", async () => {
		const s3 = fakeS3("bucket");
		const drive = fakeDrive();
		drive.accounts.set("refresh", "alice");
		try {
			const archive = path.join(tempDir(), "archive.pbbackup");
			fs.writeFileSync(archive, "x");
			const record = { format: 1, id: newBackupId(), panelId: "test.huge", createdAt: new Date().toISOString(), size: BACKUP_ARCHIVE_MAX_BYTES + 1, sha256: "a".repeat(64), panelVersion: "1.0.0", label: null };
			const s3Store = new S3BackupStore({ endpoint: s3.url, region: "us-east-1", bucket: "bucket", prefix: "", accessKeyId: "AKID", pathStyle: true }, { secretAccessKey: "k" });
			await expect(s3Store.put(record as never, archive)).rejects.toThrow();
			expect(s3.requests).toEqual([]);
			const driveStore = new DriveBackupStore("d", { clientId: "c", folderId: "folder" }, { clientSecret: "s", refreshToken: "refresh" }, drive.endpoints);
			await expect(driveStore.put(record as never, archive)).rejects.toThrow();
			expect(drive.requests).toEqual([]);
		} finally {
			await s3.close();
			await drive.close();
		}
	});

	test("starting a workload past the live supervised workload budget is refused before anything spawns", async () => {
		const live = new Map<string, unknown>(Array.from({ length: MAX_LIVE_CLIENTS }, (_, i) => [`w${i}`, { isConnected: () => true }]));
		const socketsDir = path.join(daemon.dataDir, "sockets");
		const before = fs.existsSync(socketsDir) ? fs.readdirSync(socketsDir) : [];
		await expect(spawnSupervisedClient("one-too-many", { command: process.execPath, args: [] }, live as Map<string, any>)).rejects.toThrow(`max ${MAX_LIVE_CLIENTS}`);
		expect(fs.existsSync(socketsDir) ? fs.readdirSync(socketsDir) : []).toEqual(before);
		expect(live.size).toBe(MAX_LIVE_CLIENTS);
	});
});
