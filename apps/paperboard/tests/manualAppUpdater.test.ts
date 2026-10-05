import { describe, expect, it } from "bun:test";
import { ManualAppUpdater } from "../src/main/manualAppUpdater";
import { AppUpdateSession } from "../src/main/appUpdateSession";
import { buildLatestYml } from "../../../scripts/publishLib";

describe("package manager app update availability", () => {
    async function check(body: string, currentVersion: string, status = 200) {
        const requests: string[] = [];
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
            requests.push(new URL(request.url).pathname);
            return new Response(body, { status });
        } });
        const updater = new ManualAppUpdater(currentVersion, `http://127.0.0.1:${server.port}/latest-linux.yml`);
        const session = new AppUpdateSession(updater, () => undefined, 1000, "package-manager");
        try { return { state: await session.check(), requests }; }
        finally { session.dispose(); await server.stop(true); }
    }

    const feed = buildLatestYml("linux", "0.2.0", [{ target: "linux-x64", file: "paperboard-linux-x64.AppImage", sha512: Buffer.alloc(64).toString("base64"), size: 100 }], "2026-10-05T00:00:00Z").text;

    it("reads the actual publisher feed and offers a manual update without downloading app bytes", async () => {
        const result = await check(feed, "0.1.0");
        expect(result.state).toMatchObject({ status: "manual", version: "0.2.0", installMode: "package-manager" });
        expect(result.requests).toEqual(["/latest-linux.yml"]);
    });

    it("does not show an update for the installed or a newer version", async () => {
        for (const current of ["0.2.0", "0.3.0"]) {
            expect((await check(feed, current)).state.status).toBe("current");
        }
    });

    it("unavailable, malformed and oversized feeds remain failures", async () => {
        for (const [body, status] of [["missing", 404], ["version: nonsense", 200], ["x".repeat(64 * 1024 + 1), 200]] as const) {
            expect((await check(body, "0.1.0", status)).state.status).toBe("failed");
        }
    });
});
