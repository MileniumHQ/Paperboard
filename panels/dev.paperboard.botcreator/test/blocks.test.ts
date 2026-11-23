// Bot Creator's blocks, used the way the Blocks panel uses
// them: through the real daemon, from the service, against a loopback Discord.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import { commandEventId } from "../src/blocks/events";
import { GLOBAL_SCOPE } from "../src/types";
import { guild, slashCommand, startFakeDiscord, userMessage, type FakeBot, type FakeDiscord, type FakeGuild } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, storedBot, stopServices } from "./helpers/service";
import { nextEvent as nextEventOf, stateWhere } from "./helpers/wait";

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
// the panel's own: the blocks that run Bot Creator itself (botsBlocks.test.ts), and the builders, which
// change nothing, so they're values
const PANEL_COMMANDS = ["create-slash-command", "delete-bot", "delete-slash-command", "restart-bot", "turn-off-bot", "turn-on-bot"];
const PANEL_VALUES = [
    "bot", "bots", "create-button", "create-command-option", "create-embed", "create-interaction-row", "create-select-menu",
    "create-text-field", "invite-link",
];
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

const nextEvent = (event: string) => nextEventOf(PANEL_ID, event, BOT);

describe("a bot is a Blocks project, used through the daemon", () => {
    let discord: FakeDiscord;
    /** resolves once the bot has answered interaction `id` (its automatic "thinking…", when no flow answers) */
    const acknowledged = (id: string) => discord.request((r) => r.method === "POST" && r.path.startsWith(`/interactions/${id}/`), `the bot's answer to interaction ${id}`);
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
        await expect(blocksApi.read(PANEL_ID, "create-button", { style: "primary", label: "Go", disabled: false })).rejects.toThrow('The primary button "Go" needs a Component ID');
        expect(await blocksApi.read(PANEL_ID, "create-button", { style: "primary", label: "Go", "component-id": "go", disabled: false })).toMatchObject({ kind: "button", customId: "go" });
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
        const created = await call.createCommand({ bot: BOT, name: "roll", description: "Roll a die", options: [{ name: "sides", description: "How many sides", type: "integer", required: true }] });
        expect(created).toMatchObject({ registered: true, triggerError: null });
        const event = commandEventId({ scope: GLOBAL_SCOPE, name: "roll" });
        const listed = (await blocksApi.list(PANEL_ID)).find((b) => b.entry === `${BOT}/event.${event}`);
        expect(listed?.schema).toMatchObject({ name: "When /roll Is Used", values: { "option-sides": { type: "number", name: "sides" } } });

        const used = nextEvent(event);
        await used.ready;
        const interaction = slashCommand(fake, { guild: home, name: "roll", options: [{ name: "sides", type: 4, value: 20 }] });
        discord.dispatch(fake, "INTERACTION_CREATE", interaction);
        expect(await used.payload).toMatchObject({ interaction: interaction.id, channel: home.channels[0].id, server: home.id, "option-sides": 20 });
        // the bot says "thinking…" for a flow that doesn't answer; it lands here, not in a later test's count
        await acknowledged(interaction.id);

        await call.deleteCommand({ bot: BOT, id: created.command.id });
        expect((await blocksApi.list(PANEL_ID)).some((b) => b.entry === `${BOT}/event.${event}`)).toBe(false);
    });
});
