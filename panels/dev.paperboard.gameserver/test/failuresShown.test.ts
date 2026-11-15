import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { problemsApi, processApi as rawProcess, type PanelProblem } from "@mileniumhq/paperapi";
import { processApi } from "../src/service/api";
import { serverCalls } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer } from "./helpers/minecraft";
import { gameServer } from "./helpers/game";
import { freePort, installPalworld } from "./helpers/palworld";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { PANEL_ID } from "../src/servers";
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { minecraftService } from "../src/games/minecraft/service";
import { palworldService } from "../src/games/palworld/service";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const INI = "saved/Config/LinuxServer/PalWorldSettings.ini";
const quote = (title: string) => `[...document.querySelectorAll("[role=alert], [class*=PaperQuote]")].find((q) => q.innerText.includes(${JSON.stringify(title)}))`;
const quoteText = (page: Page, title: string) => page.evaluate<string>(`${quote(title)}?.innerText ?? ""`);

// Failures are shown, not swallowed.
describe("failures are shown", () => {
    test("a console command or chat line sent while offline rejects and says so in the console and chat", async () => {
        const mc = minecraftServer();
        await expect(mc.run(() => sendServerCommand(mc.server, "list"))).rejects.toThrow("Cannot execute command: server is offline.");
        expect(mc.server.state.serverEntries.map((e) => [e.type, e.content])).toEqual([
            ["command", "list"],
            ["error", "Cannot execute command: server is offline."],
        ]);
        await expect(mc.run(() => minecraftService.sendChat!(mc.server, "hello"))).rejects.toThrow("Cannot send message: server is offline.");
        expect(mc.server.state.chatMessages.map((m) => m.text)).toEqual(["Cannot send message: server is offline."]);
    });

    test("a start whose server jar can't be checked says why instead of sending the user to reinstall", async () => {
        const mc = minecraftServer({ files: { "elsewhere/server.jar": "jar" } });
        fs.rmSync(path.join(mc.dir, "server.jar"));
        fs.symlinkSync(path.join(mc.dir, "elsewhere", "server.jar"), path.join(mc.dir, "server.jar"));
        const failure = await mc.run(() => startServerInstance(mc.server)).catch((err: Error) => err);
        expect(String(failure)).toContain("symbolic link");
        expect(String(failure)).not.toContain("reinstall");
    });

    test("a server that failed to start and then could not be ended says so in the console, and as the panel's problem", async () => {
        const server = gameServer("palworld", { settings: { port: await freePort(), restPort: await freePort() }, state: palworldService.initialState() });
        installPalworld(server.dir, { refuse: { info: "broken world" } });
        await server.run(() => palworldService.initialize(server.server, false));
        const kill = rawProcess.kill;
        rawProcess.kill = (async () => { throw new Error("the supervisor did not answer"); }) as typeof kill;
        try {
            await server.run(() => startServerInstance(server.server));
            await server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes("could not be ended")), "the failed kill to be reported");
        } finally {
            rawProcess.kill = kill;
        }
        expect(server.server.state.serverEntries.map((e) => String(e.content))).toContain("[Paperboard] The server that failed to start could not be ended: the supervisor did not answer");
        // the console only shows while its page is open: Paperboard shows the problem by the panel's name
        let off = () => {};
        const problem = await new Promise<PanelProblem>((resolve, reject) => {
            off = problemsApi.watch(PANEL_ID, (problems) => {
                const found = problems.find((p) => p.title.endsWith(": The server that failed to start could not be ended"));
                if (found) resolve(found);
            }, reject);
        }).finally(() => off());
        expect(problem).toMatchObject({ title: `${server.server.name}: The server that failed to start could not be ended`, message: "the supervisor did not answer" });
        const exit = server.nextExit();
        await server.run(() => processApi.kill(palworldService.primaryProcessId, "SIGKILL"));
        await exit;
    });

    test("a Palworld settings file that can't be read when the server stops is reported in the console", async () => {
        const server = gameServer("palworld", { settings: { port: await freePort(), restPort: await freePort() }, state: palworldService.initialState() });
        installPalworld(server.dir);
        await server.run(() => palworldService.initialize(server.server, false));
        await server.run(() => startServerInstance(server.server));
        await server.server.waitFor((s) => s.serverStatus === "online", "Palworld to answer its REST API");
        const ini = path.join(server.dir, ...INI.split("/"));
        fs.chmodSync(ini, 0o000);
        try {
            const exit = server.nextExit();
            await server.run(() => stopServerInstance(server.server));
            expect(await exit).toBe(0);
            await server.server.waitFor((s) => s.serverEntries.some((e) => e.content.startsWith("[Server] Could not clean up after the server stopped:")), "the failed cleanup to be reported");
        } finally {
            fs.chmodSync(ini, 0o600);
        }
        const line = server.server.state.serverEntries.find((e) => e.content.startsWith("[Server] Could not clean up"))!;
        expect(line.type).toBe("error");
        expect(line.content).toMatch(/EACCES|permission denied/i);
    });

    test("in the panel, refused commands, saves, broadcasts and chat show the service's reason", async () => {
        const restPort = await freePort();
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        const filesRoot = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS);
        const stored = (id: string, game: string, settings: Record<string, unknown>) => ({ id, name: id, game, directory: `${SERVERS}/${id}`, createdAt: 0, settings: { configured: true, ...settings } });
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [stored("s-mc", "minecraft", { software: "paper", version: "1.21.1" }), stored("s-pal", "palworld", { port: await freePort(), restPort, build: "25247047" })] }));
        installPalworld(path.join(filesRoot, "s-pal"), { refuse: { save: "disk full", announce: "chat is switched off" } });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);

        // a command typed into a stopped server's console
        const mc = await openPage(`${served.url}/?server=s-mc`);
        await mc.waitFor(`document.querySelector('input[placeholder="Enter command..."]')`, "the console");
        await mc.type('input[placeholder="Enter command..."]', "list", true);
        await mc.waitFor(quote("Command not run"), "the refused command to be shown");
        expect(await quoteText(mc, "Command not run")).toContain("Cannot execute command: server is offline.");
        expect(await mc.evaluate<string>("document.body.innerText")).toContain("Cannot execute command: server is offline.");

        // the server list message saves into a folder that can't be written
        const mcDir = path.join(filesRoot, "s-mc");
        fs.mkdirSync(mcDir, { recursive: true });
        fs.chmodSync(mcDir, 0o500);
        try {
            await mc.click('button[aria-label="Edit server list message"]');
            await mc.waitFor(`[...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Save" && !b.disabled)`, "the message to load");
            await mc.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Save").dataset.test = "motd"`);
            await mc.click('button[data-test="motd"]');
            await mc.waitFor(quote("Couldn't save"), "the refused message to be shown");
            expect(await quoteText(mc, "Couldn't save")).toContain("Paperboard isn't allowed to");
        } finally {
            fs.chmodSync(mcDir, 0o700);
        }
        await mc.close();

        const exited = new Promise<void>((resolve) => rawProcess.onExit("s-pal-palworld-server", () => resolve()));
        await serverCalls("s-pal").startServer();
        const pal = await openPage(`${served.url}/?server=s-pal`);
        try {
            await pal.waitFor(`document.body.innerText.includes("ONLINE")`, "Palworld to show online");
            await pal.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("Save world")).dataset.test = "save"`);
            await pal.click('button[data-test="save"]');
            await pal.waitFor(quote("World not saved"), "the refused save to be shown");
            expect(await quoteText(pal, "World not saved")).toContain("Palworld answered 500 to save: disk full");

            // a description that can't be written says it in a sentence, from the readable failure
            const ini = path.join(filesRoot, "s-pal", ...INI.split("/"));
            fs.chmodSync(ini, 0o000);
            try {
                await pal.click('button[aria-label="Edit description"]');
                await pal.waitFor(`document.querySelector('input[maxlength="256"]')`, "the description field");
                await pal.type('input[maxlength="256"]', "A new description");
                await pal.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Save").dataset.test = "describe"`);
                await pal.click('button[data-test="describe"]');
                await pal.waitFor(quote("Description not saved"), "the refused description to be shown");
                expect(await quoteText(pal, "Description not saved")).toContain("Paperboard isn't allowed to");
                await pal.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Cancel").dataset.test = "cancel"`);
                await pal.click('button[data-test="cancel"]');
                await pal.waitFor(`!document.querySelector('input[maxlength="256"]')`, "the dialog to close");
            } finally {
                fs.chmodSync(ini, 0o600);
            }

            await pal.type('input[placeholder="Message everyone on the server..."]', "restart soon", true);
            await pal.waitFor(quote("Message not sent"), "the refused broadcast to be shown");
            expect(await quoteText(pal, "Message not sent")).toContain("Palworld answered 500 to announce: chat is switched off");

            // the Say button sends through say-chat, and a message that did not go out comes back to the field
            await pal.click('input[name=serverMenu][value="chat"]');
            await pal.waitFor(`document.querySelector('input[placeholder="Message server..."]') && !document.querySelector('input[placeholder="Message server..."]').disabled`, "the chat field");
            const sentBefore = pal.sentFrames.length;
            await pal.type('input[placeholder="Message server..."]', "hello all");
            await pal.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("Say")).dataset.test = "say"`);
            await pal.click('button[data-test="say"]');
            await pal.waitFor(quote("Message not sent"), "the refused chat message to be shown");
            expect(await quoteText(pal, "Message not sent")).toContain("Palworld answered 500 to announce: chat is switched off");
            expect(await pal.evaluate<string>(`document.querySelector('input[placeholder="Message server..."]').value`)).toBe("hello all");
            expect(pal.sentFrames.slice(sentBefore).filter((f) => f.includes("command.call-say-chat") && f.includes("hello all"))).toHaveLength(1);
            expect([pal.exceptions, mc.exceptions]).toEqual([[], []]);
        } finally {
            await pal.close();
            await serverCalls("s-pal").stopServer();
            await exited;
            served.stop();
        }
    });
});
