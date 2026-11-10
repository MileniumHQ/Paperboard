import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "../helpers/crane";
import { fakeSteamcmd, steamcmdDir } from "../helpers/steamcmd";
import { tempDir } from "../helpers/tmp";
import { installApp, takeSelfUpdate } from "../../src/games/steam/steamcmd";
import { runInstallerProcess } from "../../src/service/installerProcess";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const TF2 = 232250;
const bootstrap = () => path.join(steamcmdDir(), process.platform === "win32" ? "steamcmd.exe" : "steamcmd.sh");

// Steam and Terraria installs and updates are verified.
describe("SteamCMD's self-update", () => {
    test("on Windows the self-update (exit 7) is taken before the real run, which is the one watched", async () => {
        const dir = tempDir();
        // SteamCMD on Windows exits 7 after updating itself; Linux's steamcmd.sh restarts itself instead
        const steam = fakeSteamcmd({ selfUpdateOnce: process.platform === "win32", install: { [TF2]: { mode: "ok", build: "26334371" } } });
        expect(await installApp(TF2, dir)).toBe("26334371");
        const install = ["+force_install_dir", dir, "+login", "anonymous", "+app_update", String(TF2), "validate", "+quit"];
        if (process.platform === "win32") expect(steam.runs()).toEqual([["+quit"], ["+quit"], install]);
        else expect(steam.runs()).toEqual([install]);
    });

    test("a SteamCMD that keeps updating itself, or fails to start, is reported instead of run", async () => {
        const run = (r: Parameters<typeof runInstallerProcess>[0]) => runInstallerProcess(r);
        const home = tempDir();
        fakeSteamcmd({ selfUpdateOnce: true });
        await takeSelfUpdate(run, bootstrap(), home, "win32");
        const steam = fakeSteamcmd({ install: { [TF2]: { mode: "fail" } } });
        // a run that only quits succeeds; nothing else is asked of it
        await takeSelfUpdate(run, bootstrap(), home, "win32");
        expect(steam.runs()).toEqual([["+quit"]]);
        // on other systems there is nothing to take
        await takeSelfUpdate(() => Promise.reject(new Error("must not run")), bootstrap(), home, "linux");
        const failing = (exitCode: number) => async () => ({ exitCode, tail: [`exit ${exitCode}`] });
        await expect(takeSelfUpdate(failing(7), bootstrap(), home, "win32")).rejects.toThrow("SteamCMD updated itself three times in a row without settling");
        await expect(takeSelfUpdate(failing(3), bootstrap(), home, "win32")).rejects.toThrow("SteamCMD could not start (exited with 3)\nexit 3");
    });
});
