import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as tar from "tar";
import { installCraneRelease, confirmCraneUpdate, restoreCraneUpdate, type CraneRelease } from "../papercrane/craneUpdate";
import { fixtureSign, FIXTURE_RELEASE_PUBLIC_KEY, startFixtureRegistry, type FixtureRegistry } from "./registryFixture";
import { releaseMessage } from "../papercrane/releaseSignature";

const run = promisify(execFile);
const target = `${process.platform === "darwin" ? "macos" : "linux"}-${process.arch}`;
const binaryName = `papercrane-${target}`;
const executable = `#!${process.execPath}\nconsole.log('new crane behaviour');\n`;
const original = Buffer.from("original daemon bytes");
let root: string;
let execPath: string;
let registry: FixtureRegistry;
beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "crane-update-"));
    execPath = path.join(root, "papercrane");
    fs.writeFileSync(execPath, original, { mode: 0o755 });
    registry = await startFixtureRegistry(root);
});
afterEach(async () => {
    await registry.stop();
    fs.rmSync(root, { recursive: true, force: true });
});
async function release(files = { [binaryName]: executable }): Promise<CraneRelease> {
    const fixture = await registry.publishCrane("99.0.0", files);
    return { ...fixture.record, execPath, releaseKey: FIXTURE_RELEASE_PUBLIC_KEY } as CraneRelease;
}
function serveBytes(candidate: CraneRelease, bytes: Uint8Array, signDigest = true): CraneRelease {
    registry.assets.set(new URL(candidate.downloadUrl).pathname, bytes);
    const sha256 = signDigest ? new Bun.CryptoHasher("sha256").update(bytes).digest("hex") : candidate.sha256;
    return { ...candidate, sha256, signature: fixtureSign(releaseMessage.crane(candidate.version, sha256)) };
}

test("a signed published crane tarball installs executable bytes and retains no parked copy after observed activation", async () => {
    const candidate = await release();
    const outcome = await installCraneRelease(candidate, async () => {
        expect(fs.readFileSync(execPath, "utf8")).toBe(executable);
        expect((await run(execPath, [], { timeout: 5000, maxBuffer: 1024 })).stdout.trim()).toBe("new crane behaviour");
    });
    expect(outcome.status).toBe("activated");
    expect(fs.statSync(execPath).mode & 0o111).toBeTruthy();
    expect(fs.existsSync(`${execPath}.update`)).toBe(false);
});

test("corrupt signed archive and mismatched archive digest leave the original executable byte-identical", async () => {
    const candidate = await release();
    await expect(installCraneRelease(serveBytes(candidate, Buffer.from("not a tar archive")))).rejects.toThrow();
    expect(fs.readFileSync(execPath).toString("hex")).toBe(original.toString("hex"));
    await expect(installCraneRelease(serveBytes(candidate, Buffer.from("mismatched bytes"), false))).rejects.toThrow(/SHA256/);
    expect(fs.readFileSync(execPath).toString("hex")).toBe(original.toString("hex"));
    expect(fs.existsSync(`${execPath}.update`)).toBe(false);
});

test("a signed archive missing the expected binary or containing an escape member cannot replace the executable", async () => {
    await expect(installCraneRelease(await release({ "wrong-name": executable }))).rejects.toThrow(/expected crane binary/i);
    expect(fs.readFileSync(execPath).toString("hex")).toBe(original.toString("hex"));
    const candidate = await release();
    const archive = path.join(root, "escape.tar.gz");
    // A real tar writer emits an absolute member; the shared archive scan
    // must refuse it before the executable is replaced.
    await tar.c({ file: archive, gzip: true, cwd: root, preservePaths: true }, [execPath]);
    await expect(installCraneRelease(serveBytes(candidate, fs.readFileSync(archive)))).rejects.toThrow(/escapes destination/);
    expect(fs.readFileSync(execPath).toString("hex")).toBe(original.toString("hex"));
});

test("activation failure restores the old executable in place and removes staging", async () => {
    await expect(installCraneRelease(await release(), async () => { throw new Error("replacement did not become ready"); })).rejects.toThrow(/did not become ready/);
    expect(fs.readFileSync(execPath).toString("hex")).toBe(original.toString("hex"));
    expect(fs.existsSync(`${execPath}.update`)).toBe(false);
});

// These cover the explicit pending state added for the restart supervisor.
test("a saved replacement stays pending until the new version is observed, and a retry cannot overwrite recovery bytes", async () => {
    const candidate = await release();
    expect((await installCraneRelease(candidate)).status).toBe("awaiting-restart");
    const parked = path.join(`${execPath}.update`, "previous");
    expect(fs.readFileSync(parked).toString("hex")).toBe(original.toString("hex"));
    expect(await confirmCraneUpdate(execPath, "0.1.0")).toBe(false);
    expect(fs.existsSync(parked)).toBe(true);
    await expect(installCraneRelease(candidate)).rejects.toMatchObject({ code: "EEXIST" });
    expect(fs.readFileSync(parked).toString("hex")).toBe(original.toString("hex"));
    expect((await run(execPath, [], { timeout: 5000, maxBuffer: 1024 })).stdout.trim()).toBe("new crane behaviour");
    expect(await confirmCraneUpdate(execPath, candidate.version)).toBe(true);
    expect(fs.existsSync(`${execPath}.update`)).toBe(false);
});

test("an interrupted handoff can restore parked bytes even when the replacement path is gone", async () => {
    await installCraneRelease(await release());
    fs.unlinkSync(execPath);
    await restoreCraneUpdate(execPath);
    expect(fs.readFileSync(execPath).toString("hex")).toBe(original.toString("hex"));
    expect(fs.existsSync(`${execPath}.update`)).toBe(false);
});
