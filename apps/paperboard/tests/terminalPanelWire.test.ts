// The Terminal panel's service over the real daemon (bun test, real shell).
// Its saved scrollback used to be every shell's output glued together: each
// launch started a new shell and appended its prompt to the last line of the
// old one, and a tab whose shell the service created recorded every chunk
// twice. A new shell now starts a new scrollback, and each chunk lands once.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi } from "@mileniumhq/paperapi";

const PANEL = "dev.paperboard.terminal";

async function until(check: () => Promise<boolean>, what: string) {
    const deadline = Date.now() + 10_000;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await Bun.sleep(20);
    }
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

test("a new shell starts a new scrollback, and every chunk is saved once", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-panel-wire-"));
    const bunExecutable = process.execPath;
    const launcherSource = path.join(root, "supervisor.ts");
    const launcher = path.join(root, process.platform === "win32" ? "supervisor.exe" : "supervisor");
    fs.writeFileSync(
        launcherSource,
        `import { runSupervisor } from ${JSON.stringify(path.resolve(import.meta.dir, "../papercrane/supervisor.ts"))}; await runSupervisor(process.argv.at(-1)!);`,
    );
    const build = Bun.spawnSync([bunExecutable, "build", launcherSource, "--compile", "--outfile", launcher]);
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
    process.execPath = launcher;
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    const shells: string[] = ["tab1"];
    try {
        // what a quit leaves behind: the tab, and the dead shell's screen
        const panelFiles = path.join(root, "files", PANEL);
        fs.mkdirSync(path.join(panelFiles, "terminal-scrollback"), { recursive: true });
        fs.writeFileSync(path.join(panelFiles, "tabs.json"), JSON.stringify({ tabs: [{ id: "tab1", label: "Tab 1" }], activeTabId: "tab1" }));
        fs.writeFileSync(path.join(panelFiles, "terminal-scrollback", "tab1.log"), "OLD SHELL OUTPUT\r\n$ ");

        await initPaperApi({
            port: (wss.address() as any).port,
            token: auth.issuePanelToken(PANEL),
            computerId: "local",
            panelId: PANEL,
        });
        const { terminalService } = await import("../../../panels/dev.paperboard.terminal/src/service");
        await terminalService.ready;

        const scrollback = await actionsApi.call<string>(PANEL, "open-tab", { id: "tab1", cols: 80, rows: 24 });
        expect(scrollback).not.toContain("OLD SHELL OUTPUT");

        const buffer = (tabId: string) => actionsApi.call<string>(PANEL, "read-terminal-buffer", { tabId, lines: 200 });
        await actionsApi.call(PANEL, "write-to-terminal", { tabId: "tab1", text: "echo first-$((40+2))\r" });
        await until(async () => (await buffer("tab1")).includes("first-42"), "the restored tab's echo");
        expect(count(await buffer("tab1"), "first-42")).toBe(1);

        // a tab the service creates, then subscribes to
        const created = await actionsApi.call<string>(PANEL, "create-tab", { label: "New" });
        shells.push(created);
        await actionsApi.call(PANEL, "write-to-terminal", { tabId: created, text: "echo second-$((40+2))\r" });
        await until(async () => (await buffer(created)).includes("second-42"), "the new tab's echo");
        expect(count(await buffer(created), "second-42")).toBe(1);

        // the shell ends; the next keystrokes start a new one on a clean screen
        await actionsApi.call(PANEL, "write-to-terminal", { tabId: "tab1", text: "exit\r" });
        await until(async () => !(await engine.isTerminalRunning("tab1")), "the shell to exit");
        await actionsApi.call(PANEL, "write-to-terminal", { tabId: "tab1", text: "echo third-$((40+2))\r" });
        await until(async () => (await buffer("tab1")).includes("third-42"), "the new shell's echo");
        expect(await buffer("tab1")).not.toContain("first-42");
        await until(
            async () => !fs.readFileSync(path.join(panelFiles, "terminal-scrollback", "tab1.log"), "utf8").includes("first-42"),
            "the saved scrollback to start over",
        );
    } finally {
        // through the panel, so its pending scrollback writes are cancelled
        for (const id of shells) await actionsApi.call(PANEL, "close-tab", { id });
        process.execPath = bunExecutable;
        closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 45_000);
