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
        // what reached "Discord", by what the bot did
        const did: unknown[][] = [];
        const roleOf = (id: string, name: string, position: number) => ({ id, name, color: 0, position, managed: false, members: new Map() });
        const member = (id: string, username: string, displayName = username) => ({
            id, displayName, nickname: displayName === username ? null : displayName, joinedAt: new Date(0), communicationDisabledUntil: null, voice: { channelId: null },
            user: { username, bot: false },
            roles: { cache: new Map<string, any>() },
            guild: null as any,
            setNickname: async (nick: string | null) => void did.push(["nickname", id, nick]),
            timeout: async (ms: number | null) => void did.push(["timeout", id, ms]),
        });
        const guild = (id: string, name: string, members: ReturnType<typeof member>[]) => {
            const bakers = { ...roleOf("400000000000000001", "Bakers", 1), edit: async (changes: unknown) => void did.push(["edit-role", changes]) };
            const everyone = roleOf(id, "@everyone", 0);
            const g: any = {
                id, name, memberCount: members.length, ownerId: members[0].id, iconURL: () => null, createdAt: new Date(0),
                channels: { cache: new Map([["300000000000000001", { id: "300000000000000001", name: "general", type: 0, parentId: null, position: 0 }]]) },
                roles: { cache: new Map([["400000000000000001", bakers]]), fetch: async (rid: string) => (rid === bakers.id ? bakers : null) },
                members: {
                    fetch: async (q?: string | { query: string }) =>
                        typeof q === "string" ? members.find((m) => m.id === q)
                        : new Map(members.filter((m) => !q || m.user.username.startsWith(q.query) || m.displayName.startsWith(q.query)).map((m) => [m.id, m])),
                },
                scheduledEvents: { create: async (options: any) => (did.push(["event", options.name, options.entityType]), { url: `https://discord.com/events/${id}/800000000000000001` }) },
            };
            for (const m of members) {
                m.guild = g;
                m.roles.cache.set(everyone.id, everyone);
                m.roles.cache.set(bakers.id, bakers);
                bakers.members.set(m.id, m);
            }
            return g;
        };
        const guilds = new Map([
            ["200000000000000001", guild("200000000000000001", "Bakery", [member("500000000000000002", "pxlkt2"), member("500000000000000001", "pxlkt", "Pxl")])],
            ["200000000000000002", guild("200000000000000002", "Lounge", [member("500000000000000001", "pxlkt", "Pxl")])],
        ]);
        const poll = { question: { text: "Best cookie?" }, resultsFinalized: false, expiresTimestamp: Date.now() + 60_000,
            answers: new Map([[1, { text: "Chocolate chip", voteCount: 3 }], [2, { text: "Oatmeal", voteCount: 1 }]]) };
        const pinned = (n: number) => ({
            id: `70000000000000000${n}`, author: { id: "500000000000000001", username: "pxlkt" }, content: `message ${n}`,
            attachments: new Map(), createdAt: new Date(n * 1000),
            poll: n === 1 ? poll : null,
            reactions: { cache: new Map([["🍪", { emoji: { id: null, name: "🍪" }, count: 1, users: { fetch: async () => new Map([["500000000000000001", { id: "500000000000000001", username: "pxlkt" }]]) } }]]) },
        });
        const general = {
            id: "300000000000000001",
            guild: guilds.get("200000000000000001"),
            send: async (payload: any) => (did.push(["send", payload]), { id: "600000000000000002" }),
            sendTyping: async () => void did.push(["typing"]),
            permissionOverwrites: { edit: async (target: string, changes: unknown) => void did.push(["permissions", target, changes]) },
            messages: {
                fetch: async (q: string | { limit: number }) =>
                    typeof q === "string" ? pinned(Number(q.slice(-1))) : new Map([2, 1].slice(0, q.limit).map((n) => [`70000000000000000${n}`, pinned(n)])),
                fetchPins: async () => ({ hasMore: false, items: [{ message: pinned(1), pinnedAt: new Date(5000) }] }),
            },
        };
        const discord = {
            guilds: { cache: guilds, fetch: async (gid: string) => guilds.get(gid) },
            users: { fetch: async (to: string) => ({ send: async (payload: { content: string }) => (sent.push({ to, content: payload.content }), { id: "600000000000000001" }) }) },
            channels: { fetch: async (cid: string) => (cid === "300000000000000009" ? { id: cid, type: 2 } : general) },
        };
        const { BotSession } = await import("../../../panels/dev.paperboard.botcreator/src/service");
        const requireClient = BotSession.prototype.requireClient;
        BotSession.prototype.requireClient = () => discord as any;
        try {
            const agentVisible = (await actionsApi.list(BOT)).filter((a) => a.project === id && a.schema?.hidden);
            expect(agentVisible.map((a) => a.action).sort()).toEqual(
                ["create-command", "delete-command", "find-member", "get-member", "get-pinned-messages", "get-poll-results", "get-reactions",
                    "get-recent-messages", "get-server", "list-commands", "list-role-members", "list-servers"].map((a) => `${id}/${a}`),
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

            // polls, files and typing reach the channel; a bad one never does
            const call = (action: string, inputs: unknown) => actionsApi.call<any>(BOT, `${id}/${action}`, inputs);
            expect(await call("send-poll", { channel: "300000000000000001", question: "Best cookie?", answers: "Chocolate chip\nOatmeal" })).toBe("600000000000000002");
            await expect(call("send-poll", { channel: "300000000000000001", question: "Best cookie?", answers: "" })).rejects.toThrow(/at least one answer/);
            expect(await call("get-poll-results", { channel: "300000000000000001", message: "700000000000000001" })).toEqual({
                question: "Best cookie?", closed: false, answers: [{ text: "Chocolate chip", votes: 3 }, { text: "Oatmeal", votes: 1 }],
            });
            await expect(call("get-poll-results", { channel: "300000000000000001", message: "700000000000000002" })).rejects.toThrow(/isn't a poll/);
            await call("send-file", { channel: "300000000000000001", url: "https://example.com/cookies.png", content: "Fresh" });
            await expect(call("send-file", { channel: "300000000000000001", url: "/etc/passwd" })).rejects.toThrow(/isn't a web address/);
            await call("show-typing", { channel: "300000000000000001" });
            expect(await call("get-pinned-messages", { channel: "300000000000000001" })).toEqual([
                { id: "700000000000000001", author: "pxlkt", authorId: "500000000000000001", content: "message 1", pinnedAt: new Date(5000).toISOString() },
            ]);
            expect(await call("get-reactions", { channel: "300000000000000001", message: "700000000000000001" })).toEqual([
                { emoji: "🍪", count: 1, users: [{ userId: "500000000000000001", username: "pxlkt" }] },
            ]);

            // members, roles and channels
            expect(await call("get-member", { user: "500000000000000001", guildId: "200000000000000002" })).toMatchObject({
                username: "pxlkt", nickname: "Pxl", roles: [{ id: "400000000000000001", name: "Bakers" }], timedOutUntil: null, guildId: "200000000000000002",
            });
            expect(await call("list-role-members", { role: "400000000000000001", guildId: "200000000000000001" })).toMatchObject({
                role: { name: "Bakers" }, total: 2,
            });
            await call("set-nickname", { user: "500000000000000001", nickname: "Cookie Monster", guildId: "200000000000000001" });
            await call("set-nickname", { user: "500000000000000001", nickname: "", guildId: "200000000000000001" });
            await call("remove-timeout", { user: "500000000000000001", guildId: "200000000000000001" });
            await call("edit-role", { role: "400000000000000001", name: "Head Bakers", mentionable: true, guildId: "200000000000000001" });
            await expect(call("edit-role", { role: "400000000000000001", guildId: "200000000000000001" })).rejects.toThrow(/needs a name/);
            await call("set-channel-permissions", { channel: "300000000000000001", target: "everyone", deny: "SendMessages" });
            await expect(call("set-channel-permissions", { channel: "300000000000000001", target: "everyone", deny: "SendMesages" })).rejects.toThrow(/Unknown Discord permission/);
            const start = new Date(Date.now() + 3_600_000).toISOString();
            expect(await call("create-event", { name: "Bake-off", start, channel: "300000000000000009", guildId: "200000000000000001" }))
                .toBe("https://discord.com/events/200000000000000001/800000000000000001");
            await expect(call("create-event", { name: "Bake-off", start, location: "Kitchen", guildId: "200000000000000001" })).rejects.toThrow(/needs an end/);
            expect(did.map((d) => d[0] === "send" ? ["send", Object.keys(d[1] as object).sort()] : d)).toEqual([
                ["send", ["poll"]],
                ["send", ["content", "files"]],
                ["typing"],
                ["nickname", "500000000000000001", "Cookie Monster"],
                ["nickname", "500000000000000001", null],
                ["timeout", "500000000000000001", null],
                ["edit-role", { name: "Head Bakers", mentionable: true }],
                ["permissions", "200000000000000001", { SendMessages: false }],
                ["event", "Bake-off", 2],
            ]);
            // the newer actions only ever lived in a bot's project: no old-id forwarders
            expect((await actionsApi.list(BOT)).find((a) => a.action === "send-poll")).toBeUndefined();

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
