import { app, BrowserWindow, dialog, nativeImage, protocol } from "electron";
import assert from "node:assert/strict";
import { join } from "node:path";
import { installScreenshotTool, isScreenshotShortcut, screenshotOutputSize, screenshotSize } from "../../src/main/screenshotTool";

const root = process.env.PAPERBOARD_DIR!;
app.setPath("userData", join(root, "electron"));
protocol.registerSchemesAsPrivileged([{ scheme: "paperboard", privileges: { standard: true, secure: true } }]);
const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error("Electron fixture timed out");
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

app.whenReady().then(async () => {
    let dispose: (() => void) | undefined;
    try {
        protocol.handle("paperboard", () => new Response('<html><body style="margin:0;background:white"><h1>Native screenshot fixture</h1></body></html>', { headers: { "Content-Type": "text/html" } }));
        dispose = installScreenshotTool("paperboard://shell/screenshot.html");
        const shell = new BrowserWindow({ width: 1100, height: 720, minWidth: 860, minHeight: 560 });
        await shell.loadURL("paperboard://shell/index.html");
        const key = { type: "keyDown" as const, key: "F8", shift: true, control: true, meta: false, alt: false, isAutoRepeat: false };
        assert.equal(isScreenshotShortcut(key, "linux"), true);
        assert.equal(isScreenshotShortcut({ ...key, isAutoRepeat: true }, "linux"), false);
        assert.equal(isScreenshotShortcut({ ...key, control: false, meta: true }, "darwin"), true);
        assert.throws(() => screenshotSize(100000, 900));
        assert.throws(() => screenshotOutputSize(3840, 2160, 4), /32 million/);
        shell.webContents.sendInputEvent({ type: "keyDown", keyCode: "F8", modifiers: [process.platform === "darwin" ? "meta" : "control", "shift"] });
        await waitFor(() => BrowserWindow.getAllWindows().length === 2);
        const controller = BrowserWindow.getAllWindows().find(w => w !== shell)!;
        await waitFor(() => !controller.webContents.isLoadingMainFrame() && controller.webContents.getURL().endsWith("screenshot.html"));
        controller.webContents.on("console-message", (_event, _level, message) => console.error("controller:", message));
        const invoke = async (script: string) => {
            const result = await controller.webContents.executeJavaScript(`(async () => { try { return {value:await (${script})}; } catch(error) { return {error:error.message}; } })()`);
            if (result.error) throw new Error(result.error);
            return result.value;
        };
        await invoke("window.screenshotTool.resize(1440,900)");
        assert.deepEqual(shell.getContentSize(), [1440, 900]);
        await assert.rejects(invoke("window.screenshotTool.resize(3,900)"), /whole pixels/);
        let output = join(root, "native.png");
        // Replace only the OS chooser, crossing the real preload, IPC owner,
        // window resize, native capture, and PNG file-write boundaries.
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
        await invoke("window.screenshotTool.save(1)");
        assert.deepEqual(nativeImage.createFromPath(output).getSize(), { width: 1440, height: 900 });
        // A compositor/window-manager reconfiguration must not silently change
        // the controller's selected output dimensions on the next capture.
        shell.setContentSize(1100, 693);
        output = join(root, "scaled.png");
        await invoke("window.screenshotTool.save(2)");
        assert.deepEqual(nativeImage.createFromPath(output).getSize(), { width: 2880, height: 1800 });
        await assert.rejects(invoke("window.screenshotTool.save(0)"), /Output scale/);
        output = join(root, "missing", "failure.png");
        await assert.rejects(invoke("window.screenshotTool.save(1)"), /ENOENT/);
        dialog.showSaveDialog = async () => ({ canceled: true, filePath: "" });
        assert.match((await invoke("window.screenshotTool.save(1)")).message, /cancelled/);
        const foreign = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, "../preload/screenshot.js"), contextIsolation: true, sandbox: true } });
        await foreign.loadURL("data:text/html,foreign");
        assert.match(await foreign.webContents.executeJavaScript("window.screenshotTool.save(1).then(() => 'unexpected success', error => error.message)"), /controller required/);
        foreign.destroy();
        shell.webContents.sendInputEvent({ type: "keyDown", keyCode: "F8", modifiers: [process.platform === "darwin" ? "meta" : "control", "shift"] });
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(BrowserWindow.getAllWindows().length, 2);
        controller.close();
        await waitFor(() => controller.isDestroyed());
        assert.equal(shell.isDestroyed(), false);
        assert.equal(BrowserWindow.getAllWindows().length, 1);
        assert.deepEqual(shell.getMinimumSize(), [860, 560]);
        console.log("SCREENSHOT_CONTRACT_PASS");
    } finally {
        dispose?.();
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
    }
}).then(() => app.exit(0), error => {
    console.error(error);
    app.exit(1);
});
