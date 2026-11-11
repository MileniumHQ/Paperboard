// Bot Creator's blocks (Actions API v2), used the way the Blocks panel uses
// them: through the real daemon, from the service, against a loopback Discord.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi, memoryBlocks, type BlockEventDefinition } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import { blockEvent, blockTypes, commandEvent, commandEventId, staticEvents } from "../src/blocks";
import { GLOBAL_SCOPE, type SlashCommandDefinition } from "../src/types";
import { guild, slashCommand, snowflake, startFakeDiscord, userMessage, type FakeBot, type FakeDiscord, type FakeGuild } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, storedBot, stopServices } from "./helpers/service";
import { stateWhere, within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const BOT = "b-blocks";
const type = (id: string) => `${PANEL_ID}:${id}`;
const run = <T = any>(command: string, inputs: Record<string, unknown>) => blocksApi.run<T>(PANEL_ID, command, inputs, { project: BOT });
const read = <T = any>(value: string, inputs?: Record<string, unknown>) => blocksApi.read<T>(PANEL_ID, value, inputs, { project: BOT });

const TYPES = [
    "bot", "channel", "command-option", "component", "embed", "interaction", "member", "message", "poll", "poll-answer", "reaction", "role",
    "server", "slash-command", "text-field", "user",
];
// the panel's own: the builders, and the blocks that run Bot Creator itself (botsBlocks.test.ts)
const PANEL_COMMANDS = [
    "add-bot", "create-button", "create-command-option", "create-embed", "create-interaction-row", "create-select-menu", "create-slash-command",
    "create-text-field", "delete-bot", "delete-slash-command", "replace-bot-token", "restart-bot", "turn-off-bot", "turn-on-bot",
];
const PANEL_VALUES = ["bot", "bots", "invite-link"];
const PANEL_EVENTS = ["bot-added", "bot-connection-failed", "bot-deleted", "bot-offline", "bot-online"];
const COMMANDS = [
    "add-reaction", "add-role", "ban-user", "create-channel", "create-event", "create-invite", "create-role", "create-thread",
    "crosspost-message", "delete-channel", "delete-message", "delete-role", "disconnect-member", "edit-message", "edit-thread",
    "follow-up-interaction", "kick-member", "leave-server", "move-member", "pin-message", "purge-messages", "remove-reaction", "remove-role",
    "remove-timeout", "rename-channel", "rename-role", "reply-to-message", "respond-to-interaction", "send-dm", "send-file",
    "send-message", "send-poll", "set-activity", "set-channel-permissions", "set-channel-topic", "set-nickname", "set-role-color",
    "set-role-display", "set-slowmode", "show-modal", "show-typing", "timeout-member", "unban-user", "unpin-message",
];
const VALUES = [
    "bot-user", "command-last-used", "command-uses", "commands-last-day", "connected", "find-members", "latency", "member", "message",
    "recent-messages", "server-count", "servers", "status", "uptime",
];
const EVENTS = [
    "bot-joined-server", "bot-left-server", "bot-ready", "channel-created", "channel-deleted", "component-used", "connection-failed",
    "member-banned", "member-joined", "member-left", "member-roles-changed", "member-unbanned", "message-deleted", "message-edited",
    "message-received", "modal-submitted", "nickname-changed", "reaction-added", "reaction-removed", "role-added", "role-created",
    "role-deleted", "role-removed", "thread-created", "voice-changed",
];

// every static trigger a session fires (session.ts attachListeners), as Actions names them
const TRIGGERS = [
    "on-message", "on-member-join", "on-member-leave", "on-reaction-add", "on-connection-error", "interaction-triggered",
    "modal-submitted", "on-message-edited", "on-message-deleted", "on-reaction-removed", "on-member-banned", "on-role-added",
    "on-role-removed", "on-thread-created", "on-voice-state-change", "on-bot-ready", "on-guild-joined", "on-guild-left",
    "on-channel-created", "on-channel-deleted", "on-role-created", "on-role-deleted", "on-member-roles-changed", "on-member-unbanned",
    "on-nickname-changed",
];

/** Resolves with the next payload the bot's event fires. */
function nextEvent(event: string): { payload: Promise<Record<string, unknown>>; ready: Promise<void> } {
    let off = () => {};
    const payload = within(`${event} to fire`, new Promise<Record<string, unknown>>((resolve) => {
        off = blocksApi.onEvent(PANEL_ID, event, resolve, BOT);
    })).finally(() => off());
    // a subscription reaches the daemon on its own; let it land first
    return { payload, ready: new Promise((resolve) => setTimeout(resolve, 300)) };
}

describe("each trigger a session fires is one of the bot's Blocks events, with a payload of its types", () => {
    // fired through PaperAPI's own checks, in memory: the payload is every value the event declares, of its type
    const firesAs = async (event: BlockEventDefinition, payload: Record<string, unknown>) => {
        expect(Object.keys(payload).sort()).toEqual(Object.keys(event.values ?? {}).sort());
        const memory = memoryBlocks(PANEL_ID);
        await memory.panel.register({ types: blockTypes(() => []) });
        const bot = await memory.defineProject({ id: "bot", name: "Bot" });
        await bot.register({ events: [event] });
        await bot.fire(event.id, payload);
    };

    test("every static trigger, even with nothing in its payload", async () => {
        const mapped = new Set<string>();
        for (const trigger of TRIGGERS) {
            const { event, payload } = blockEvent(trigger, {}, []);
            const definition = staticEvents.find((e) => e.id === event);
            expect([trigger, definition?.id]).toEqual([trigger, event]);
            await firesAs(definition!, payload);
            mapped.add(event);
        }
        expect([...mapped].sort()).toEqual(EVENTS);
    });

    test("a slash command, its options typed, and an optional one not given is none", async () => {
        const command: SlashCommandDefinition = {
            id: "c1",
            name: "give_role",
            description: "Give a role",
            scope: GLOBAL_SCOPE,
            userInstall: false,
            options: [
                { id: "o1", name: "user", description: "Who", type: "user", required: true },
                { id: "o2", name: "days", description: "How long", type: "integer", required: false },
            ],
        };
        const event = commandEvent(command);
        expect(event.id).toBe(commandEventId(command));
        expect(event.values).toMatchObject({ "option-user": { type: "user", name: "user" }, "option-days": { type: "number", name: "days", optional: true } });
        const { payload } = blockEvent("command:global:give_role", { interactionId: "1", userId: "2", channelId: "3", guildId: null, values: { user: "123456789012345678" } }, [command]);
        await firesAs(event, payload);
        expect(payload).toMatchObject({ "option-user": "123456789012345678", "option-days": null, server: null });
        expect(() => blockEvent("command:global:gone", {}, [command])).toThrow("The trigger command:global:gone has no Blocks event");
        // the same name in another scope is another event; the same scope and name is the same one
        expect(commandEventId({ scope: "123456789012345678", name: "give_role" })).not.toBe(event.id);
        expect(commandEventId({ scope: GLOBAL_SCOPE, name: "give_role" })).toBe(event.id);
    });
});

describe("a bot is a Blocks project, used through the daemon", () => {
    let discord: FakeDiscord;
    let fake: FakeBot;
    let home: FakeGuild;
    beforeAll(async () => {
        discord = startFakeDiscord();
        home = guild("Home");
        fake = discord.addBot({ username: "Blocky", guilds: [home] });
        await savedBots([{ stored: storedBot(BOT, fake.appId), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");
    });
    afterAll(async () => {
        await stopServices();
        discord.stop();
    });

    test("the panel has the types, builders and bot blocks; the bot's project has its commands, values and events", async () => {
        expect(await blocksApi.projects(PANEL_ID)).toEqual([{ panelId: PANEL_ID, id: BOT, name: "Blocky", icon: "smart_toy" }]);
        const entries = (await blocksApi.list(PANEL_ID)).map((b) => b.entry).sort();
        expect(entries).toEqual(
            [
                ...TYPES.map((id) => `type.${id}`),
                ...PANEL_COMMANDS.map((id) => `command.${id}`),
                ...PANEL_VALUES.map((id) => `value.${id}`),
                ...PANEL_EVENTS.map((id) => `event.${id}`),
                ...COMMANDS.map((id) => `${BOT}/command.${id}`),
                ...VALUES.map((id) => `${BOT}/value.${id}`),
                ...EVENTS.map((id) => `${BOT}/event.${id}`),
            ].sort(),
        );
        const send = (await blocksApi.list(PANEL_ID)).find((b) => b.entry === `${BOT}/command.send-message`)!;
        expect(send.schema).toMatchObject({
            text: "Send {content} to {channel} with {embeds} and {components}",
            category: "Messages",
            categoryIcon: "chat",
            inputs: { channel: { type: type("channel"), name: "Channel" }, embeds: { type: `list<${type("embed")}>` } },
            output: type("message"),
        });
        // every section has the symbol the panel declared for it
        const missing = (await blocksApi.list(PANEL_ID)).filter((b) => b.schema.kind !== "type" && "category" in b.schema && b.schema.category && !b.schema.categoryIcon).map((b) => b.entry);
        expect(missing).toEqual([]);
    });

    test("Send Message gives the Message, whose fields read what Discord has", async () => {
        const channel = home.channels[0].id;
        const sent = await run<{ id: string; channel: string }>("send-message", { content: "hello", channel: `<#${channel}>` });
        expect(sent).toEqual({ id: expect.stringMatching(/^\d+$/), channel });
        const [request] = discord.requests.filter((r) => r.method === "POST" && r.path === `/channels/${channel}/messages`);
        expect(request.body).toMatchObject({ content: "hello" });

        expect(await blocksApi.property(type("message"), "content", sent)).toBe("hello");
        expect(await blocksApi.property(type("message"), "author", sent)).toBe(fake.appId);
        expect(await blocksApi.property(type("message"), "channel", sent)).toBe(channel);
        expect(await blocksApi.property(type("channel"), "name", channel)).toBe("general");
        expect(await blocksApi.property(type("channel"), "server", channel)).toBe(home.id);
        expect(await blocksApi.property(type("server"), "name", home.id)).toBe("Home");
        expect(await blocksApi.property(type("user"), "username", fake.appId)).toBe("Blocky");
        expect(await blocksApi.property(type("member"), "display-name", { user: fake.appId, server: home.id })).toBe("Blocky");
        expect(await read("message", { id: sent.id, channel })).toEqual(sent);
    });

    test("what a block can't do fails, saying why, and never reaches Discord", async () => {
        const before = discord.requests.length;
        await expect(run("send-message", { content: "hello", channel: "general" })).rejects.toThrow('"general" isn\'t a Channel ID');
        await expect(run("send-message", { channel: home.channels[0].id })).rejects.toThrow('Send Message: "Content" is required');
        await expect(run("create-invite", { channel: home.channels[0].id, uses: 500 })).rejects.toThrow('"Uses" must be at most 100');
        await expect(blocksApi.property(type("server"), "name", "999999999999999999")).rejects.toThrow("None of the connected bots can see server 999999999999999999");
        expect(discord.requests.length).toBe(before);
        await expect(blocksApi.run(PANEL_ID, "create-button", { style: "primary", label: "Go", disabled: false })).rejects.toThrow('The primary button "Go" needs a Component ID');
        expect(await blocksApi.run(PANEL_ID, "create-button", { style: "primary", label: "Go", "component-id": "go", disabled: false })).toMatchObject({ kind: "button", customId: "go" });
    });

    test("the bot's values read its live state", async () => {
        expect(await read("connected")).toBe(true);
        expect(await read("servers")).toEqual([home.id]);
        expect(await read("server-count")).toBe(1);
        expect(await read("bot-user")).toBe(fake.appId);
        expect(await read("member", { user: fake.appId })).toEqual({ user: fake.appId, server: home.id });
    });

    test("a message someone posts fires When a Message Is Received with its typed values", async () => {
        const received = nextEvent("message-received");
        await received.ready;
        const posted = userMessage(home, "hi bot");
        discord.dispatch(fake, "MESSAGE_CREATE", posted);
        expect(await received.payload).toEqual({
            message: { id: posted.id, channel: posted.channel_id },
            content: "hi bot",
            author: posted.author.id,
            channel: posted.channel_id,
            server: home.id,
        });
    });

    test("a slash command made in the panel is an event, fired with its options, and gone once deleted", async () => {
        const created = await call("create-command", { bot: BOT, name: "roll", description: "Roll a die", options: [{ name: "sides", description: "How many sides", type: "integer", required: true }] });
        expect(created).toMatchObject({ registered: true, triggerError: null });
        const event = commandEventId({ scope: GLOBAL_SCOPE, name: "roll" });
        const listed = (await blocksApi.list(PANEL_ID)).find((b) => b.entry === `${BOT}/event.${event}`);
        expect(listed?.schema).toMatchObject({ name: "When /roll Is Used", values: { "option-sides": { type: "number", name: "sides" } } });

        const used = nextEvent(event);
        await used.ready;
        const interaction = slashCommand(fake, { guild: home, name: "roll", options: [{ name: "sides", type: 4, value: 20 }] });
        discord.dispatch(fake, "INTERACTION_CREATE", interaction);
        expect(await used.payload).toMatchObject({ interaction: interaction.id, channel: home.channels[0].id, server: home.id, "option-sides": 20 });

        await call("delete-command", { bot: BOT, id: created.command.id });
        expect((await blocksApi.list(PANEL_ID)).some((b) => b.entry === `${BOT}/event.${event}`)).toBe(false);
    });

    test("the bot's health and slash command use read what its session counted", async () => {
        expect(await read("status")).toBe("online");
        expect(await read<number>("uptime")).toBeGreaterThan(0);

        const created = await call("create-command", { bot: BOT, name: "ping", description: "Ping the bot", options: [] });
        const event = commandEventId({ scope: GLOBAL_SCOPE, name: "ping" });
        try {
            expect(await blocksApi.choices(PANEL_ID, `${BOT}/value.command-uses`, "command")).toEqual([{ label: "/ping", value: event }]);
            expect(await read("command-uses", { command: event })).toBe(0);
            await expect(read("command-last-used", { command: event })).rejects.toThrow("/ping hasn't been used since Bot Creator started");
            await expect(read("command-uses", { command: "slash-gone-0000000000" })).rejects.toThrow('"Slash Command" must be one of /ping');
            const today = await read<number>("commands-last-day");

            const used = nextEvent(event);
            await used.ready;
            const before = Date.now();
            discord.dispatch(fake, "INTERACTION_CREATE", slashCommand(fake, { guild: home, name: "ping" }));
            await used.payload;
            expect(await read("command-uses", { command: event })).toBe(1);
            const last = await read<number>("command-last-used", { command: event });
            expect(last).toBeGreaterThanOrEqual(before);
            expect(last).toBeLessThanOrEqual(Date.now());
            expect(await read("commands-last-day")).toBe(today + 1);
        } finally {
            await call("delete-command", { bot: BOT, id: created.command.id });
        }
    });

    test("Discord's server, channel, role and member changes fire the bot's events with typed values", async () => {
        const other: FakeGuild = { ...guild("Other"), owner: snowflake() };
        const someone = { id: snowflake(), username: "someone", discriminator: "0", global_name: null, avatar: null };
        const role = { id: snowflake(), name: "Mods", color: 0, hoist: false, position: 1, permissions: "0", managed: false, mentionable: false, flags: 0 };
        const channel = { id: snowflake(), type: 0, guild_id: other.id, name: "news", position: 1, permission_overwrites: [], parent_id: null, nsfw: false };
        const member = (extra: Record<string, unknown>) => ({ guild_id: other.id, user: someone, roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false, flags: 0, ...extra });
        const names = [
            "bot-joined-server", "channel-created", "channel-deleted", "role-created", "member-joined", "member-roles-changed", "nickname-changed",
            "role-deleted", "member-unbanned", "bot-left-server",
        ];
        const events = Object.fromEntries(names.map((name) => [name, nextEvent(name)]));
        await Promise.all(Object.values(events).map((e) => e.ready));
        const next = (name: string) => events[name]!.payload;

        discord.joinGuild(fake, other);
        expect(await next("bot-joined-server")).toEqual({ server: other.id, name: "Other" });
        expect(await read("servers")).toEqual([home.id, other.id]);

        discord.dispatch(fake, "CHANNEL_CREATE", channel);
        const news = { channel: channel.id, name: "news", kind: "text", server: other.id };
        expect(await next("channel-created")).toEqual(news);
        discord.dispatch(fake, "CHANNEL_DELETE", channel);
        expect(await next("channel-deleted")).toEqual(news);

        discord.dispatch(fake, "GUILD_ROLE_CREATE", { guild_id: other.id, role });
        expect(await next("role-created")).toEqual({ role: role.id, name: "Mods", server: other.id });

        // a member the bot has seen, so Discord's update says what changed
        discord.dispatch(fake, "GUILD_MEMBER_ADD", member({}));
        await next("member-joined");
        discord.dispatch(fake, "GUILD_MEMBER_UPDATE", member({ roles: [role.id], nick: "Ace" }));
        const asMember = { member: { user: someone.id, server: other.id }, user: someone.id, server: other.id };
        expect(await next("member-roles-changed")).toEqual({ ...asMember, added: [role.id], removed: [] });
        expect(await next("nickname-changed")).toEqual({ ...asMember, nickname: "Ace", "previous-nickname": null });

        discord.dispatch(fake, "GUILD_ROLE_DELETE", { guild_id: other.id, role_id: role.id });
        expect(await next("role-deleted")).toEqual({ role: role.id, name: "Mods", server: other.id });

        discord.dispatch(fake, "GUILD_BAN_REMOVE", { guild_id: other.id, user: someone });
        expect(await next("member-unbanned")).toEqual({ user: someone.id, server: other.id });

        // Leave Server: the bot can't leave a server it owns, nor one it isn't in
        const before = discord.requests.length;
        await expect(run("leave-server", { server: home.id })).rejects.toThrow("The bot owns Home, and Discord doesn't let a server's owner leave it");
        await expect(run("leave-server", { server: "999999999999999999" })).rejects.toThrow("The bot isn't in server 999999999999999999");
        expect(discord.requests.length).toBe(before);
        await run("leave-server", { server: `${other.id}` });
        expect(discord.requests.some((r) => r.method === "DELETE" && r.path === `/users/@me/guilds/${other.id}`)).toBe(true);
        expect(await next("bot-left-server")).toEqual({ server: other.id, name: "Other" });
        expect(await read("servers")).toEqual([home.id]);
    });

    test("a bot that goes offline says Connected and its servers changed", async () => {
        const changed = new Set<string>();
        const off = ["connected", "status", "servers", "server-count"].map((value) => blocksApi.onChange(PANEL_ID, value, () => changed.add(value), BOT));
        try {
            await new Promise((resolve) => setTimeout(resolve, 300));
            discord.closeSession(fake, 4014, "Disallowed intent(s).");
            const deadline = Date.now() + 10_000;
            while (changed.size < 4) {
                if (Date.now() > deadline) throw new Error(`only ${[...changed].join(", ") || "nothing"} announced a change`);
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(await read("connected")).toBe(false);
            expect(await read("status")).toBe("offline");
            expect(await read("uptime")).toBe(0);
            expect(await read("server-count")).toBe(0);
            expect(await read("servers")).toEqual([]);
        } finally {
            for (const unsubscribe of off) unsubscribe();
        }
    });
});
