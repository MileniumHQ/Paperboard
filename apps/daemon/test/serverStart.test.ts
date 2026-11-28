// A start that fails once the daemon is listening stops what it started and
// rejects, so whoever started it (the app's embedded daemon, the CLI) hears
// why instead of waiting for a start that never ends, and the data folder
// is free for the next start.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { NetworkLinks } from "../src/network/links";
import { dataDir } from "testkit/fs";
import { startDaemon, stopDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const realStart = NetworkLinks.prototype.start;
afterEach(async () => {
	NetworkLinks.prototype.start = realStart;
	await stopDaemon();
});

// Inventory: Core contract — a daemon start that fails after it listens rejects, stops, and frees its folder.
test("a start that fails after the daemon listens rejects, stops what it started, and leaves the folder free", async () => {
	const dir = dataDir();
	// the last step of a start fails: the links can't start
	NetworkLinks.prototype.start = () => {
		throw new Error("the links couldn't start");
	};
	await expect(startDaemon({ dataDir: dir })).rejects.toThrow("the links couldn't start");
	// it stopped: the handshake that told local programs where it listened is gone
	expect(fs.existsSync(path.join(dir, "local", "crane.json"))).toBe(false);
	NetworkLinks.prototype.start = realStart;
	// and the folder is free: the next start on it runs
	const daemon = await startDaemon({ dataDir: dir });
	expect(fs.existsSync(path.join(dir, "local", "crane.json"))).toBe(true);
	expect(daemon.instance.port).toBeGreaterThan(0);
});
