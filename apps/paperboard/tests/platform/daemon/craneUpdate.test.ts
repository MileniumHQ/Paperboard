import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { confirmCraneUpdate, installCraneRelease } from "../../../papercrane/craneUpdate";
import { PAPERCRANE_VERSION } from "../../../papercrane/discovery";
import { tarGz } from "../../daemon/support/archive";
import { childEnv, craneBinary, startCrane } from "../../daemon/support/crane";
import { dataDir, tempDir } from "../../daemon/support/fs";
import { FIXTURE_PUBLIC_KEY, serve, sha256, signCrane } from "../../daemon/support/release";
import { Rpc } from "../../daemon/support/rpc";
import { TEST_TIMEOUT_MS } from "../../daemon/support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const registry = serve();
afterAll(() => registry.close());

const NEWER = "999.0.0";
const BINARY_NAME = `papercrane-${process.platform === "darwin" ? "macos" : "linux"}-${process.arch}`;

// an executable the update replaces: a copy, never the build the tests run
function installedExecutable(content = "#!/bin/sh\necho old\n"): string {
	const file = path.join(tempDir("crane-exe-"), "papercrane");
	fs.writeFileSync(file, content, { mode: 0o755 });
	return file;
}

function publish(name: string, archive: Buffer, version = NEWER) {
	registry.set(`/${name}.tar.gz`, archive);
	const digest = sha256(archive);
	return { downloadUrl: `${registry.url}/${name}.tar.gz`, version, sha256: digest, signature: signCrane(version, digest) };
}

const hitsFor = (name: string) => registry.hits.filter((p) => p === `/${name}.tar.gz`).length;

// Crane self-update is signed, verified and transactional.
describe("crane self-update", () => {
	test("system:update is host-only and refused before any download without https, a sha256, a release-key signature or a newer version", async () => {
		const crane = await startCrane({ dataDir: dataDir(), env: { PAPERBOARD_RELEASE_PUBLIC_KEY: FIXTURE_PUBLIC_KEY } });
		try {
			const good = publish("refusals", tarGz([{ name: BINARY_NAME, content: "#!/bin/sh\n" }]));
			const host = await crane.rpc();
			const token = (await host.ok("auth:panel-token", { panelId: "test.updater" })).token as string;
			const panel = await Rpc.authed(crane.url, token);
			expect((await panel.fail("system:update", good)).code).toBe("FORBIDDEN");
			const refusals: Array<[string, Record<string, unknown>]> = [
				["plain http off loopback", { ...good, downloadUrl: "http://example.invalid/x.tar.gz" }],
				["file URL", { ...good, downloadUrl: "file:///etc/passwd" }],
				["no sha256", { ...good, sha256: undefined }],
				["short sha256", { ...good, sha256: "abc" }],
				["no signature", { ...good, signature: undefined }],
				["another key's signature", { ...good, signature: signCrane(NEWER, good.sha256, "other") }],
				["signature over another version", { ...good, version: "999.0.1" }],
				["not newer", { ...good, version: PAPERCRANE_VERSION, signature: signCrane(PAPERCRANE_VERSION, good.sha256) }],
			];
			for (const [why, params] of refusals) {
				const answer = await host.call("system:update", params);
				expect({ why, refused: Boolean(answer.error) }).toEqual({ why, refused: true });
			}
			expect(hitsFor("refusals")).toBe(0);
			await panel.close();
			await host.close();
		} finally {
			await crane.stop();
		}
	});

	if (process.platform === "win32") {
		test("Windows refuses a signed release and leaves the executable as it was", async () => {
			const exe = installedExecutable("old");
			const release = publish("windows", tarGz([{ name: BINARY_NAME, content: "new" }]));
			await expect(installCraneRelease({ ...release, execPath: exe, releaseKey: FIXTURE_PUBLIC_KEY })).rejects.toThrow("not supported on Windows");
			expect(fs.readFileSync(exe, "utf8")).toBe("old");
			expect(hitsFor("windows")).toBe(0);
		});
	} else {
		test("a signed tarball installs a runnable binary through system:update", async () => {
			const exe = path.join(tempDir("crane-self-"), "papercrane");
			fs.copyFileSync(await craneBinary(), exe);
			fs.chmodSync(exe, 0o755);
			const before = sha256(fs.readFileSync(exe));
			// the replacement is a real crane build: the same compiled binary
			const release = publish("runnable", tarGz([{ name: BINARY_NAME, content: fs.readFileSync(await craneBinary()), mode: 0o644 }]));
			const crane = await startCrane({ dataDir: dataDir(), binary: exe, env: { PAPERBOARD_RELEASE_PUBLIC_KEY: FIXTURE_PUBLIC_KEY } });
			try {
				const host = await crane.rpc();
				const answer = await host.ok("system:update", release, 60_000);
				expect(answer).toMatchObject({ accepted: true, status: "awaiting-restart", restartRequired: true });
				await host.close();
			} finally {
				await crane.stop();
			}
			expect(sha256(fs.readFileSync(exe))).toBe(sha256(fs.readFileSync(await craneBinary())));
			expect(before).toBe(sha256(fs.readFileSync(await craneBinary())));
			expect(fs.statSync(exe).mode & 0o111).not.toBe(0);
			const ran = spawnSync(exe, ["status", "--json", "--data-dir", dataDir()], { env: childEnv(dataDir()), encoding: "utf8", timeout: 30_000 });
			expect({ status: ran.status, error: ran.error }).toEqual({ status: 3, error: undefined });
			// parked recovery bytes stay until the new version is observed
			expect(fs.existsSync(path.join(`${exe}.update`, "previous"))).toBe(true);
		});

		test("a corrupt archive, digest mismatch, missing binary or escaping member leaves the executable byte-identical", async () => {
			const cases: Array<[string, () => ReturnType<typeof publish>]> = [
				["corrupt", () => publish("corrupt", Buffer.from("not a gzip stream at all"))],
				["digest", () => {
					const release = publish("digest", tarGz([{ name: BINARY_NAME, content: "new" }]));
					const other = sha256("other bytes");
					return { ...release, sha256: other, signature: signCrane(NEWER, other) };
				}],
				["missing", () => publish("missing", tarGz([{ name: "papercrane-plan9-mips", content: "new" }]))],
				["empty", () => publish("empty", tarGz([{ name: BINARY_NAME, content: "" }]))],
				["escaping", () => publish("escaping", tarGz([{ name: `../${BINARY_NAME}`, content: "new" }, { name: BINARY_NAME, content: "new" }]))],
			];
			for (const [why, make] of cases) {
				const exe = installedExecutable();
				const before = fs.readFileSync(exe);
				await expect(installCraneRelease({ ...make(), execPath: exe, releaseKey: FIXTURE_PUBLIC_KEY })).rejects.toThrow();
				expect({ why, same: fs.readFileSync(exe).equals(before), leftovers: fs.readdirSync(path.dirname(exe)) }).toEqual({ why, same: true, leftovers: ["papercrane"] });
			}
		});

		test("a failed activation restores the old executable; parked bytes go only once the new version is observed", async () => {
			const exe = installedExecutable("old");
			await expect(
				installCraneRelease({ ...publish("activation", tarGz([{ name: BINARY_NAME, content: "new" }])), execPath: exe, releaseKey: FIXTURE_PUBLIC_KEY }, async () => {
					throw new Error("the new daemon never answered");
				}),
			).rejects.toThrow("never answered");
			expect(fs.readFileSync(exe, "utf8")).toBe("old");
			expect(fs.existsSync(`${exe}.update`)).toBe(false);

			const saved = installedExecutable("old");
			expect((await installCraneRelease({ ...publish("parked", tarGz([{ name: BINARY_NAME, content: "new" }])), execPath: saved, releaseKey: FIXTURE_PUBLIC_KEY })).status).toBe("awaiting-restart");
			expect(fs.readFileSync(saved, "utf8")).toBe("new");
			expect(await confirmCraneUpdate(saved, "1.0.0")).toBe(false);
			expect(fs.readFileSync(path.join(`${saved}.update`, "previous"), "utf8")).toBe("old");
			expect(await confirmCraneUpdate(saved, NEWER)).toBe(true);
			expect(fs.existsSync(`${saved}.update`)).toBe(false);
		});
	}
});
