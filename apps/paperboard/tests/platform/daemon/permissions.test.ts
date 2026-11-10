import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { killWorkloads, startCrane, workloadRecords, type CraneProcess } from "../../daemon/support/crane";
import { dataDir, modeOf } from "../../daemon/support/fs";
import { TEST_TIMEOUT_MS, waitFor } from "../../daemon/support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

let crane: CraneProcess | null = null;
afterAll(async () => {
	if (crane) {
		await crane.stop();
		await killWorkloads(crane.dataDir);
	}
});

// Credential and supervisor files are owner-only from creation.
describe("credential and supervisor files are owner-only", () => {
	test("supervisor metadata redacts TOKEN, SECRET and KEY values, and files are 0600 in 0700 folders", async () => {
		const dir = dataDir();
		if (process.platform !== "win32") {
			// an older build left these world-readable
			fs.chmodSync(path.join(dir, "local"), 0o755);
			fs.chmodSync(path.join(dir, "sockets"), 0o755);
		}
		crane = await startCrane({ dataDir: dir });
		const rpc = await crane.rpc();
		await rpc.ok("secrets:set", { panelId: "test.vault", name: "api", value: "s3cret" });
		await rpc.ok("process:run", {
			id: "redact-probe",
			command: process.execPath,
			args: ["-e", "setInterval(() => {}, 1000)"],
			env: { BOT_TOKEN: "tok-value", CLIENT_SECRET: "sec-value", API_KEY: "key-value", PLAIN: "visible" },
		});
		const [record] = await waitFor("the workload's metadata", () => workloadRecords(dir).length === 1 && workloadRecords(dir));
		const meta = fs.readFileSync(record!.file, "utf8");
		const env = JSON.parse(meta).config.env;
		expect(env).toMatchObject({ BOT_TOKEN: "[redacted]", CLIENT_SECRET: "[redacted]", API_KEY: "[redacted]", PLAIN: "visible" });
		expect(meta).not.toContain("tok-value");
		expect(meta).not.toContain("sec-value");
		expect(meta).not.toContain("key-value");

		if (process.platform !== "win32") {
			expect(modeOf(path.join(dir, "local"))).toBe(0o700);
			expect(modeOf(path.join(dir, "sockets"))).toBe(0o700);
			for (const file of ["crane.json", "authorized_tokens.json", "secrets.json"]) {
				expect({ file, mode: modeOf(path.join(dir, "local", file)) }).toEqual({ file, mode: 0o600 });
			}
			expect(modeOf(record!.file)).toBe(0o600);
		}
		await rpc.ok("process:kill", { id: "redact-probe" });
		await rpc.close();
	});
});
