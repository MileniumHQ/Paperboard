// A daemon stops one way, however the stop begins (server.ts daemonLifecycle):
// a signal that comes while stop() is under way waits for that same stop, so
// the computer list's last writes are saved before the process goes, however
// many signals come.
import { expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { childEnv, spawnChild } from "testkit/crane";
import { dataDir } from "testkit/fs";
import { TEST_TIMEOUT_MS, within } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const SRC = path.join(import.meta.dir, "..", "src");

// Inventory: Data loss — a SIGTERM during a stop must not end the process before the record store is closed.
test("a signal during stop() waits for the stop: the record store is closed before the process exits", async () => {
	const dir = dataDir();
	const marker = path.join(dataDir(), "closed");
	// the record store takes a while to close, as one saving its last changes does
	const code = `
		const fs = require("node:fs");
		const { RecordStore } = require(${JSON.stringify(path.join(SRC, "network", "store.ts"))});
		const { startPaperCraneServer } = require(${JSON.stringify(path.join(SRC, "index.ts"))});
		const close = RecordStore.prototype.close;
		RecordStore.prototype.close = function () {
			return new Promise((r) => setTimeout(r, 400)).then(() => close.call(this)).then(() => fs.writeFileSync(${JSON.stringify(marker)}, "closed"));
		};
		startPaperCraneServer({ port: 0, host: "127.0.0.1", headless: true, staticToken: "pc_stop" }).then((server) => {
			void server.stop();
			process.kill(process.pid, "SIGTERM");
			setTimeout(() => process.kill(process.pid, "SIGTERM"), 50);
		}, (err) => {
			console.error(err);
			process.exit(2);
		});
	`;
	const child = spawnChild(process.execPath, ["-e", code], childEnv(dir));
	const ended = await within("the daemon to exit", child.exited, 20_000);
	// exited as the signal asked, not killed by it, and only once the store was closed
	expect({ ...ended, closed: fs.existsSync(marker) }).toEqual({ code: 0, signal: null, closed: true });
});
