import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { guild, userMessage } from "./helpers/discord";
import { recordedSession, useFakeDiscord } from "./helpers/session";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const discord = useFakeDiscord();
const fired = (triggers: { trigger: string; output: any }[], name: string) => triggers.filter((t) => t.trigger === name);

// Connection status is truthful per session.
describe("connection status is truthful per session", () => {
    test("a login Discord rejects rejects the start and fires on-connection-error once", async () => {
        const bot = recordedSession("b-rejected");
        await expect(bot.session.start("MTIz.not-a.token-discord-knows")).rejects.toThrow("Discord login failed: An invalid token was provided.");
        expect(bot.session.status()).toEqual({ connected: false, error: "An invalid token was provided." });
        expect(bot.session.connected()).toBe(false);
        expect(bot.session.connecting()).toBe(false);
        expect(bot.session.client).toBeNull();
        expect(fired(bot.triggers, "on-connection-error")).toEqual([{ trigger: "on-connection-error", output: { error: "An invalid token was provided." } }]);
        expect(bot.triggers).toHaveLength(1);
    });

    test("clientReady marks the bot connected and fires on-bot-ready; nothing listens to the deprecated ready", async () => {
        const fake = discord().addBot({ username: "Ready Bot", guilds: [guild("Home")] });
        const bot = recordedSession("b-ready");
        await bot.session.start(fake.token);
        await bot.until(() => fired(bot.triggers, "on-bot-ready").length > 0, "on-bot-ready");
        expect(bot.session.connected()).toBe(true);
        expect(bot.session.status()).toEqual({ connected: true });
        expect(fired(bot.triggers, "on-bot-ready")).toEqual([{ trigger: "on-bot-ready", output: { userId: fake.appId, username: "Ready Bot" } }]);
        expect(bot.session.client!.listenerCount("ready")).toBe(0);
        expect(bot.session.client!.listenerCount("clientReady")).toBe(1);
        expect(bot.session.info()).toMatchObject({ name: "Ready Bot", applicationId: fake.appId, connected: true, guildCount: 1 });
    });

    test("a gateway that closes the session for good marks the bot offline with the reason", async () => {
        const fake = discord().addBot({ username: "Dropped Bot" });
        const bot = recordedSession("b-dropped");
        await bot.session.start(fake.token);
        await bot.until(() => bot.session.connected(), "the bot to connect");
        // 4014: disallowed intents, which discord.js does not retry
        discord().closeSession(fake, 4014, "Disallowed intent(s).");
        await bot.until(() => !bot.session.status().connected, "the drop to be reported");
        const { error } = bot.session.status();
        expect(bot.session.health()).toMatchObject({ connected: false, lastError: error });
        // the reason is the close Discord sent, not a library's notice
        expect(error).toContain("4014");
        expect(error).not.toContain("deprecated");
        expect(fired(bot.triggers, "on-connection-error").map((t) => t.output.error)).toContain(error);
    });

    test("an invalidated session marks the bot offline, drops its client and says why", async () => {
        const fake = discord().addBot({ username: "Revoked Bot" });
        const bot = recordedSession("b-revoked");
        await bot.session.start(fake.token);
        await bot.until(() => bot.session.connected(), "the bot to connect");
        // discord.js 14 no longer raises this itself; the session still honours it
        bot.session.client!.emit("invalidated");
        expect(bot.session.status()).toEqual({ connected: false, error: "Session invalidated: token was reset or revoked" });
        expect(bot.session.client).toBeNull();
        expect(() => bot.session.requireClient()).toThrow("This bot is not connected. Turn it on in Bot Creator.");
        expect(fired(bot.triggers, "on-connection-error")).toEqual([{ trigger: "on-connection-error", output: { error: "Session invalidated: token was reset or revoked" } }]);
    });

    test("a superseded client's events change nothing", async () => {
        const fake = discord().addBot({ username: "Twice Bot", guilds: [guild("Home")] });
        const bot = recordedSession("b-twice");
        await bot.session.start(fake.token);
        await bot.until(() => fired(bot.triggers, "on-bot-ready").length === 1, "the first session");
        const old = bot.session.client!;
        await bot.session.start(fake.token);
        await bot.until(() => fired(bot.triggers, "on-bot-ready").length === 2, "the second session");
        expect(bot.session.client).not.toBe(old);
        const before = { status: bot.session.status(), triggers: bot.triggers.length, messages: bot.session.getRecentMessages() };

        // the old client's events, as discord.js would emit them
        old.emit("shardDisconnect", { code: 4000, reason: "", wasClean: false } as any, 0);
        old.emit("invalidated");
        old.emit("error", new Error("old client error"));
        old.emit("clientReady", old as any);
        old.emit("messageCreate", { author: { bot: false, username: "ghost", id: "1" }, content: "from the past", channelId: "1", guildId: "1", id: "1" } as any);
        expect(bot.session.status()).toEqual(before.status);
        expect(bot.session.connected()).toBe(true);
        expect(bot.triggers).toHaveLength(before.triggers);
        expect(bot.session.getRecentMessages()).toEqual(before.messages);
    });

    test("two bots never see each other's status, messages or triggers", async () => {
        const homeA = guild("A's server");
        const homeB = guild("B's server");
        const fakeA = discord().addBot({ username: "Bot A", guilds: [homeA] });
        const fakeB = discord().addBot({ username: "Bot B", guilds: [homeB] });
        const a = recordedSession("b-alpha");
        const b = recordedSession("b-beta");
        await Promise.all([a.session.start(fakeA.token), b.session.start(fakeB.token)]);
        await a.until(() => fired(a.triggers, "on-bot-ready").length === 1, "A to be ready");
        await b.until(() => fired(b.triggers, "on-bot-ready").length === 1, "B to be ready");

        discord().dispatch(fakeA, "MESSAGE_CREATE", userMessage(homeA, "hello A"));
        await a.until(() => fired(a.triggers, "on-message").length === 1, "A's message");
        expect(a.session.getRecentMessages().map((m) => m.content)).toEqual(["hello A"]);
        expect(b.session.getRecentMessages()).toEqual([]);
        expect(fired(b.triggers, "on-message")).toEqual([]);

        discord().closeSession(fakeA, 4014, "Disallowed intent(s).");
        await a.until(() => !a.session.status().connected, "A to drop");
        expect(b.session.status()).toEqual({ connected: true });
        expect(fired(b.triggers, "on-connection-error")).toEqual([]);
        expect(b.session.info()).toMatchObject({ name: "Bot B", guildCount: 1, connected: true });
    });
});
