import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { PaperCraneEngine } from "../papercrane/engine";
import { EmbeddedSupervisor } from "../papercrane/embeddedSupervisor";
import { handlePackages } from "../papercrane/rpc/packages";
import { releaseMessage } from "../papercrane/releaseSignature";
import { fixtureSign, FIXTURE_RELEASE_PUBLIC_KEY } from "./registryFixture";

const platformKey = `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;

// a live workload the engine supervises, running `command` as far as the
// engine knows (the fixture child itself is an idle Bun process)
async function workload(engine: PaperCraneEngine, id: string, command: string, owner: string | null, cwd: string) {
    const client = new EmbeddedSupervisor(id, { id, type: "child_process", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd });
    await client.connect();
    (engine as any).clients.set(id, client);
    (engine as any).clientCommands.set(id, command);
    engine.setClientOwner(id, owner);
    return client;
}

test("a runtime update waits for the workloads running from that runtime, then installs itself when they stop", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-upgrade-"));
    let bytes = Buffer.alloc(0);
    let digest = "";
    let version = "0.1.0";
    let base = "";
    let archiveFetches = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
        if (new URL(request.url).pathname.endsWith(".json")) {
            return Response.json({ version, platforms: { [platformKey]: { url: `${base}/runtime.tar.gz`, sha256: digest, signature: fixtureSign(releaseMessage.package("runtime", version, platformKey, digest)) } } });
        }
        archiveFetches++;
        return new Response(bytes);
    } });
    base = `http://127.0.0.1:${server.port}`;
    const host = path.join(root, "host");
    const engine = new PaperCraneEngine(host, undefined, base, FIXTURE_RELEASE_PUBLIC_KEY);
    const release = async (value: string) => {
        const source = path.join(root, "source");
        fs.mkdirSync(path.join(source, "runtime", "bin"), { recursive: true });
        fs.writeFileSync(path.join(source, "runtime", "bin", "version"), value);
        await tar.c({ file: path.join(root, "runtime.tar.gz"), cwd: source, gzip: true }, ["runtime"]);
        bytes = fs.readFileSync(path.join(root, "runtime.tar.gz"));
        digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
        version = value;
    };
    const installed = () => fs.readFileSync(path.join(engine.getPackagePath("runtime"), "bin", "version"), "utf8");
    const runtimeCommand = () => path.join(engine.getPackagePath("runtime"), "bin", "runtime");
    const started: EmbeddedSupervisor[] = [];
    try {
        await release("0.1.0");
        expect(await engine.downloadPackage("runtime", "first", undefined, digest)).toEqual({ path: path.join(host, "packages", "runtime") });

        // a workload that does not run from the runtime never holds it back
        started.push(await workload(engine, "other-tool", process.execPath, "dev.paperboard.terminal", root));
        await release("0.2.0");
        expect((await engine.downloadPackage("runtime", "unrelated", undefined, digest)).waiting).toBeUndefined();
        expect(installed()).toBe("0.2.0");

        // one that does: the verified release is staged, the installed one stays
        started.push(await workload(engine, "dev.paperboard.agents.ollama", runtimeCommand(), "dev.paperboard.agents", root));
        await release("0.3.0");
        const outcome = await engine.downloadPackage("runtime", "in-use", undefined, digest);
        expect(outcome.waiting).toEqual({ name: "runtime", version: "0.3.0", blockedBy: [{ processId: "dev.paperboard.agents.ollama", owner: "dev.paperboard.agents" }] });
        expect(installed()).toBe("0.2.0");
        expect(engine.getPackageIndex().runtime.version).toBe("0.2.0");
        expect(engine.pendingPackageUpdates()).toEqual([outcome.waiting!]);

        // asking again does not download the staged bytes a second time
        const fetches = archiveFetches;
        expect((await engine.downloadPackage("runtime", "again", undefined, digest)).waiting?.version).toBe("0.3.0");
        expect(archiveFetches).toBe(fetches);

        // a panel sees only the updates its own workloads hold back
        const pending = async (caller: string | null) => {
            let result: any;
            await handlePackages("package:pending", 1, {}, { engine, callerPanelId: () => caller, reply: (_id: unknown, r: any) => { result = r; } } as any);
            return result.updates;
        };
        expect(await pending(null)).toEqual([outcome.waiting]);
        expect(await pending("dev.paperboard.agents")).toEqual([outcome.waiting]);
        expect(await pending("dev.paperboard.terminal")).toEqual([]);

        // the last user stops: the staged release installs without being asked
        await engine.killProcess("dev.paperboard.agents.ollama");
        await engine.applyReadyStagedPackages();
        expect(installed()).toBe("0.3.0");
        expect(engine.getPackageIndex().runtime).toMatchObject({ version: "0.3.0", sha256: digest });
        expect(engine.pendingPackageUpdates()).toEqual([]);
        expect(fs.readdirSync(path.join(host, "packages")).filter((e) => e.startsWith(".staged-") || e.startsWith(".replaced-"))).toEqual([]);

        // a staged update outlives the daemon: the next one installs it once
        // nothing runs from the old release
        started.push(await workload(engine, "dev.paperboard.agents.ollama", runtimeCommand(), "dev.paperboard.agents", root));
        await release("0.4.0");
        expect((await engine.downloadPackage("runtime", "before-restart", undefined, digest)).waiting?.version).toBe("0.4.0");
        const next = new PaperCraneEngine(host, undefined, base, FIXTURE_RELEASE_PUBLIC_KEY);
        next.sweepStartupOrphans();
        await next.applyReadyStagedPackages();
        expect(fs.readFileSync(path.join(next.getPackagePath("runtime"), "bin", "version"), "utf8")).toBe("0.4.0");
        expect(next.pendingPackageUpdates()).toEqual([]);

        // a swap interrupted between its renames is put back on start
        const packages = path.join(host, "packages");
        fs.renameSync(path.join(packages, "runtime"), path.join(packages, ".replaced-1-runtime"));
        new PaperCraneEngine(host, undefined, base, FIXTURE_RELEASE_PUBLIC_KEY).sweepStartupOrphans();
        expect(fs.readFileSync(path.join(packages, "runtime", "bin", "version"), "utf8")).toBe("0.4.0");

        // A same-version different digest is now refused by release ordering.
        // Offer a newer release so this still exercises download integrity.
        version = "0.5.0";
        bytes = Buffer.from("broken archive"); digest = "0".repeat(64);
        await expect(next.downloadPackage("runtime", "broken", undefined, digest)).rejects.toThrow(/SHA256/);
        expect(fs.readFileSync(path.join(next.getPackagePath("runtime"), "bin", "version"), "utf8")).toBe("0.4.0");
    } finally {
        for (const client of started) {
            if (client.isConnected()) {
                const exited = new Promise<void>((resolve) => client.on("exit", () => resolve()));
                client.kill("SIGKILL");
                await exited;
            }
            client.destroy();
        }
        await server.stop(true);
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a workload whose command is unknown holds back every runtime update", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-unknown-"));
    const engine = new PaperCraneEngine(path.join(root, "host"));
    const client = await workload(engine, "adopted", process.execPath, null, root);
    try {
        (engine as any).clientCommands.set("adopted", null);
        expect((engine as any).packageUsers("ollama")).toEqual([{ processId: "adopted", owner: null }]);
        expect((engine as any).packageUsers("java-21")).toEqual([{ processId: "adopted", owner: null }]);
    } finally {
        const exited = new Promise<void>((resolve) => client.on("exit", () => resolve()));
        client.kill("SIGKILL"); await exited; client.destroy();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
