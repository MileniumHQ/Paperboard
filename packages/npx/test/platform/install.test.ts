import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { craneTarget, ensureCrane, runCrane } from "../../src/launcher";
import { makeKey, packRelease, sha256, startRegistry, tempDir, type Registry, type TestKey } from "../helpers/release";

// A daemon stand-in this platform can really execute, exiting with the code
// it is given: a copy of cmd.exe on Windows, a sh script elsewhere.
function fakeDaemon(dir: string): { file: string; args: (code: number) => string[] } {
    if (process.platform === "win32") {
        const comspec = process.env.ComSpec;
        if (!comspec) throw new Error("ComSpec is not set, so there is no cmd.exe to stand in for the daemon");
        const file = path.join(dir, "daemon.exe");
        fs.copyFileSync(comspec, file);
        return { file, args: (code) => ["/d", "/c", `exit ${code}`] };
    }
    const file = path.join(dir, "daemon.sh");
    fs.writeFileSync(file, '#!/bin/sh\nexit "$1"\n');
    return { file, args: (code) => [String(code)] };
}

let work: string;
let registry: Registry;
let key: TestKey;

beforeEach(async () => {
    work = tempDir("platform");
    registry = await startRegistry();
    key = makeKey();
});

afterEach(async () => {
    await registry.close();
    fs.rmSync(work, { recursive: true, force: true });
});

// A signed release is downloaded, unpacked per version and run.
describe("a signed release is downloaded, unpacked per version and run", () => {
    test("installs this platform's build into <installRoot>/<version>, runs it, and reuses it on the next run", async () => {
        const target = craneTarget();
        const windows = process.platform === "win32";
        const daemon = fakeDaemon(work);
        const files: Record<string, string> = { [windows ? `papercrane-${target}.exe` : `papercrane-${target}`]: daemon.file };
        if (windows) {
            const sidecar = path.join(work, "index.js");
            fs.writeFileSync(sidecar, "module.exports = {};\n");
            files[path.join("node-pty", "lib", "index.js")] = sidecar;
        }
        const archive = await packRelease(target, files, work);
        const version = "0.4.0";
        const digest = sha256(archive);
        registry.setArchive(archive);
        registry.setIndex({ [target]: { version, sha256: digest, downloadUrl: registry.archiveUrl, signature: key.sign(version, digest) } });
        const installRoot = path.join(work, "install");

        const first = await ensureCrane({ registry: registry.url, installRoot, minVersion: "0.3.0", publicKey: key.publicKey });
        const expected = path.join(installRoot, version, windows ? "papercrane.exe" : "papercrane");
        expect(first).toEqual({ binary: expected, version, downloaded: true });
        expect(fs.statSync(expected).isFile()).toBe(true);
        if (windows) {
            expect(fs.readFileSync(path.join(installRoot, version, "node-pty", "lib", "index.js"), "utf8")).toBe("module.exports = {};\n");
        }
        expect(JSON.parse(fs.readFileSync(path.join(installRoot, version, "release.json"), "utf8"))).toEqual({ version, sha256: digest });
        // only the finished version folder is left behind, no staging
        expect(fs.readdirSync(installRoot)).toEqual([version]);
        expect(await runCrane(first.binary, daemon.args(7))).toBe(7);
        expect(await runCrane(first.binary, daemon.args(0))).toBe(0);

        const downloadsBefore = registry.requests.filter((r) => r === "/dl/crane/archive").length;
        expect(downloadsBefore).toBe(1);
        const second = await ensureCrane({ registry: registry.url, installRoot, minVersion: "0.3.0", publicKey: key.publicKey });
        expect(second).toEqual({ binary: expected, version, downloaded: false });
        expect(registry.requests.filter((r) => r === "/dl/crane/archive").length).toBe(1);
    });

    test("a release older than the launcher's minimum is refused before anything is downloaded", async () => {
        const target = craneTarget();
        const daemon = fakeDaemon(work);
        const archive = await packRelease(target, { [target.startsWith("windows") ? `papercrane-${target}.exe` : `papercrane-${target}`]: daemon.file }, work);
        const digest = sha256(archive);
        registry.setArchive(archive);
        registry.setIndex({ [target]: { version: "0.2.9", sha256: digest, downloadUrl: registry.archiveUrl, signature: key.sign("0.2.9", digest) } });
        const installRoot = path.join(work, "install");

        await expect(ensureCrane({ registry: registry.url, installRoot, minVersion: "0.3.0", publicKey: key.publicKey })).rejects.toThrow(
            "The newest published Paperboard server daemon is 0.2.9, but this launcher needs 0.3.0 or newer",
        );
        expect(registry.requests).toEqual(["/paperdl/crane/index.json"]);
        expect(fs.existsSync(installRoot)).toBe(false);
    });
});
