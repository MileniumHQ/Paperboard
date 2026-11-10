// Bot Creator's blocks (Actions API v2), used the way the Blocks panel uses
// them: through the real daemon, from the service, against a loopback Discord.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi, qualifyTypeRef, valueProblem, type TypeLookup } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import { blockEvent, blockTypes, commandEvent, commandEventId, staticEvents } from "../src/blocks";
import { GLOBAL_SCOPE, type SlashCommandDefinition } from "../src/types";
import { guild, slashCommand, startFakeDiscord, userMessage, type FakeBot, type FakeDiscord, type FakeGuild } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, storedBot, stopServices } from "./helpers/service";
import { stateWhere, within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const BOT = "b-blocks";
const type = (id: string) => `${PANEL_ID}:${id}`;
const run = <T = any>(command: string, inputs: Record<string, unknown>) => blocksApi.run<T>(PANEL_ID, command, inputs, { project: BOT });
const read = <T = any>(value: string, inputs?: Record<string, unknown>) => blocksApi.read<T>(PANEL_ID, value, inputs, { project: BOT });

const TYPES = ["channel", "component", "embed", "interaction", "member", "message", "poll", "poll-answer", "reaction", "role", "server", "text-field", "user"];
const BUILDERS = ["create-button", "create-embed", "create-interaction-row", "create-select-menu", "create-text-field"];
const COMMANDS = [
    "add-reaction", "add-role", "ban-user", "create-channel", "create-event", "create-invite", "create-role", "create-thread",
    "crosspost-message", "delete-channel", "delete-message", "delete-role", "disconnect-member", "edit-message", "edit-thread",
    "follow-up-interaction", "kick-member", "move-member", "pin-message", "purge-messages", "remove-reaction", "remove-role",
    "remove-timeout", "rename-channel", "rename-role", "reply-to-message", "respond-to-interaction", "send-dm", "send-file",
    "send-message", "send-poll", "set-activity", "set-channel-permissions", "set-channel-topic", "set-nickname", "set-role-color",
    "set-role-display", "set-slowmode", "show-modal", "show-typing", "timeout-member", "unban-user", "unpin-message",
];
const VALUES = ["bot-user", "connected", "find-members", "latency", "member", "message", "recent-messages", "server-count", "servers"];
const EVENTS = [
    "bot-ready", "component-used", "connection-failed", "member-banned", "member-joined", "member-left", "message-deleted",
    "message-edited", "message-received", "modal-submitted", "reaction-added", "reaction-removed", "role-added", "role-removed",
    "thread-created", "voice-changed",
];

// every static trigger a session fires (session.ts attachListeners), as Actions names them
const TRIGGERS = [
    "on-message", "on-member-join", "on-member-leave", "on-reaction-add", "on-connection-error", "interaction-triggered",
    "modal-submitted", "on-message-edited", "on-message-deleted", "on-reaction-removed", "on-member-banned", "on-role-added",
    "on-role-removed", "on-thread-created", "on-voice-state-change", "on-bot-ready",
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
    // what each type's own value is checked against, as the service checks a fire
    const types = new Map(blockTypes(() => []).map((t) => [type(t.id), t]));
    const lookup: TypeLookup = (qualified) => {
        const t = types.get(qualified);
        if (!t) return undefined;
        return { base: t.base, fields: Object.fromEntries(Object.entries(t.fields ?? {}).map(([k, f]) => [k, { type: qualifyTypeRef(f.type, PANEL_ID), ...(f.resolve ? { resolved: true as const } : {}) }])) };
    };
    const firesAs = (event: { values?: Record<string, { type: string }> }, payload: Record<string, unknown>) => {
        expect(Object.keys(payload).sort()).toEqual(Object.keys(event.values ?? {}).sort());
        for (const [key, value] of Object.entries(event.values ?? {})) {
            expect([key, valueProblem(qualifyTypeRef(value.type, PANEL_ID), payload[key], lookup)]).toEqual([key, null]);
        }
    };

    test("every static trigger, even with nothing in its payload", () => {
        const mapped = new Set<string>();
        for (const trigger of TRIGGERS) {
            const { event, payload } = blockEvent(trigger, {}, []);
            const definition = staticEvents.find((e) => e.id === event);
            expect([trigger, definition?.id]).toEqual([trigger, event]);
            firesAs(definition!, payload);
            mapped.add(event);
        }
        expect([...mapped].sort()).toEqual(EVENTS);
    });

    test("a slash command, its options typed, and an optional one not given empty", () => {
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
        expect(event.values).toMatchObject({ "option-user": { type: "user", name: "user" }, "option-days": { type: "any", name: "days" } });
        const { payload } = blockEvent("command:global:give_role", { interactionId: "1", userId: "2", channelId: "3", guildId: null, values: { user: "123456789012345678" } }, [command]);
        firesAs(event, payload);
        expect(payload).toMatchObject({ "option-user": "123456789012345678", "option-days": "", server: "" });
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

    test("the panel has the types and builders; the bot's project has its commands, values and events", async () => {
        expect(await blocksApi.projects(PANEL_ID)).toEqual([{ panelId: PANEL_ID, id: BOT, name: "Blocky", icon: "smart_toy" }]);
        const entries = (await blocksApi.list(PANEL_ID)).map((b) => b.entry).sort();
        expect(entries).toEqual(
            [
                ...TYPES.map((id) => `type.${id}`),
                ...BUILDERS.map((id) => `command.${id}`),
                ...COMMANDS.map((id) => `${BOT}/command.${id}`),
                ...VALUES.map((id) => `${BOT}/value.${id}`),
                ...EVENTS.map((id) => `${BOT}/event.${id}`),
            ].sort(),
        );
        const send = (await blocksApi.list(PANEL_ID)).find((b) => b.entry === `${BOT}/command.send-message`)!;
        expect(send.schema).toMatchObject({
            text: "Send {content} to {channel} with {embeds} and {components}",
            category: "Messages",
            inputs: { channel: { type: type("channel"), name: "Channel" }, embeds: { type: `list<${type("embed")}>` } },
            output: type("message"),
        });
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

    test("a bot that goes offline says Connected and its servers changed", async () => {
        const changed = new Set<string>();
        const off = ["connected", "servers", "server-count"].map((value) => blocksApi.onChange(PANEL_ID, value, () => changed.add(value), BOT));
        try {
            await new Promise((resolve) => setTimeout(resolve, 300));
            discord.closeSession(fake, 4014, "Disallowed intent(s).");
            const deadline = Date.now() + 10_000;
            while (changed.size < 3) {
                if (Date.now() > deadline) throw new Error(`only ${[...changed].join(", ") || "nothing"} announced a change`);
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(await read("connected")).toBe(false);
            expect(await read("server-count")).toBe(0);
            expect(await read("servers")).toEqual([]);
        } finally {
            for (const unsubscribe of off) unsubscribe();
        }
    });
});
