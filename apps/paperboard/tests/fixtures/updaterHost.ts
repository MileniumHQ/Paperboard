// The app's update check, run by the real Electron binary in app mode
// (tests/platformUpdater.test.ts): electron-updater's HTTP client is
// Electron's net module, which only exists there.
import { app } from "electron";
import { createPlatformUpdater } from "../../src/main/platformUpdater";

const [feed, cacheDir] = process.argv.slice(-2);
app.whenReady().then(async () => {
    try {
        const updater = createPlatformUpdater(cacheDir!);
        updater.forceDevUpdateConfig = true;
        updater.autoDownload = false;
        updater.setFeedURL({ provider: "generic", url: feed! });
        const result = await updater.checkForUpdates();
        console.log(`RESULT ${JSON.stringify({ version: result?.updateInfo.version })}`);
        app.exit(0);
    } catch (err) {
        console.log(`ERROR ${(err as Error).message}`);
        app.exit(1);
    }
});
