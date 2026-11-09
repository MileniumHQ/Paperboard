import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import pkg from "../package.json";
import { craneTarget, defaultInstallRoot, ensureCrane } from "../src/launcher";
import { makeKey, packRelease, sha256, startRegistry, tempDir, type Registry } from "./helpers/release";

const CLI = path.join(import.meta.dir, "..", "dist", "cli.js");

interface Exit {
    code: number | null;
    stderr: string;
}

// The built launcher under real node, the way npx runs it.
function runCli(env: Record<string, string>, args: string[]): Promise<Exit> {
    if (!fs.existsSync(CLI)) throw new Error(`${CLI} is missing: the crane-launcher test step runs \`bun run build\` first`);
    return new Promise((resolve, reject) => {
        const base = { ...process.env };
        delete base.ORIGAMI_REGISTRY_URL;
        delete base.PAPERBOARD_RELEASE_PUBLIC_KEY;
        const child = spawn("node", [CLI, ...args], { env: { ...base, ...env }, stdio: ["ignore", "pipe", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.stdout.resume();
        child.once("error", (err) => reject(new Error(`could not start node for ${CLI}: ${err.message}`)));
        child.once("close", (code) => resolve({ code, stderr }));
    });
}

let work: string;
let registry: Registry;

beforeEach(async () => {
    work = tempDir("launcher");
    registry = await startRegistry();
});

afterEach(async () => {
    await registry.close();
    fs.rmSync(work, { recursive: true, force: true });
});

async function linuxRelease(version: string): Promise<{ archive: string; digest: string }> {
    const script = path.join(work, "daemon.sh");
    fs.writeFileSync(script, "#!/bin/sh\nexit 0\n");
    const archive = await packRelease("linux-x64", { "papercrane-linux-x64": script }, work);
    registry.setArchive(archive);
    return { archive, digest: sha256(archive) };
}

// Unsigned or tampered releases are refused and nothing is installed.
describe("unsigned or tampered releases are refused and nothing is installed", () => {
    test("the built CLI refuses a release signed by another key, even with a release-key override in its environment", async () => {
        const version = pkg.version;
        const { digest } = await linuxRelease(version);
        const other = makeKey();
        registry.setIndex({ [craneTarget()]: { version, sha256: digest, downloadUrl: registry.archiveUrl, signature: other.sign(version, digest) } });
        const data = path.join(work, "data");
        const env = { ORIGAMI_REGISTRY_URL: registry.url, XDG_DATA_HOME: data, HOME: work, PAPERBOARD_DIR: path.join(work, "pb") };

        const plain = await runCli(env, ["serve"]);
        expect(plain.code).toBe(1);
        expect(plain.stderr).toContain(`The ${version} release for ${craneTarget()} is not signed by the Paperboard release key. Nothing was downloaded.`);

        const overridden = await runCli({ ...env, PAPERBOARD_RELEASE_PUBLIC_KEY: other.publicKey }, ["serve"]);
        expect(overridden.code).toBe(1);
        expect(overridden.stderr).toContain("is not signed by the Paperboard release key");

        expect(registry.requests.filter((r) => r !== "/paperdl/crane/index.json")).toEqual([]);
        expect(fs.existsSync(path.join(data, "papercrane"))).toBe(false);
    });

    test("the built CLI refuses an entry with no signature", async () => {
        const version = pkg.version;
        const { digest } = await linuxRelease(version);
        registry.setIndex({ [craneTarget()]: { version, sha256: digest, downloadUrl: registry.archiveUrl, signature: "" } });
        const data = path.join(work, "data");
        const result = await runCli({ ORIGAMI_REGISTRY_URL: registry.url, XDG_DATA_HOME: data, HOME: work, PAPERBOARD_DIR: path.join(work, "pb") }, ["serve"]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`The ${version} release for ${craneTarget()} is not signed.`);
        expect(fs.existsSync(path.join(data, "papercrane"))).toBe(false);
    });

    test("bytes whose sha256 differs from the signed one are refused and leave the install root empty", async () => {
        const version = "0.4.0";
        const { digest } = await linuxRelease(version);
        const key = makeKey();
        // the signature covers a different archive than the one served
        const signed = digest.replace(/^./, (c) => (c === "0" ? "1" : "0"));
        registry.setIndex({ "linux-x64": { version, sha256: signed, downloadUrl: registry.archiveUrl, signature: key.sign(version, signed) } });
        const installRoot = path.join(work, "install");

        await expect(ensureCrane({ registry: registry.url, target: "linux-x64", installRoot, minVersion: "0.3.0", publicKey: key.publicKey })).rejects.toThrow(
            `does not match its signed checksum (expected ${signed}, got ${digest}). Nothing was installed.`,
        );
        expect(fs.readdirSync(installRoot)).toEqual([]);
    });
});

// Install root survives cache clears.
describe("install root survives cache clears", () => {
    test("the install root is a data folder per platform, never npx's cache", () => {
        expect(defaultInstallRoot({ XDG_DATA_HOME: "/data/xdg" }, "linux", "/home/u")).toBe(path.join("/data/xdg", "papercrane"));
        expect(defaultInstallRoot({}, "linux", "/home/u")).toBe(path.join("/home/u", ".local", "share", "papercrane"));
        expect(defaultInstallRoot({ XDG_DATA_HOME: "/data/xdg" }, "darwin", "/Users/u")).toBe(path.join("/Users/u", "Library", "Application Support", "papercrane"));
        expect(defaultInstallRoot({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u")).toBe(path.join("C:\\Users\\u\\AppData\\Local", "papercrane"));
        expect(() => defaultInstallRoot({}, "win32", "C:\\Users\\u")).toThrow("LOCALAPPDATA is not set");
    });

    test("unsupported platform and arch pairs throw naming them", () => {
        expect(craneTarget("linux", "x64")).toBe("linux-x64");
        expect(craneTarget("linux", "arm64")).toBe("linux-arm64");
        expect(craneTarget("darwin", "arm64")).toBe("macos-arm64");
        expect(craneTarget("win32", "x64")).toBe("windows-x64");
        expect(() => craneTarget("win32", "arm64")).toThrow("has no build for win32 arm64");
        expect(() => craneTarget("freebsd", "x64")).toThrow("has no build for freebsd x64");
        expect(() => craneTarget("linux", "ia32")).toThrow("has no build for linux ia32");
    });
});
