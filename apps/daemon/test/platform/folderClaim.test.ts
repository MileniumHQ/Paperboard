// One daemon per data folder, held by the operating system (core/folderClaim.ts):
// on Linux two abstract sockets and on Windows two named pipes, one named by
// the folder's device and inode and one by its path, and a flock on the
// folder on macOS. A second daemon stops before it reads or writes anything
// in the folder; many started at once never hold it two at a time, a new
// folder's first starts included; a claim makes nothing but the folder; a
// holder that is killed leaves nothing behind; a folder by another spelling,
// or moved, is the same folder, and a copy is another; a daemon whose data
// path stops leading to its folder (moved, deleted and made again, a link
// pointed elsewhere) stops loudly and writes nothing at the path; and in one
// process a claim being released is waited for. Electron's Node and Bun
// naming one claim alike is folderClaimRuntimes.test.ts.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkDataWrite, claimDataFolder, DataFolderMovedError, FolderClaimedError, mountTypeOf } from "../../src/core/folderClaim";
import { startCrane, type CraneProcess } from "testkit/crane";
import { dataDir, restoreEnv } from "testkit/fs";
import { startDaemon, stopDaemon } from "testkit/inproc";
import { startPaperCraneServer } from "../../src/index";
import { TEST_TIMEOUT_MS, waitFor, within } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS * 4);

const cranes: CraneProcess[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
	await stopDaemon();
	for (const crane of cranes.splice(0)) await crane.stop();
	for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
});

/** runs `body` with PAPERBOARD_DIR at `dir`, as a daemon started there would */
async function inFolder<T>(dir: string, body: () => Promise<T>): Promise<T> {
	const previous = process.env.PAPERBOARD_DIR;
	process.env.PAPERBOARD_DIR = dir;
	try {
		return await body();
	} finally {
		restoreEnv("PAPERBOARD_DIR", previous);
	}
}

/** everything under a folder: each folder by its name, each file with its bytes */
const filesUnder = (dir: string) =>
	fs
		.readdirSync(dir, { recursive: true })
		.map(String)
		.sort()
		.map((f) => (fs.statSync(path.join(dir, f)).isFile() ? ([f, fs.readFileSync(path.join(dir, f), "utf8")] as const) : ([f, "folder"] as const)));

const CLAIM_MODULE = path.join(import.meta.dir, "..", "..", "src", "core", "folderClaim.ts");

/**
 * A process that claims `dir`: it notes "held" in `log` once it holds it,
 * "free" just before it lets go `holdMs` later, and exits 0; or exits 3 when
 * the folder was claimed. With no `holdMs` it holds until it is killed.
 */
function claimer(dir: string, log: string, holdMs?: number): ChildProcess {
	const code = `
		const fs = require("node:fs");
		const { claimDataFolder, FolderClaimedError } = require(${JSON.stringify(CLAIM_MODULE)});
		claimDataFolder().then(async (claim) => {
			fs.appendFileSync(${JSON.stringify(log)}, "held " + process.pid + "\\n");
			${holdMs === undefined ? "setInterval(() => {}, 1000); return;" : `await new Promise((r) => setTimeout(r, ${holdMs}));`}
			fs.appendFileSync(${JSON.stringify(log)}, "free " + process.pid + "\\n");
			await claim.releaseAfter(Promise.resolve());
			process.exit(0);
		}, (err) => {
			if (err instanceof FolderClaimedError) process.exit(3);
			console.error(err);
			process.exit(1);
		});
	`;
	const child = spawn(process.execPath, ["-e", code], { env: { ...process.env, PAPERBOARD_DIR: dir }, stdio: ["ignore", "ignore", "inherit"] });
	children.push(child);
	return child;
}

const exited = (child: ChildProcess) => new Promise<number | null>((resolve) => (child.exitCode !== null ? resolve(child.exitCode) : child.once("exit", (code) => resolve(code))));

describe("one daemon per data folder", () => {
	// Inventory: Data loss — two daemons on one folder would write one record store apart: of many started at once, never two hold it.
	test("of many processes that claim one folder at once, round after round, never two hold it, and one always does", async () => {
		// a folder none of them finds: the first round makes it, all at once
		const dir = path.join(dataDir(), "made-by-the-claimers");
		const log = path.join(dataDir(), "claims.log");
		for (let round = 0; round < 12; round++) {
			fs.writeFileSync(log, "");
			const codes = await Promise.all(Array.from({ length: 6 }, () => claimer(dir, log, 40)).map(exited));
			expect(codes.every((code) => code === 0 || code === 3)).toBe(true);
			const lines = fs.readFileSync(log, "utf8").trim().split("\n");
			// held and free alternate, each by one process: nobody held while another did
			for (let at = 0; at < lines.length; at += 2) {
				const [held, free] = [lines[at]!.split(" "), lines[at + 1]?.split(" ")];
				expect(held[0]).toBe("held");
				expect(free).toEqual(["free", held[1]!]);
			}
			expect(codes.filter((code) => code === 0).length).toBe(lines.length / 2);
			expect(lines.length).toBeGreaterThan(0);
		}
	});

	// Inventory: Data loss — a daemon that is killed leaves no claim behind: the next one starts, with no file to clear.
	test("a holder killed outright leaves the folder free at once; while it lives, every other process is refused", async () => {
		const dir = dataDir();
		const log = path.join(dataDir(), "claims.log");
		fs.writeFileSync(log, "");
		const holder = claimer(dir, log);
		await waitFor("the holder to hold the folder", () => fs.readFileSync(log, "utf8").includes("held"));
		expect(await exited(claimer(dir, log, 0))).toBe(3);
		await inFolder(dir, async () => {
			await expect(claimDataFolder()).rejects.toBeInstanceOf(FolderClaimedError);
		});
		holder.kill("SIGKILL");
		await exited(holder);
		await inFolder(dir, async () => {
			const claim = await claimDataFolder();
			await claim.releaseAfter(Promise.resolve());
		});
	});

	// Inventory: Data loss — a claim keeps nothing on disk to lose, copy or clear: it makes the folder alone.
	test("a claim of a new folder makes the folder and nothing in it", async () => {
		const dir = path.join(dataDir(), "new-folder");
		await inFolder(dir, async () => {
			const claim = await claimDataFolder();
			expect(fs.statSync(dir).isDirectory()).toBe(true);
			expect(filesUnder(dir)).toEqual([]);
			await claim.releaseAfter(Promise.resolve());
		});
	});

	// Inventory: Data loss — a claim held by something else stops the daemon, and the error says what holds it.
	test("the error names what holds the claim", async () => {
		const dir = dataDir();
		const log = path.join(dataDir(), "claims.log");
		fs.writeFileSync(log, "");
		const holder = claimer(dir, log);
		await waitFor("the holder to hold the folder", () => fs.readFileSync(log, "utf8").includes("held"));
		const held = { darwin: "a lock on the folder", win32: "the named pipe \\\\.\\pipe\\paperboard-daemon-", linux: "the abstract socket @paperboard-daemon-" }[process.platform as "darwin" | "win32" | "linux"];
		await inFolder(dir, async () => {
			await expect(claimDataFolder()).rejects.toThrow(`another program on this computer holds the folder's claim (${held}`);
		});
		holder.kill("SIGKILL");
		await exited(holder);
	});

	// Inventory: Data loss — the claim is the folder's, not its path's: moved, it is still held; a copy is another folder.
	test("a folder moved while it is held is still held, and a copy of it is another folder with a claim of its own", async () => {
		const parent = dataDir();
		const dir = path.join(parent, "data");
		fs.mkdirSync(path.join(dir, "local"), { recursive: true });
		fs.writeFileSync(path.join(dir, "local", "note.json"), "{}");
		const log = path.join(dataDir(), "claims.log");
		fs.writeFileSync(log, "");
		const holder = claimer(dir, log);
		await waitFor("the holder to hold the folder", () => fs.readFileSync(log, "utf8").includes("held"));
		const moved = path.join(parent, "moved");
		fs.renameSync(dir, moved);
		expect(await exited(claimer(moved, log, 0))).toBe(3);
		// the copy has its own identity: a daemon can run on it beside the holder
		const copy = path.join(parent, "copy");
		fs.cpSync(moved, copy, { recursive: true });
		expect(await exited(claimer(copy, log, 0))).toBe(0);
		holder.kill("SIGKILL");
		await exited(holder);
	});

	// Inventory: Data loss — a folder on a network share is found by the mount it is on, past mounts beneath and names with spaces.
	test("the mount a folder is on is the deepest that holds it, read as mountinfo writes it", () => {
		const mountinfo = [
			"22 1 0:21 / / rw,relatime shared:1 - btrfs /dev/nvme0n1p2 rw",
			"40 22 0:35 / /home rw,relatime shared:2 - btrfs /dev/nvme0n1p2 rw",
			"51 40 0:47 / /home/me/My\\040Share rw,nosuid shared:3 - fuse.sshfs me@nas:/srv rw,user_id=1000",
			"52 40 0:48 / /home/me/nfs rw,relatime shared:4 - nfs4 nas:/export rw",
		].join("\n");
		expect(mountTypeOf(mountinfo, "/home/me/My Share/.paperboard")).toBe("fuse.sshfs");
		expect(mountTypeOf(mountinfo, "/home/me/nfs")).toBe("nfs4");
		expect(mountTypeOf(mountinfo, "/home/me/nfsish/.paperboard")).toBe("btrfs");
		expect(mountTypeOf(mountinfo, "/etc")).toBe("btrfs");
	});

	// Inventory: Data loss — one folder by another casing is one claim, where the disk ignores case.
	test("a folder spelled in another case is the same folder, where the disk ignores case", async () => {
		const parent = dataDir();
		const dir = path.join(parent, "CaseFolder");
		fs.mkdirSync(dir);
		const other = path.join(parent, "casefolder");
		// a disk that keeps case apart has no other spelling of the folder to try
		if (!fs.existsSync(other)) return;
		const log = path.join(dataDir(), "claims.log");
		fs.writeFileSync(log, "");
		const holder = claimer(dir, log);
		await waitFor("the holder to hold the folder", () => fs.readFileSync(log, "utf8").includes("held"));
		expect(await exited(claimer(other, log, 0))).toBe(3);
		holder.kill("SIGKILL");
		await exited(holder);
	});

	// Inventory: Data loss — one folder by two spellings is one claim.
	test("a folder reached through a link is the same folder", async () => {
		const dir = dataDir();
		const link = path.join(dataDir(), "linked");
		fs.symlinkSync(dir, link, process.platform === "win32" ? "junction" : "dir");
		const log = path.join(dataDir(), "claims.log");
		fs.writeFileSync(log, "");
		const holder = claimer(dir, log);
		await waitFor("the holder to hold the folder", () => fs.readFileSync(log, "utf8").includes("held"));
		expect(await exited(claimer(link, log, 0))).toBe(3);
		holder.kill("SIGKILL");
		await exited(holder);
	});

	// Inventory: Data loss — in one process, a claim being let go is waited for, and one held is refused.
	test("in one process a claim being released is waited for, one held is refused, and a folder deeper than a socket path may be long is claimed", async () => {
		const dir = path.join(dataDir(), "a-folder-name-long-enough-to-matter".repeat(3));
		fs.mkdirSync(dir, { recursive: true });
		await inFolder(dir, async () => {
			const first = await claimDataFolder();
			await expect(claimDataFolder()).rejects.toBeInstanceOf(FolderClaimedError);
			let saved = false;
			let save!: () => void;
			const lastWrites = new Promise<void>((resolve) => (save = resolve));
			const released = first.releaseAfter(lastWrites.then(() => void (saved = true)));
			const next = claimDataFolder();
			setTimeout(save, 50);
			const second = await next;
			// it was waited for: the last writes were saved before the next claim held the folder
			expect(saved).toBe(true);
			await released;
			await second.releaseAfter(Promise.reject(new Error("a failed save ends the claim all the same")));
			const third = await claimDataFolder();
			await third.releaseAfter(Promise.resolve());
		});
	});

	// Inventory: Data loss — the app's embedded daemon stopped and started again at once never overlaps the last one's writes.
	test("an embedded daemon stopped and started again in one process waits for the last one to let the folder go", async () => {
		const dir = dataDir();
		await inFolder(dir, async () => {
			const options = { port: 0, host: "127.0.0.1", headless: true, staticToken: "pc_embedded" };
			const first = await startPaperCraneServer(options);
			let firstEnded = false;
			const stopping = first.stop().then(() => void (firstEnded = true));
			const second = await startPaperCraneServer(options);
			// the second holds the folder only once the first has closed its data
			expect(firstEnded).toBe(true);
			await stopping;
			await second.stop();
		});
	});

	// Inventory: Data loss — a daemon that starts while another starts on the same folder writes nothing there.
	test("a daemon started on a folder another daemon holds stops before it writes anything", async () => {
		const dir = dataDir();
		const crane = await startCrane({ dataDir: dir });
		cranes.push(crane);
		// as if the first hadn't written its handshake yet: nothing tells the second it is running but the claim
		fs.rmSync(path.join(dir, "local", "crane.json"));
		// all of the folder but the running daemon's own log, which it may write meanwhile
		const ownFiles = () => filesUnder(dir).filter(([f]) => f !== "logs" && !f.startsWith(`logs${path.sep}`));
		const before = ownFiles();
		await expect(startDaemon({ dataDir: dir })).rejects.toBeInstanceOf(FolderClaimedError);
		expect(ownFiles()).toEqual(before);
	});

	// Inventory: Data loss — a daemon doesn't follow its folder: once the path leads elsewhere, the next write is refused and it stops.
	test("in one process, once the data path stops leading to the claimed folder, every write there is refused and the claim's listeners hear it once", async () => {
		const parent = dataDir();
		const dir = path.join(parent, "data");
		await inFolder(dir, async () => {
			const claim = await claimDataFolder();
			const heard: DataFolderMovedError[] = [];
			claim.onLost((err) => heard.push(err));
			const file = path.join(dir, "local", "state.json");
			checkDataWrite(file);
			// a file outside the folder is no claim's to check
			checkDataWrite(path.join(parent, "elsewhere.json"));
			fs.renameSync(dir, path.join(parent, "moved"));
			fs.mkdirSync(dir);
			expect(() => checkDataWrite(file)).toThrow(DataFolderMovedError);
			// latched: the folder put back doesn't make the path the claim's again
			fs.rmdirSync(dir);
			fs.renameSync(path.join(parent, "moved"), dir);
			expect(() => checkDataWrite(file)).toThrow(`The data folder ${dir} was moved, deleted or replaced while Paperboard was running`);
			await waitFor("the listener to hear it", () => heard.length > 0);
			expect(heard.length).toBe(1);
			await claim.releaseAfter(Promise.resolve());
			// let go: the path is nobody's to check, and claimed again it is this folder's
			checkDataWrite(file);
			const again = await claimDataFolder();
			checkDataWrite(file);
			await again.releaseAfter(Promise.resolve());
		});
	});

	/**
	 * The reviewer's case: daemon A runs on `path`, the path is made to lead
	 * to another folder (`replace`), daemon B starts on the path, and A is
	 * asked to write. On Linux and Windows B is refused (the path's name is
	 * A's); on macOS the lock is on A's folder alone, so B runs. Either way A
	 * writes nothing there and stops with a failure, saying why, and nothing
	 * of A's is in the folder at the path.
	 */
	async function replacedWhileRunning(replace: (dataPath: string) => void, dataPath: string): Promise<void> {
		const a = await startCrane({ dataDir: dataPath });
		cranes.push(a);
		const rpc = await a.rpc();
		const self: string = (await rpc.ok("computers:list")).self;
		await rpc.ok("computers:update", { id: self, name: "Before the move" });
		replace(dataPath);
		let b: Awaited<ReturnType<typeof startDaemon>> | null = null;
		let refused: unknown = null;
		try {
			b = await startDaemon({ dataDir: dataPath });
		} catch (err) {
			refused = err;
		}
		if (process.platform === "darwin") {
			if (!b) throw new Error(`macOS: daemon B on ${dataPath} should start beside A (the lock is on A's folder alone), but: ${String(refused)}`);
		} else {
			expect(refused).toBeInstanceOf(FolderClaimedError);
			// the path's name, or the folder's when the new folder got the inode the old one had
			expect(String(refused)).toMatch(/was moved, deleted or replaced while it ran|already starting or running with the data folder/);
		}
		const wrote = await rpc.ok("computers:update", { id: self, name: "After the move" }).then(
			() => true,
			() => false, // quiet: refused, or the connection closed as A stopped: both mean A didn't write it
		);
		expect(wrote).toBe(false);
		const ended = await within("daemon A to stop after its folder moved", a.exited, 20_000);
		expect(ended.code).toBe(1);
		expect(a.output()).toContain(`The data folder ${dataPath} was moved, deleted or replaced while Paperboard was running`);
		if (b) await stopDaemon();
		// nothing of A's at the path: no record it signed, no log line, no state file
		for (const [file, bytes] of filesUnder(fs.realpathSync(dataPath))) {
			if (bytes === "folder") continue;
			if (bytes.includes(self) || bytes.includes("After the move")) throw new Error(`${process.platform}: ${file} in the folder now at ${dataPath} holds daemon A's ${self}`);
		}
	}

	// Inventory: Data loss — a folder moved away while its daemon runs: a second daemon on the path never shares a store with the first.
	test("a data folder moved away while its daemon runs: a second daemon on the path never gets the first one's writes, and the first stops loudly", async () => {
		const dataPath = path.join(dataDir(), "data");
		await replacedWhileRunning((p) => fs.renameSync(p, `${p}.moved`), dataPath);
	});

	// Inventory: Data loss — a data folder deleted and made again while its daemon runs: the new folder never gets the old daemon's writes.
	test("a data folder deleted and made again while its daemon runs: the new folder never gets the old daemon's writes, and it stops loudly", async () => {
		const dataPath = path.join(dataDir(), "data");
		await replacedWhileRunning((p) => {
			fs.rmSync(p, { recursive: true, force: true });
			fs.mkdirSync(p);
		}, dataPath);
	});

	// Inventory: Data loss — a link to the data folder pointed elsewhere while the daemon runs: the folder it now leads to never gets its writes.
	test("a link the data path goes through, pointed at another folder while the daemon runs: that folder never gets its writes, and it stops loudly", async () => {
		const parent = dataDir();
		const first = path.join(parent, "first");
		const second = path.join(parent, "second");
		fs.mkdirSync(first);
		fs.mkdirSync(second);
		const link = path.join(parent, "data");
		const kind = process.platform === "win32" ? "junction" : "dir";
		fs.symlinkSync(first, link, kind);
		await replacedWhileRunning((p) => {
			fs.unlinkSync(p);
			fs.symlinkSync(second, p, kind);
		}, link);
	});
});
