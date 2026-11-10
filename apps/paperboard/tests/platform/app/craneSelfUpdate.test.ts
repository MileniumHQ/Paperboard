import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";
import { releaseMessage } from "../../../papercrane/releaseSignature";
import { APP_PACKAGE, BUILD_TIMEOUT_MS, buildCrane, buildPanel, compileCrane, installBuiltPanel, type BuiltCrane } from "./support/build";
import { CraneSocket, startCrane, WAIT_MS, type RunningCrane } from "./support/crane";
import { tempDataDir, tempDir } from "./support/temp";

const NEXT_VERSION = "99.0.0";
const PANEL = "dev.paperboard.terminal";

// a throwaway release key: the daemon under test is told to trust it
const keys = crypto.generateKeyPairSync("ed25519");
const RELEASE_ENV = { PAPERBOARD_RELEASE_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

interface Release {
    url: string;
    sha256: string;
    signature: string;
}

// a crane release the way the publisher packs one: the binary, named for
// its target, in a .tar.gz, signed over (version, archive sha256)
async function packRelease(binary: BuiltCrane, version: string): Promise<{ archive: string; sha256: string; signature: string }> {
    const dir = tempDir("crane-release");
    const name = `papercrane-${binary.target}`;
    fs.copyFileSync(binary.file, path.join(dir, name));
    fs.chmodSync(path.join(dir, name), 0o755);
    const archive = path.join(tempDir("crane-archive"), `${name}.tar.gz`);
    await tar.c({ gzip: true, file: archive, cwd: dir, portable: true }, [name]);
    const digest = sha256(archive);
    const signature = crypto.sign(null, releaseMessage.crane(version, digest), keys.privateKey).toString("base64");
    return { archive, sha256: digest, signature };
}

const served = new Map<string, string>();
const feed = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
        const file = served.get(new URL(req.url).pathname);
        return file ? new Response(Bun.file(file)) : new Response("not found", { status: 404 });
    },
});
afterAll(() => feed.stop(true));

async function serveRelease(binary: BuiltCrane, version: string): Promise<Release> {
    const packed = await packRelease(binary, version);
    const route = `/${crypto.randomUUID()}/${path.basename(packed.archive)}`;
    served.set(route, packed.archive);
    return { url: `http://127.0.0.1:${feed.port}${route}`, sha256: packed.sha256, signature: packed.signature };
}

// the installed daemon: its own copy, since an update replaces it in place
function installDaemon(current: BuiltCrane): string {
    const file = path.join(tempDir("crane-install"), path.basename(current.file));
    fs.copyFileSync(current.file, file);
    fs.chmodSync(file, 0o755);
    return file;
}

let current: BuiltCrane;
let next: BuiltCrane;
let broken: BuiltCrane;
beforeAll(async () => {
    [current, next, broken] = await Promise.all([
        buildCrane(),
        compileCrane({ version: NEXT_VERSION }),
        compileCrane({ version: NEXT_VERSION, bootFailure: true }),
        buildPanel(PANEL),
    ]);
}, BUILD_TIMEOUT_MS);

// The daemon self-update lands a crane that boots on the same data.
describe("daemon self-update", () => {
    if (process.platform === "win32") {
        test("Windows refuses to replace the running daemon and leaves its executable untouched", async () => {
            const exe = installDaemon(current);
            const before = sha256(exe);
            const daemon = await startCrane(exe, tempDataDir("update-win"), RELEASE_ENV);
            const host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
            const release = await serveRelease(next, NEXT_VERSION);
            const reply = await host.send("system:update", { downloadUrl: release.url, sha256: release.sha256, version: NEXT_VERSION, signature: release.signature });
            expect(reply.error).toBe("Self-update is not supported on Windows yet");
            expect(sha256(exe)).toBe(before);
            expect((await host.call("system:info")).version).toBe(APP_PACKAGE.version);
            host.close();
            await daemon.stop();
        }, WAIT_MS * 2);
    } else {
    test("a signed release replaces the binary, and the restarted daemon reports it with tokens and workloads intact", async () => {
        const exe = installDaemon(current);
        const dataDir = tempDataDir("update");
        await installBuiltPanel(dataDir, PANEL);
        let daemon: RunningCrane = await startCrane(exe, dataDir, RELEASE_ENV);
        const host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);

        // a paired computer's credential and the panel service's own one
        const { code } = await host.call("system:pairing-start");
        const pairing = await CraneSocket.open(daemon.handshake.port);
        const { token: paired } = await pairing.call("auth:pair", { code, clientName: "laptop" });
        pairing.close();
        await host.call("panel:restartService", { panelId: PANEL });
        const store = JSON.parse(fs.readFileSync(path.join(dataDir, "local", "authorized_tokens.json"), "utf8"));
        const serviceToken = store.find((e: any) => e.panelId === PANEL && !e.issuedBy)?.token;
        expect(typeof serviceToken).toBe("string");
        // a supervised workload, which outlives its daemon
        await host.call("process:run", { id: "update-workload", command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] });

        const release = await serveRelease(next, NEXT_VERSION);
        const outcome = await host.call("system:update", { downloadUrl: release.url, sha256: release.sha256, version: NEXT_VERSION, signature: release.signature });
        expect(outcome).toMatchObject({ accepted: true, status: "awaiting-restart", restartRequired: true });
        expect(sha256(exe)).toBe(sha256(next.file));
        host.close();

        await daemon.stop();
        daemon = await startCrane(exe, dataDir, RELEASE_ENV);
        const after = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
        expect((await after.call("system:info")).version).toBe(NEXT_VERSION);
        // confirmed by the new generation: the parked old binary is gone
        expect(fs.existsSync(`${exe}.update`)).toBe(false);
        expect(await after.call("process:exists", { id: "update-workload" })).toEqual({ running: true });
        await after.call("process:kill", { id: "update-workload" });
        after.close();
        for (const token of [paired, serviceToken]) {
            const socket = await CraneSocket.authed(daemon.handshake.port, token);
            socket.close();
        }
        await daemon.stop();
    }, WAIT_MS * 4);

    test("a release whose binary cannot start is rolled back to the previous executable, byte for byte, and the daemon keeps answering", async () => {
        const exe = installDaemon(current);
        const before = fs.readFileSync(exe);
        const dataDir = tempDataDir("update-broken");
        const daemon = await startCrane(exe, dataDir, RELEASE_ENV);
        const host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
        const release = await serveRelease(broken, NEXT_VERSION);
        const reply = await host.send("system:update", { downloadUrl: release.url, sha256: release.sha256, version: NEXT_VERSION, signature: release.signature });
        expect(reply.result?.accepted).not.toBe(true);
        expect(reply.error).toBeString();
        expect(fs.readFileSync(exe).equals(before)).toBe(true);
        expect(fs.existsSync(`${exe}.update`)).toBe(false);
        expect((await host.call("system:info")).version).toBe(APP_PACKAGE.version);
        host.close();
        await daemon.stop();
    }, WAIT_MS * 2);
    }
});
