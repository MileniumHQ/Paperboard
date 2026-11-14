import { describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getLogsDir, ensureDir } from "../../papercrane/paths";
import { tempDir } from "./support/fs";
import { startDaemon } from "./support/inproc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

// A folder that could not be made is a failure the caller hears, with why.
describe("ensureDir", () => {
	test("throws the reason when the folder cannot be made, and makes it when it can", () => {
		const root = tempDir();
		const file = path.join(root, "a-file");
		fs.writeFileSync(file, "");
		expect(() => ensureDir(path.join(file, "panel"))).toThrow(/ENOTDIR|EEXIST/);
		const made = path.join(root, "nested", "panel");
		expect(ensureDir(made)).toBe(made);
		expect(fs.statSync(made).isDirectory()).toBe(true);
	});
});

// A failed RPC is in the daemon's log file, where a "button did nothing"
// report is read, not only on a console nobody keeps.
describe("RPC failures", () => {
	test("a frame the daemon could not handle is logged to its log file", async () => {
		const logFile = path.join(getLogsDir(), "paperboard.log");
		const before = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
		const daemon = await startDaemon();
		try {
			const host = await daemon.rpc();
			host.send("{not json");
			expect((await host.closed).code).toBe(1007);
			await waitFor("the RPC failure in the log file", () => {
				const text = fs.readFileSync(logFile, "utf8").slice(before);
				return text.includes("[Paperboard Server:RPC] a frame failed");
			});
		} finally {
			await daemon.stop();
		}
	});
});
