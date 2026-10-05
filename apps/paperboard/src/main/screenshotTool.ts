import { app, BrowserWindow, dialog, ipcMain, type Input } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isShellUrl } from "./communication/shellGuard";

export function screenshotSize(width: unknown, height: unknown): { width: number; height: number } {
    if (typeof width !== "number" || typeof height !== "number" ||
        !Number.isInteger(width) || !Number.isInteger(height) ||
        width < 320 || height < 240 || width > 3840 || height > 2160) {
        throw new Error("Use whole pixels: width 320–3840 and height 240–2160.");
    }
    return { width, height };
}

export function screenshotOutputSize(width: number, height: number, scale: unknown): { width: number; height: number } {
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0.25 || scale > 4) {
        throw new Error("Output scale must be between 0.25× and 4×.");
    }
    const result = { width: Math.round(width * scale), height: Math.round(height * scale) };
    if (result.width * result.height > 32_000_000) throw new Error("Scaled screenshots must be at most 32 million pixels.");
    return result;
}

export function isScreenshotShortcut(input: Pick<Input, "type" | "key" | "control" | "meta" | "shift" | "alt" | "isAutoRepeat">, platform = process.platform): boolean {
    return input.type === "keyDown" && input.key === "F8" && input.shift && !input.alt &&
        !input.isAutoRepeat && (platform === "darwin" ? input.meta && !input.control : input.control && !input.meta);
}

/** One controller operates on the existing shell window; closing it leaves the shell open. */
export function installScreenshotTool(controllerUrl: string): () => void {
    let pair: { preview: BrowserWindow; controller: BrowserWindow; busy: boolean; minimum: number[]; viewport: { width: number; height: number } } | null = null;
    const close = () => {
        const previous = pair;
        pair = null;
        if (!previous) return;
        previous.preview.removeListener("closed", close);
        if (!previous.preview.isDestroyed()) previous.preview.setMinimumSize(previous.minimum[0]!, previous.minimum[1]!);
        if (!previous.controller.isDestroyed()) previous.controller.destroy();
    };
    const open = (preview: BrowserWindow) => {
        if (pair) {
            pair.preview.show();
            pair.controller.show();
            pair.controller.focus();
            return;
        }
        const controller = new BrowserWindow({
            title: "Paperboard Screenshot", width: 420, height: 470,
            resizable: false, autoHideMenuBar: true,
            webPreferences: {
                preload: join(__dirname, "../preload/screenshot.js"),
                contextIsolation: true, nodeIntegration: false, sandbox: true,
            },
        });
        const [width, height] = preview.getContentSize();
        pair = { preview, controller, busy: false, minimum: preview.getMinimumSize(), viewport: { width, height } };
        preview.on("closed", close);
        controller.on("closed", close);
        controller.webContents.on("will-navigate", (event) => event.preventDefault());
        controller.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        void controller.loadURL(controllerUrl).catch((error) => {
            close();
            dialog.showErrorBox("Screenshot tool could not open", String(error));
        });
    };
    const handlers = new Map<Electron.WebContents, (event: Electron.Event, input: Input) => void>();
    const onCreated = (_event: Electron.Event, contents: Electron.WebContents) => {
        const handler = (event: Electron.Event, input: Input) => {
            const window = BrowserWindow.fromWebContents(contents);
            if (window && window !== pair?.controller && isShellUrl(contents.getURL()) && isScreenshotShortcut(input)) {
                event.preventDefault();
                open(window);
            }
        };
        handlers.set(contents, handler);
        contents.on("before-input-event", handler);
        contents.once("destroyed", () => handlers.delete(contents));
    };
    // Existing windows as well as future shell windows get the shortcut.
    for (const window of BrowserWindow.getAllWindows()) {
        onCreated({} as Electron.Event, window.webContents);
    }
    // New windows' listeners die with their webContents; the application listener
    // is removed at shutdown. There are no global keyboard hooks.
    app.on("web-contents-created", onCreated);
    ipcMain.handle("screenshot:operation", async (event, operation: unknown, requestedWidth: unknown, requestedHeight: unknown, scale: unknown) => {
        const current = pair;
        if (!current || event.sender !== current.controller.webContents ||
            event.senderFrame !== current.controller.webContents.mainFrame ||
            event.senderFrame.url !== controllerUrl) throw new Error("Screenshot controller required.");
        if (current.busy) throw new Error("A screenshot operation is already running.");
        current.busy = true;
        try {
            const resize = async (size: { width: number; height: number }) => {
                current.preview.setMinimumSize(0, 0);
                current.preview.setContentSize(size.width, size.height);
                current.preview.webContents.setZoomFactor(1);
                const actual = await current.preview.webContents.executeJavaScript(
                    `new Promise((resolve,reject) => {
                        let frame;
                        const timer=setTimeout(() => {
                            cancelAnimationFrame(frame);
                            reject(new Error('Viewport resize timed out at '+innerWidth+'×'+innerHeight+'. Show the Paperboard window and try again.'));
                        },3000);
                        let matched=false;
                        const check=() => {
                            if(innerWidth===${size.width} && innerHeight===${size.height}) {
                                if(matched) {
                                    clearTimeout(timer);
                                    resolve({width:innerWidth,height:innerHeight});
                                    return;
                                }
                                matched=true;
                            } else matched=false;
                            frame=requestAnimationFrame(check);
                        };
                        frame=requestAnimationFrame(check);
                    })`,
                );
                if (actual.width !== size.width || actual.height !== size.height) {
                    throw new Error(`The window manager allowed ${actual.width}×${actual.height}, rather than ${size.width}×${size.height}.`);
                }
            };
            if (operation === "resize") {
                const size = screenshotSize(requestedWidth, requestedHeight);
                await resize(size);
                current.viewport = size;
                return { message: `Viewport: ${size.width}×${size.height}` };
            }
            if (operation !== "save") throw new Error("Unknown screenshot operation.");
            const { width, height } = current.viewport;
            const output = screenshotOutputSize(width, height, scale);
            // Window managers may reconfigure an unfocused window. Reapply the
            // selected viewport and observe it before each capture.
            await resize(current.viewport);
            const captured = await current.preview.webContents.capturePage();
            if (captured.isEmpty()) throw new Error("The window did not produce an image. Try again.");
            // Start with native device pixels, then apply the user's explicit
            // output scale once. Scaling changes the PNG, not CSS breakpoints.
            const pixels = captured.getSize();
            if (pixels.width < width || pixels.height < height) throw new Error("Capture was smaller than the viewport. Try again.");
            const png = (pixels.width === output.width && pixels.height === output.height ? captured :
                captured.resize({ ...output, quality: "best" })).toPNG();
            const selected = await dialog.showSaveDialog(current.controller, {
                title: "Save Paperboard screenshot", defaultPath: `paperboard-${output.width}x${output.height}.png`,
                filters: [{ name: "PNG image", extensions: ["png"] }],
            });
            if (selected.canceled || !selected.filePath) return { message: "Save cancelled." };
            if (pair !== current) throw new Error("The screenshot session was closed.");
            await writeFile(selected.filePath, png);
            return { message: `Saved ${output.width}×${output.height} PNG to ${selected.filePath}` };
        } finally {
            current.busy = false;
        }
    });
    return () => {
        app.off("web-contents-created", onCreated);
        for (const [contents, handler] of handlers) contents.removeListener("before-input-event", handler);
        handlers.clear();
        close();
        ipcMain.removeHandler("screenshot:operation");
    };
}
