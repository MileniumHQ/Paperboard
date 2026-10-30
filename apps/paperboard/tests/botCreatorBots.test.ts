import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, config, secretsApi, WIDGET_CHOICES_ACTION } from "@mileniumhq/paperapi";

const BOT = "dev.paperboard.botcreator";
// a token's first part is its application id in base64; nothing here logs in
const tokenFor = (applicationId: string) => `${btoa(applicationId)}.fixture.fixture`;

test("Bot Creator over the real daemon: the old bot becomes a project, old blocks forward to it, and bots come and go", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-wire-"));
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    try {
        await initPaperApi({ port: (wss.address() as any).port, token: auth.issuePanelToken(BOT), computerId: "local", panelId: BOT });
        // the one bot from before several bots, set up without a token in the
        // vault, so it never reaches Discord
        const ping = { id: "c1", name: "ping", description: "Pings", scope: "global", options: [], userInstall: false };
        await config.set({ configured: true, applicationId: "100000000000000001", commands: [ping] }, BOT);

        const { botService, LEGACY_DEPRECATION } = await import("../../../panels/dev.paperboard.botcreator/src/service");
        await botService.ready;

        // it became a bot of its own, with its commands, and the config says so
        const saved = await config.get<any>(BOT);
        expect(saved.configured).toBeUndefined();
        expect(saved.bots).toHaveLength(1);
        const id = saved.bots[0].id as string;
        expect(saved.legacyBot).toBe(id);
        expect(saved.bots[0]).toMatchObject({ applicationId: "100000000000000001", enabled: true, commands: [ping] });
        expect(botService.getState().bots.map((b: any) => [b.id, b.hasToken])).toEqual([[id, false]]);

        // its actions are its project's; the builders stay global; the old
        // ids are deprecated forwarders
        expect((await actionsApi.listProjects(BOT)).map((p) => [p.id, p.name, p.icon])).toEqual([[id, "Discord bot", "smart_toy"]]);
        const listed = await actionsApi.list(BOT);
        const find = (action: string) => listed.find((a) => a.action === action);
        expect(find(`${id}/send-message`)?.project).toBe(id);
        expect(find(`${id}/on-message`)?.project).toBe(id);
        expect(find(`${id}/command:global:ping`)?.project).toBe(id);
        expect(find("send-message")?.schema?.deprecated).toBe(LEGACY_DEPRECATION);
        expect(find("on-message")?.schema?.deprecated).toBe(LEGACY_DEPRECATION);
        expect(find("command:global:ping")?.schema?.deprecated).toBe(LEGACY_DEPRECATION);
        expect(find("create-embed")?.project).toBeUndefined();
        expect(find("create-embed")?.schema?.deprecated).toBeUndefined();
        expect(find(`${id}/create-embed`)).toBeUndefined();

        // both the project's action and the old one run as that bot
        await expect(actionsApi.call(BOT, `${id}/send-message`, { channel: "1", content: "hi" })).rejects.toThrow(/not connected/);
        await expect(actionsApi.call(BOT, "send-message", { channel: "1", content: "hi" })).rejects.toThrow(/not connected/);

        // a widget placed before several bots answers for that bot
        expect(await actionsApi.call<any>(BOT, "get-widget-status", {})).toMatchObject({ configured: false, connected: false });
        expect(await actionsApi.call<any>(BOT, WIDGET_CHOICES_ACTION, { widgetId: "bot-status", optionId: "bot" })).toEqual([{ value: id, label: "Discord bot" }]);

        // a new command is the bot's event, and the old id's for its old flows
        const created = await actionsApi.call<any>(BOT, "create-command", { bot: id, name: "hello", description: "Says hello" });
        expect(created).toMatchObject({ registered: false, triggerError: null });
        const afterCreate = await actionsApi.list(BOT);
        expect(afterCreate.find((a) => a.action === `${id}/command:global:hello`)?.project).toBe(id);
        expect((await config.get<any>(BOT)).bots[0].commands.map((c: any) => c.name)).toEqual(["ping", "hello"]);

        // a token that isn't one, or is a bot already here, is refused before
        // any login, and its vault entry doesn't stay behind
        await secretsApi.set("bot-token.b-junk", "not a token", BOT);
        await expect(actionsApi.call(BOT, "add-bot", { bot: "b-junk" })).rejects.toThrow(/isn't a Discord bot token/);
        expect((await secretsApi.get("bot-token.b-junk", BOT)).found).toBe(false);
        await secretsApi.set("bot-token.b-twin", tokenFor("100000000000000001"), BOT);
        await expect(actionsApi.call(BOT, "add-bot", { bot: "b-twin" })).rejects.toThrow(/already uses this bot/);
        expect((await secretsApi.get("bot-token.b-twin", BOT)).found).toBe(false);
        expect((await actionsApi.listProjects(BOT)).map((p) => p.id)).toEqual([id]);

        // deleting the bot takes its project, its forwarders and its token
        await secretsApi.set(`bot-token.${id}`, tokenFor("100000000000000001"), BOT);
        expect(await actionsApi.call(BOT, "delete-bot", { bot: id })).toEqual({ deleted: id });
        expect(await actionsApi.listProjects(BOT)).toEqual([]);
        const left = (await actionsApi.list(BOT)).map((a) => a.action);
        expect(left.filter((a) => a.startsWith(`${id}/`))).toEqual([]);
        expect(left).not.toContain("send-message");
        expect(left).not.toContain("command:global:ping");
        expect(left).toContain("create-embed");
        expect((await secretsApi.get(`bot-token.${id}`, BOT)).found).toBe(false);
        const afterDelete = await config.get<any>(BOT);
        expect(afterDelete.bots).toEqual([]);
        expect(afterDelete.legacyBot).toBeUndefined();
        await expect(actionsApi.call(BOT, "get-widget-status", {})).rejects.toThrow(/No bot is chosen/);
        await expect(actionsApi.call(BOT, "get-health", { bot: id })).rejects.toThrow(/deleted/);
    } finally {
        closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 30_000);
