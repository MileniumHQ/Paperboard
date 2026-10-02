import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { PaperCraneEngine } from "../papercrane/engine";
import { EmbeddedSupervisor } from "../papercrane/embeddedSupervisor";
import { releaseMessage } from "../papercrane/releaseSignature";
import { fixtureSign, FIXTURE_RELEASE_PUBLIC_KEY } from "./registryFixture";

const platformKey = `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;

test("runtime upgrades install new bytes and record the verified digest; bad replacement preserves old runtime", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-upgrade-"));
    let bytes = Buffer.alloc(0);
    let digest = "";
    let version = "0.1.0";
    let base = "";
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
        if (new URL(request.url).pathname.endsWith(".json")) {
            return Response.json({ version, platforms: { [platformKey]: { url: `${base}/runtime.tar.gz`, sha256: digest, signature: fixtureSign(releaseMessage.package("runtime", version, platformKey, digest)) } } });
        }
        return new Response(bytes);
    } });
    base = `http://127.0.0.1:${server.port}`;
    const engine = new PaperCraneEngine(path.join(root, "host"), undefined, base, FIXTURE_RELEASE_PUBLIC_KEY);
    const release = async (value: string) => {
        const source = path.join(root, "source");
        fs.mkdirSync(path.join(source, "runtime", "bin"), { recursive: true });
        fs.writeFileSync(path.join(source, "runtime", "bin", "version"), value);
        await tar.c({ file: path.join(root, "runtime.tar.gz"), cwd: source, gzip: true }, ["runtime"]);
        bytes = fs.readFileSync(path.join(root, "runtime.tar.gz"));
        digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
        version = value;
    };
    try {
        await release("0.1.0");
        await engine.downloadPackage("runtime", "first", undefined, digest);
        await release("0.2.0");
        const workload = new EmbeddedSupervisor("fixture-workload", { id: "fixture-workload", type: "child_process", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: root });
        await workload.connect();
        (engine as any).clients.set("fixture-workload", workload);
        try {
            await expect(engine.downloadPackage("runtime", "in-use", undefined, digest)).rejects.toThrow(/Stop running workloads/);
            expect(engine.getPackageIndex().runtime.version).toBe("0.1.0");
        } finally {
            const exited = new Promise<void>((resolve) => workload.on("exit", resolve));
            workload.kill("SIGKILL"); await exited; workload.destroy();
            (engine as any).clients.delete("fixture-workload");
        }
        await engine.downloadPackage("runtime", "upgrade", undefined, digest);
        expect(fs.readFileSync(path.join(engine.getPackagePath("runtime"), "bin", "version"), "utf8")).toBe("0.2.0");
        expect(engine.getPackageIndex().runtime).toMatchObject({ version: "0.2.0", sha256: digest });
        bytes = Buffer.from("broken archive"); digest = "0".repeat(64);
        await expect(engine.downloadPackage("runtime", "broken", undefined, digest)).rejects.toThrow(/SHA256/);
        expect(fs.readFileSync(path.join(engine.getPackagePath("runtime"), "bin", "version"), "utf8")).toBe("0.2.0");
    } finally { await server.stop(true); fs.rmSync(root, { recursive: true, force: true }); }
});
