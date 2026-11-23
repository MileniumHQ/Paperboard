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
