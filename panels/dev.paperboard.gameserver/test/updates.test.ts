import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { actionsApi, getTransport } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { fakeJavaBinary, installFakeJava } from "./helpers/fakeJava";
import { installPanel, restartService, servicesState } from "./helpers/installedPanel";
import { exe } from "./helpers/standIn";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";
import { FIXTURE_PUBLIC_KEY, serve, sha256, signPackage, type LoopbackServer } from "../../../apps/paperboard/tests/daemon/support/release";
import { tarGz } from "../../../apps/paperboard/tests/daemon/support/archive";

const SERVERS = "servers-0123456789ab";
const ID = "s-up";
const dataDir = process.env.PAPERBOARD_DIR!;
const serverDir = path.join(dataDir, "files", PANEL_ID, SERVERS, ID);
const JAVA = javaPackageFor("1.21.1")!;
const PLATFORM = `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
/** the stand-in server's pids, one per start (helpers/fakeJava.main.ts) */
const runs = () => (fs.existsSync(path.join(serverDir, "runs.log")) ? fs.readFileSync(path.join(serverDir, "runs.log"), "utf8").split("\n").filter(Boolean).map(Number) : []);
const call = <T = unknown>(action: string, inputs: unknown = {}) => actionsApi.call<T>(PANEL_ID, action, inputs, { timeoutMs: null });

let registry: LoopbackServer;
let daemon: TestDaemon;

/** A newer Java on the loopback registry: the same stand-in, marked so the swap shows. */
function releaseJava(version: string): string {
    const bytes = tarGz([
        { name: "jdk/", type: "dir" },
        { name: "jdk/bin/", type: "dir" },
        { name: `jdk/bin/${exe("java")}`, content: fs.readFileSync(fakeJavaBinary()), mode: 0o755 },
        { name: "jdk/release", content: `JAVA_VERSION="${version}"\n` },
    ]);
    const sha = sha256(bytes);
    const file = `/files/${JAVA}-${version}.tar.gz`;
    registry.set(file, bytes);
    registry.set(`/package/${JAVA}.json`, {
        name: JAVA,
        version,
        platforms: { [PLATFORM]: { url: `${registry.url}${file}`, sha256: sha, signature: signPackage(JAVA, version, PLATFORM, sha) } },
    });
    return sha;
}

beforeAll(async () => {
    registry = serve();
    // the daemon trusts the fixture key and asks the loopback registry: no real Java is downloaded
    process.env.ORIGAMI_REGISTRY_URL = registry.url;
    process.env.PAPERBOARD_RELEASE_PUBLIC_KEY = FIXTURE_PUBLIC_KEY;
    installPanel(dataDir);
    fs.mkdirSync(path.join(dataDir, "configs"), { recursive: true });
    const stored = { id: ID, name: "Updating", game: "minecraft", directory: `${SERVERS}/${ID}`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } };
    fs.writeFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [stored] }));
    writeTree(serverDir, { "server.jar": "jar", "eula.txt": "eula=true\n", "world/level.dat": "world" });
    installFakeJava(JAVA, dataDir);
    daemon = await startTestDaemon();
    await restartService();
});
afterAll(async () => {
    await call(`${ID}/stop-server`).catch(() => {});
    await daemon?.stop();
    await registry?.close();
    delete process.env.ORIGAMI_REGISTRY_URL;
    delete process.env.PAPERBOARD_RELEASE_PUBLIC_KEY;
});

// An update of the Java a server runs on waits for it, and Stop and update
// stops it the way Stop does (the world saved) and starts it again after.
describe("Stop and update", () => {
    test("a Java update waits for a running server; Stop and update stops it with stop, swaps Java in and starts it again", async () => {
        const state = servicesState();
        await call(`${ID}/start-server`);
        await state.waitFor(ID, (s) => s.serverStatus === "online", "the server online");
        expect(runs()).toHaveLength(1);

        const t = getTransport();
        const sha = releaseJava("21.0.99");
        const staged = await t.call<{ waiting?: { blockedBy: { processId: string; holds: boolean }[] } }>("package:download", { packageName: JAVA, downloadId: "java", sha256: sha }, null);
        // the server is important: it holds the update, and keeps running
        expect(staged.waiting?.blockedBy).toEqual([expect.objectContaining({ processId: `${ID}-mc-server`, holds: true })]);
        expect(fs.existsSync(path.join(dataDir, "packages", JAVA, "release"))).toBe(false);
        expect((await state.server(ID))?.serverStatus).toBe("online");

        const updated = await t.call<{ failures: Record<string, string> }>("update:inUse", { packages: [JAVA] }, null);
        expect(updated.failures).toEqual({});
        expect(fs.readFileSync(path.join(dataDir, "packages", JAVA, "release"), "utf8")).toContain("21.0.99");
        // stopped by its own stop command, so the world was saved, not a terminate signal
        expect(fs.readFileSync(path.join(serverDir, "commands.log"), "utf8").split("\n")).toContain("stop");

        const back = await state.waitFor(ID, (s) => s.serverStatus === "online" && runs().length === 2, "the server online again on the new Java");
        const lines = back.serverEntries.map((e) => e.content);
        expect(lines).toContain("[Server] Stopping for an update...");
        expect(lines).toContain("[Server] Updated. Starting again.");
    });
});
