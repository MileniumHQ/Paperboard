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

        // what an agent asks for ("DM pxlkt a cookie recipe", "make /cookie
        // and a flow for it") runs through the bot's project: Discord is a
        // stand-in client, everything else is the real daemon
        const sent: { to: string; content: string }[] = [];
        const member = (id: string, username: string, displayName = username) => ({ id, displayName, user: { username, bot: false } });
        const guild = (id: string, name: string, members: ReturnType<typeof member>[]) => ({
            id, name, memberCount: members.length, ownerId: members[0].id, iconURL: () => null, createdAt: new Date(0),
            channels: { cache: new Map([["300000000000000001", { id: "300000000000000001", name: "general", type: 0, parentId: null, position: 0 }]]) },
            roles: { cache: new Map([["400000000000000001", { id: "400000000000000001", name: "Bakers", color: 0, position: 1, managed: false }]]) },
            members: {
                fetch: async ({ query }: { query: string }) =>
                    new Map(members.filter((m) => m.user.username.startsWith(query) || m.displayName.startsWith(query)).map((m) => [m.id, m])),
            },
        });
        const guilds = new Map([
            ["200000000000000001", guild("200000000000000001", "Bakery", [member("500000000000000002", "pxlkt2"), member("500000000000000001", "pxlkt", "Pxl")])],
            ["200000000000000002", guild("200000000000000002", "Lounge", [member("500000000000000001", "pxlkt", "Pxl")])],
        ]);
        const discord = {
            guilds: { cache: guilds, fetch: async (gid: string) => guilds.get(gid) },
            users: { fetch: async (to: string) => ({ send: async (payload: { content: string }) => (sent.push({ to, content: payload.content }), { id: "600000000000000001" }) }) },
            channels: {
                fetch: async () => ({
                    messages: {
                        fetch: async ({ limit }: { limit: number }) =>
                            new Map([2, 1].slice(0, limit).map((n) => [`70000000000000000${n}`, {
                                id: `70000000000000000${n}`, author: { id: "500000000000000001", username: "pxlkt" }, content: `message ${n}`,
                                attachments: new Map(), createdAt: new Date(n * 1000),
                            }])),
                    },
                }),
            },
        };
        const { BotSession } = await import("../../../panels/dev.paperboard.botcreator/src/service");
        const requireClient = BotSession.prototype.requireClient;
        BotSession.prototype.requireClient = () => discord as any;
        try {
            const agentVisible = (await actionsApi.list(BOT)).filter((a) => a.project === id && a.schema?.hidden);
            expect(agentVisible.map((a) => a.action).sort()).toEqual(
                ["create-command", "delete-command", "find-member", "get-recent-messages", "get-server", "list-commands", "list-servers"].map((a) => `${id}/${a}`),
            );
            expect(await actionsApi.call(BOT, `${id}/list-servers`, {})).toEqual([
                { id: "200000000000000001", name: "Bakery", memberCount: 2 },
                { id: "200000000000000002", name: "Lounge", memberCount: 1 },
            ]);
            // the exact name first, listed once though they're in both servers
            const found = await actionsApi.call<any[]>(BOT, `${id}/find-member`, { query: "@pxlkt" });
            expect(found.map((m) => [m.userId, m.username, m.guildName])).toEqual([
                ["500000000000000001", "pxlkt", "Bakery"],
                ["500000000000000002", "pxlkt2", "Bakery"],
            ]);
            expect(await actionsApi.call(BOT, `${id}/find-member`, { query: "nobody" })).toEqual([]);
            await expect(actionsApi.call(BOT, `${id}/find-member`, { query: " " })).rejects.toThrow(/whose name/);
            expect(await actionsApi.call(BOT, `${id}/send-dm`, { user: found[0].userId, content: "Cookies: butter, sugar, flour, chips." })).toBe("600000000000000001");
            expect(sent).toEqual([{ to: "500000000000000001", content: "Cookies: butter, sugar, flour, chips." }]);

            const server = await actionsApi.call<any>(BOT, `${id}/get-server`, { guildId: "200000000000000001" });
            expect(server.channels.map((c: any) => [c.id, c.name, c.kind])).toEqual([["300000000000000001", "general", "text"]]);
            expect(server.roles).toEqual([{ id: "400000000000000001", name: "Bakers", managed: false }]);
            await expect(actionsApi.call(BOT, `${id}/get-server`, {})).rejects.toThrow(/more than one server/);
            const recent = await actionsApi.call<any[]>(BOT, `${id}/get-recent-messages`, { channel: "300000000000000001", count: 5 });
            expect(recent.map((m) => m.content)).toEqual(["message 1", "message 2"]);
            await expect(actionsApi.call(BOT, `${id}/get-recent-messages`, { channel: "300000000000000001", count: 0 })).rejects.toThrow(/from 1 to 50/);

            // a command made for a flow says which event the flow starts from
            const cookie = await actionsApi.call<any>(BOT, `${id}/create-command`, { name: "Cookie", description: "A cookie recipe", options: [{ name: "kind", description: "Which cookie", type: "string" }] });
            expect(cookie).toMatchObject({ event: `${id}/command:global:cookie`, registered: false, triggerError: null, command: { name: "cookie", scope: "global" } });
            const event = (await actionsApi.list(BOT)).find((a) => a.action === cookie.event);
            expect(event?.schema?.eventOnly).toBe(true);
            expect(Object.keys(event?.schema?.outputFields ?? {})).toContain("values.kind");
            expect((await actionsApi.call<any[]>(BOT, `${id}/list-commands`, {})).map((c) => [c.name, c.event])).toContainEqual(["cookie", cookie.event]);
            await expect(actionsApi.call(BOT, `${id}/create-command`, { name: "cookie", description: "again" })).rejects.toThrow(/already exists/);
            expect((await actionsApi.call<any>(BOT, `${id}/delete-command`, { id: cookie.command.id })).event).toBe(cookie.event);
            expect((await actionsApi.list(BOT)).find((a) => a.action === cookie.event)).toBeUndefined();
        } finally {
            BotSession.prototype.requireClient = requireClient;
        }

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
