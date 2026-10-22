import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PaperCraneEngine } from "../papercrane/engine";
import { handlePanels } from "../papercrane/rpc/panels";
import { handlePackages } from "../papercrane/rpc/packages";
import { FIXTURE_RELEASE_PUBLIC_KEY, manifestFile, startFixtureRegistry, type FixtureRegistry } from "./registryFixture";

let root: string;
let registry: FixtureRegistry;
let engine: PaperCraneEngine;
const panelId = "dev.test.rollback";
beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "release-rollback-"));
    registry = await startFixtureRegistry(root);
    engine = new PaperCraneEngine(path.join(root, "host"), undefined, registry.url, FIXTURE_RELEASE_PUBLIC_KEY);
});
afterEach(async () => {
    await registry.stop();
    fs.rmSync(root, { recursive: true, force: true });
});
function ctx(claim: string | null) {
    const replies: any[] = [];
    return { replies, engine, callerPanelId: () => claim, sendEvent: () => undefined,
        reply: (_id: unknown, result: any, error?: string, code?: string) => replies.push({ result, error, code }) };
}
const publishPanel = (version: string) => registry.publish(panelId, version, {
    "manifest.json": manifestFile(panelId, version), "dist/index.html": version,
});
const packageDigest = (record: Record<string, any>) => Object.values(record.platforms)[0] as { sha256: string };
const download = (release: { record: Record<string, unknown> }, claim: string | null = null, extra = {}) =>
    handlePackages("package:download", 1, { downloadId: "fixture", packageName: "runtime", sha256: packageDigest(release.record).sha256, ...extra }, ctx(claim) as any);
const packageBytes = () => fs.readFileSync(path.join(engine.getPackagePath("runtime"), "bin/version"), "utf8");

test("signed panel replay is refused without changing installed version or bytes; reinstall and host downgrade work", async () => {
    const older = await publishPanel("1.0.0");
    await publishPanel("2.0.0");
    await engine.installPanel(panelId);
    await engine.installPanel(panelId); // same-version reinstall
    registry.releases.set(panelId, older);
    const host = ctx(null);
    await handlePanels("panel:install", 1, { panelId, version: "1.0.0", sha256: older.record.sha256 }, host as any);
    expect(host.replies[0].error).toMatch(/rollback/i);
    expect(engine.installedPanelVersion(panelId)).toBe("2.0.0");
    expect(fs.readFileSync(engine.resolvePath("panels", panelId, "dist/index.html"), "utf8")).toBe("2.0.0");
    const panel = ctx(panelId);
    await handlePanels("panel:install", 1, { panelId, allowDowngrade: true }, panel as any);
    expect(panel.replies[0].code).toBe("FORBIDDEN");
    const downgrade = ctx(null);
    await handlePanels("panel:install", 1, { panelId, allowDowngrade: true }, downgrade as any);
    expect(downgrade.replies[0].error).toBeUndefined();
    expect(engine.installedPanelVersion(panelId)).toBe("1.0.0");
    expect(fs.readFileSync(engine.resolvePath("panels", panelId, "dist/index.html"), "utf8")).toBe("1.0.0");
});

test("signed package replay and same-version replacement are refused; reinstall and explicit host downgrade work", async () => {
    const older = await registry.publishPackage("runtime", "1.0.0");
    const newer = await registry.publishPackage("runtime", "2.0.0");
    await download(newer, panelId);
    await download(newer, panelId);
    registry.packages.set("runtime", older);
    await expect(download(older, panelId)).rejects.toThrow(/rollback/i);
    expect(engine.getPackageIndex().runtime.version).toBe("2.0.0");
    expect(packageBytes()).toBe("2.0.0");
    await expect(download(older, panelId, { allowDowngrade: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(packageBytes()).toBe("2.0.0");
    const replacement = await registry.publishPackage("runtime", "2.0.0", "different signed bytes");
    await expect(download(replacement)).rejects.toThrow(/rollback/i);
    expect(engine.getPackageIndex().runtime.sha256).toBe(packageDigest(newer.record).sha256);
    expect(packageBytes()).toBe("2.0.0");
    registry.packages.set("runtime", older);
    await download(older, null, { allowDowngrade: true });
    expect(engine.getPackageIndex().runtime.version).toBe("1.0.0");
    expect(packageBytes()).toBe("1.0.0");
});

test("a recovered staged package is also a rollback floor, even when installed bytes already match the request", async () => {
    const installed = await registry.publishPackage("runtime", "1.0.0");
    await download(installed);
    const newer = await registry.publishPackage("runtime", "3.0.0");
    const packages = path.join(root, "host/packages");
    fs.mkdirSync(path.join(packages, ".staged-runtime/bin"), { recursive: true });
    fs.writeFileSync(path.join(packages, ".staged-runtime/bin/version"), "3.0.0");
    fs.writeFileSync(path.join(packages, ".staged-runtime.json"), JSON.stringify({ name: "runtime", version: "3.0.0", sha256: packageDigest(newer.record).sha256 }));
    engine = new PaperCraneEngine(path.join(root, "host"), undefined, registry.url, FIXTURE_RELEASE_PUBLIC_KEY);
    registry.packages.set("runtime", installed);
    await expect(download(installed)).rejects.toThrow(/rollback/i);
    expect(packageBytes()).toBe("1.0.0");
    expect(fs.readFileSync(path.join(packages, ".staged-runtime/bin/version"), "utf8")).toBe("3.0.0");
    expect(engine.pendingPackageUpdates()[0].version).toBe("3.0.0");
});
