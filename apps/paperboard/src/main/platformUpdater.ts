import { AppImageUpdater, MacUpdater, NsisUpdater, type AppUpdater } from "electron-updater";
import { ElectronAppAdapter } from "electron-updater/out/ElectronAppAdapter";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor";

// downloads go to cacheDir, not the platform cache folder (electronData.ts)
class PaperboardAppAdapter extends ElectronAppAdapter {
    constructor(private readonly cacheDir: string) {
        super();
    }

    get baseCachePath(): string {
        return this.cacheDir;
    }
}

/**
 * electron-updater's updater for this platform (deb/rpm/pacman installs use
 * ManualAppUpdater instead), downloading into cacheDir.
 */
export function createPlatformUpdater(cacheDir: string): AppUpdater {
    const adapter = new PaperboardAppAdapter(cacheDir);
    const updater =
        process.platform === "win32" ? new NsisUpdater(undefined, adapter)
        : process.platform === "darwin" ? new MacUpdater(undefined, adapter)
        : new AppImageUpdater(undefined, adapter);
    // electron-updater takes a custom adapter for a test double and leaves its
    // HTTP client unset, so every check would fail on a null executor
    (updater as unknown as { httpExecutor: ElectronHttpExecutor }).httpExecutor =
        new ElectronHttpExecutor((authInfo, callback) => updater.emit("login", authInfo, callback));
    return updater;
}
