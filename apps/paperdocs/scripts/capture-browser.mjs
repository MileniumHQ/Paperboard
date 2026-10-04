import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Use Chrome's real page zoom, the setting changed by Ctrl/Command-plus. */
export async function captureBrowser(zoom = 1.25) {
    const profile = mkdtempSync(join(tmpdir(), "paperboard-chrome-capture-"));
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome",
            headless: true,
            viewport: { width: 1600, height: 1200 },
            deviceScaleFactor: 1,
            colorScheme: "dark",
            args: ["--force-color-profile=srgb"],
        });
        const settings = await context.newPage();
        await settings.goto("chrome://settings/appearance");
        await settings.locator("#zoomLevel").selectOption(String(zoom));
        await settings.close();
        return {
            context,
            async close() {
                await context.close();
                rmSync(profile, { recursive: true, force: true });
            },
        };
    } catch (error) {
        if (context) await context.close();
        rmSync(profile, { recursive: true, force: true });
        throw error;
    }
}
