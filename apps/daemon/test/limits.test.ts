import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { DriveBackupStore } from "../src/backups/driveStore";
import { S3BackupStore } from "../src/backups/s3Store";
import { BACKUP_ARCHIVE_MAX_BYTES, newBackupId } from "../src/backups/types";
import { CONFIG_MAX_BYTES, FILE_READ_MAX_BYTES } from "../src/engine/index";
import { fakeDrive, fakeS3 } from "testkit/cloud";
import { tempDir } from "testkit/fs";
import { type InProcessDaemon, request, startDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS } from "testkit/wait";

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

// The daemon refuses oversize or unbounded input instead of exhausting memory or disk.
describe("resource limits", () => {

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
});
