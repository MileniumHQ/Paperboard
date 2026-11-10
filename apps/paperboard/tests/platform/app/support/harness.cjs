// Loaded into the Electron main process with `--require` ahead of the app.
// It keeps every window hidden (nothing appears on the developer's screen),
// reports what the main process and every renderer say back to the test
// over a loopback socket, and runs the test's commands: evaluate in a page
// or frame, evaluate in the main process, quit.
"use strict";
const net = require("node:net");
const electron = require("electron");
const { app, BrowserWindow, webContents } = electron;

const port = Number(process.env.PB_HARNESS_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("PB_HARNESS_PORT is not set");
const socket = net.connect(port, "127.0.0.1");
const report = (message) => socket.write(`${JSON.stringify(message)}\n`);

// hidden, never shown: ready-to-show still fires and pages still render
for (const method of ["show", "showInactive", "focus"]) {
    BrowserWindow.prototype[method] = function () {
        report({ event: "window-show-suppressed", method });
    };
}

const text = (err) => (err && err.stack) || String(err);
process.on("uncaughtException", (err) => report({ event: "main-error", kind: "uncaughtException", message: text(err) }));
process.on("unhandledRejection", (err) => report({ event: "main-error", kind: "unhandledRejection", message: text(err) }));

app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", (event, legacyLevel, legacyMessage) => {
        const level = typeof event.level === "string" ? event.level : ["verbose", "info", "warning", "error"][legacyLevel];
        const message = typeof event.message === "string" ? event.message : legacyMessage;
        report({ event: "console", level, message, url: contents.getURL() });
    });
    contents.on("render-process-gone", (_e, details) => report({ event: "renderer-gone", reason: details.reason, url: contents.getURL() }));
    contents.on("preload-error", (_e, preloadPath, error) => report({ event: "preload-error", preloadPath, message: text(error) }));
    contents.on("did-fail-load", (_e, code, description, url, isMainFrame) => report({ event: "load-failed", code, description, url, isMainFrame }));
    contents.on("did-finish-load", () => report({ event: "loaded", url: contents.getURL() }));
});

function findContents(match) {
    const found = webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().startsWith(match));
    if (!found) throw new Error(`no page at ${match}; open: ${webContents.getAllWebContents().map((c) => c.getURL()).join(", ")}`);
    return found;
}

function findFrame(match) {
    for (const contents of webContents.getAllWebContents()) {
        if (contents.isDestroyed()) continue;
        const frame = contents.mainFrame.framesInSubtree.find((f) => f.url.startsWith(match));
        if (frame) return frame;
    }
    throw new Error(`no frame at ${match}`);
}

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
const commands = {
    eval: ({ match, code }) => findContents(match).executeJavaScript(code, true),
    evalFrame: ({ match, code }) => findFrame(match).executeJavaScript(code, true),
    main: ({ code }) => new AsyncFunction("require", "electron", "app", code)(require, electron, app),
    quit: () => {
        app.quit();
        return true;
    },
};

let buffer = "";
socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const command = JSON.parse(line);
        Promise.resolve()
            .then(() => commands[command.op](command))
            .then(
                (result) => report({ reply: command.id, result: result === undefined ? null : result }),
                (err) => report({ reply: command.id, error: text(err) }),
            );
    }
});
socket.on("error", (err) => {
    console.error("[harness] test connection failed:", err);
    app.exit(98);
});
report({ event: "harness-ready", pid: process.pid });
