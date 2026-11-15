// With Theme set to System, an open panel follows the OS when it switches
// between light and dark, as the shell and title bar do, without a reload.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { BUILD_TIMEOUT_MS, buildApp, buildCrane, installBuiltPanel } from "../platform/app/support/build";
import { startCrane, WAIT_MS, type RunningCrane } from "../platform/app/support/crane";
import { domCondition, launchElectron, SHELL, shellReady, type ElectronApp } from "../platform/app/support/electron";
import { tempDataDir } from "../platform/app/support/temp";

const PANEL = "dev.paperboard.terminal";
const FRAME = `panel://local.${PANEL}/`;

let daemon: RunningCrane;
let electron: ElectronApp;

beforeAll(async () => {
    const [app, crane] = await Promise.all([buildApp(), buildCrane()]);
    const dataDir = tempDataDir("panel-theme");
    await installBuiltPanel(dataDir, PANEL);
    daemon = await startCrane(crane.file, dataDir);
    electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
    await shellReady(electron);
    await electron.evalIn(SHELL, `document.querySelector('[role=radio][aria-label^="This Computer"]').click()`);
    const item = `document.querySelector('[class*=panelList] label[data-value="${PANEL}"]')`;
    await electron.evalIn(SHELL, domCondition(item));
    await electron.evalIn(SHELL, `${item}.click()`);
    await electron.evalIn(SHELL, domCondition(`document.querySelector('iframe[src^="${FRAME}"]')`));
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
    await electron?.quit();
    await daemon?.stop();
});

const panelTheme = (theme: string) => domCondition(`document.documentElement.getAttribute("data-paperui-theme") === ${JSON.stringify(theme)}`, WAIT_MS / 2);

// Inventory: Core contracts — a panel always matches the window it lives in.
test("under the System theme, an open panel switches with the OS between light and dark", async () => {
    expect(await electron.evalMain(`return electron.nativeTheme.themeSource`)).toBe("system");
    const start = (await electron.evalMain<boolean>(`return electron.nativeTheme.shouldUseDarkColors`)) ? "dark" : "light";
    await electron.evalInFrame(FRAME, panelTheme(start));

    // the OS's appearance, as Chromium sees it, flips one way and back
    for (const os of start === "dark" ? ["light", "dark"] : ["dark", "light"]) {
        await electron.evalMain(`electron.nativeTheme.themeSource = ${JSON.stringify(os)}; return true;`);
        await electron.evalInFrame(FRAME, panelTheme(os));
    }
    expect(electron.failures()).toEqual([]);
}, WAIT_MS * 2);
