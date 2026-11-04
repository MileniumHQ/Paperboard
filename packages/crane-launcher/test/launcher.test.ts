// The npx launcher against a real HTTP registry on loopback. Releases here
// are signed with a test key, so the library is pointed at it; the built CLI
// (node dist/cli.js) always uses the Paperboard release key and must refuse
// them before downloading anything.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { RELEASE_PUBLIC_KEY, releaseMessage, verifyRelease } from "../../../apps/paperboard/papercrane/releaseSignature";
import { craneTarget, defaultInstallRoot, ensureCrane, runCrane } from "../src/launcher";
import pkg from "../package.json";

const CLI = path.resolve(import.meta.dir, "../dist/cli.js");
const key = crypto.generateKeyPairSync("ed25519");
const testPublicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
const sign = (version: string, sha256: string) => crypto.sign(null, releaseMessage.crane(version, sha256), key.privateKey).toString("base64");
const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

let work: string;
let server: ReturnType<typeof Bun.serve>;
let index: Record<string, unknown> = {};
const files = new Map<string, Buffer>();
const requests: string[] = [];

beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "crane-launcher-"));
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
            const { pathname } = new URL(req.url);
            requests.push(pathname);
            if (pathname === "/paperdl/crane/index.json") return Response.json(index);
            const body = files.get(pathname);
            return body ? new Response(body) : new Response("not found", { status: 404 });
        },
    });
});

afterAll(() => {
    server.stop(true);
    fs.rmSync(work, { recursive: true, force: true });
});

const registry = () => `http://127.0.0.1:${server.port}`;

// a stand-in daemon: records its arguments, exits 7
async function fakeRelease(target: string, version: string, name: string): Promise<{ bytes: Buffer; url: string }> {
    const dir = fs.mkdtempSync(path.join(work, "build-"));
    const shipped = `papercrane-${target}`;
    fs.writeFileSync(path.join(dir, shipped), `#!/bin/sh\nprintf '%s\\n' "$@" > "$CRANE_ARGS_FILE"\nexit 7\n`, { mode: 0o755 });
    const archive = path.join(dir, "release.tar.gz");
    await tar.c({ gzip: true, file: archive, cwd: dir }, [shipped]);
    const bytes = fs.readFileSync(archive);
    files.set(`/${name}`, bytes);
    return { bytes, url: `${registry()}/${name}` };
}

function freshRoot(): string {
    return fs.mkdtempSync(path.join(work, "root-"));
}

describe("ensureCrane", () => {
    test("downloads a signed release, unpacks it per version and runs it with the arguments", async () => {
        const { bytes, url } = await fakeRelease("linux-x64", "9.0.0", "crane-9.tar.gz");
        index = { "linux-x64": { version: "9.0.0", sha256: sha256(bytes), downloadUrl: url, signature: sign("9.0.0", sha256(bytes)) } };
        const root = freshRoot();
        const crane = await ensureCrane({ registry: registry(), target: "linux-x64", installRoot: root, minVersion: "0.3.0", publicKey: testPublicKey });
        expect(crane).toEqual({ binary: path.join(root, "9.0.0", "papercrane"), version: "9.0.0", downloaded: true });
        expect(fs.readdirSync(root)).toEqual(["9.0.0"]);

        const argsFile = path.join(work, "args.txt");
        process.env.CRANE_ARGS_FILE = argsFile;
        try {
            expect(await runCrane(crane.binary, ["serve", "--port", "45465"])).toBe(7);
        } finally {
            delete process.env.CRANE_ARGS_FILE;
        }
        expect(fs.readFileSync(argsFile, "utf8")).toBe("serve\n--port\n45465\n");

        requests.length = 0;
        const again = await ensureCrane({ registry: registry(), target: "linux-x64", installRoot: root, minVersion: "0.3.0", publicKey: testPublicKey });
        expect(again.downloaded).toBe(false);
        expect(requests).toEqual(["/paperdl/crane/index.json"]);
    });

    test("bytes that do not match the signed sha256 are refused and nothing is left behind", async () => {
        const { bytes, url } = await fakeRelease("linux-x64", "9.1.0", "crane-91.tar.gz");
        const claimed = sha256(Buffer.concat([bytes, Buffer.from("x")]));
        index = { "linux-x64": { version: "9.1.0", sha256: claimed, downloadUrl: url, signature: sign("9.1.0", claimed) } };
        const root = freshRoot();
        await expect(ensureCrane({ registry: registry(), target: "linux-x64", installRoot: root, minVersion: "0.3.0", publicKey: testPublicKey }))
            .rejects.toThrow("does not match its signed checksum");
        expect(fs.readdirSync(root)).toEqual([]);
    });

    test("a release older than the launcher is refused before downloading", async () => {
        const { bytes, url } = await fakeRelease("linux-x64", "0.2.9", "crane-029.tar.gz");
        index = { "linux-x64": { version: "0.2.9", sha256: sha256(bytes), downloadUrl: url, signature: sign("0.2.9", sha256(bytes)) } };
        requests.length = 0;
        await expect(ensureCrane({ registry: registry(), target: "linux-x64", installRoot: freshRoot(), minVersion: "0.3.0", publicKey: testPublicKey }))
            .rejects.toThrow("needs 0.3.0 or newer");
        expect(requests).toEqual(["/paperdl/crane/index.json"]);
    });

    test("the Windows zip keeps its node-pty sidecar beside the binary", async () => {
        const zip = new AdmZip();
        zip.addFile("papercrane-windows-x64.exe", Buffer.from("MZ fake"));
        zip.addFile("node-pty/lib/index.js", Buffer.from("module.exports = {};"));
        const bytes = zip.toBuffer();
        files.set("/crane-win.zip", bytes);
        index = { "windows-x64": { version: "9.2.0", sha256: sha256(bytes), downloadUrl: `${registry()}/crane-win.zip`, signature: sign("9.2.0", sha256(bytes)) } };
        const root = freshRoot();
        const crane = await ensureCrane({ registry: registry(), target: "windows-x64", installRoot: root, minVersion: "0.3.0", publicKey: testPublicKey });
        expect(crane.binary).toBe(path.join(root, "9.2.0", "papercrane.exe"));
        expect(fs.existsSync(path.join(root, "9.2.0", "node-pty", "lib", "index.js"))).toBe(true);
    });

    test("an unsupported platform is named", () => {
        expect(() => craneTarget("freebsd", "x64")).toThrow("no build for freebsd x64");
        expect(() => craneTarget("win32", "arm64")).toThrow("no build for win32 arm64");
        expect(craneTarget("darwin", "arm64")).toBe("macos-arm64");
    });

    test("installs outside npx's cache, in the platform's data folder", () => {
        expect(defaultInstallRoot({ XDG_DATA_HOME: "/x/share" }, "linux", "/home/u")).toBe("/x/share/papercrane");
        expect(defaultInstallRoot({}, "linux", "/home/u")).toBe("/home/u/.local/share/papercrane");
        expect(defaultInstallRoot({}, "darwin", "/Users/u")).toBe("/Users/u/Library/Application Support/papercrane");
    });
});

describe("the published key", () => {
    // the real linux-x64 0.2.2 entry from origami's crane/index.json: the
    // bundled key and message format must verify what Paperboard published
    test("verifies a real Paperboard release", () => {
        const signed = verifyRelease(
            releaseMessage.crane("0.2.2", "5de038dfabc4740de2e92fae21f1b662506720e0dbc09a96ebdcbae21223eedd"),
            "ujNAlK+aXfcIRV5i6+iHvbBaZicLHuDZdqh36oR+KWK0ePBHthn4YE+TZ6OYxdEWGP8qz2Qrv1w3+Vg3nr+OAw==",
            RELEASE_PUBLIC_KEY,
        );
        expect(signed).toBe(true);
    });
});

describe("node dist/cli.js", () => {
    // async: the registry answers from this same process
    async function launcher(env: Record<string, string>): Promise<{ code: number; err: string; installed: string[] }> {
        const home = fs.mkdtempSync(path.join(work, "home-"));
        const child = Bun.spawn(["node", CLI, "status"], {
            env: { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, "share"), LOCALAPPDATA: path.join(home, "local"), ...env },
            stdout: "ignore", stderr: "pipe",
        });
        const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        const share = path.join(home, "share", "papercrane");
        return { code, err, installed: fs.existsSync(share) ? fs.readdirSync(share) : [] };
    }

    test("refuses a release the Paperboard key did not sign, before downloading it", async () => {
        const target = craneTarget();
        const { bytes, url } = await fakeRelease(target, pkg.version, "crane-unsigned.tar.gz");
        index = { [target]: { version: pkg.version, sha256: sha256(bytes), downloadUrl: url, signature: sign(pkg.version, sha256(bytes)) } };
        requests.length = 0;
        const { code, err, installed } = await launcher({ ORIGAMI_REGISTRY_URL: registry() });
        expect(err).toContain("is not signed by the Paperboard release key");
        expect(code).toBe(1);
        expect(requests).toEqual(["/paperdl/crane/index.json"]);
        expect(installed).toEqual([]);
    });

    test("names an unreachable registry", async () => {
        const { code, err } = await launcher({ ORIGAMI_REGISTRY_URL: "http://127.0.0.1:9" });
        expect(code).toBe(1);
        expect(err).toContain("Could not reach http://127.0.0.1:9/paperdl/crane/index.json");
    });
});
