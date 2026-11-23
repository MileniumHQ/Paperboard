import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { installCraneRelease } from "daemon/packages/craneUpdate";
import { PAPERCRANE_VERSION } from "daemon/system/discovery";
import { tarGz } from "testkit/archive";
import { startCrane } from "testkit/crane";
import { dataDir, tempDir } from "testkit/fs";
import { FIXTURE_PUBLIC_KEY, serve, sha256, signCrane } from "testkit/release";
import { Rpc } from "testkit/rpc";
import { TEST_TIMEOUT_MS } from "testkit/wait";

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

	if (process.platform !== "win32") {
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
	}
});
