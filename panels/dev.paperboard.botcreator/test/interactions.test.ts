import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { AUTO_ACK_DELAY_MS, InteractionOps } from "../src/discordOps";
import { GLOBAL_SCOPE, type SlashCommandDefinition } from "../src/types";
import { guild, slashCommand, type FakeBot, type FakeGuild, type RecordedRequest } from "./helpers/discord";
import { recordedSession, useFakeDiscord, type RecordedSession } from "./helpers/session";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const discord = useFakeDiscord();

const ping: SlashCommandDefinition = { id: crypto.randomUUID(), name: "ping", description: "Ping", scope: GLOBAL_SCOPE, options: [], userInstall: false };

async function connectedBot(name: string): Promise<{ fake: FakeBot; home: FakeGuild; bot: RecordedSession; ops: InteractionOps }> {
    const home = guild("Home");
    const fake = discord().addBot({ username: name, guilds: [home] });
    const bot = recordedSession(`b-${name}`);
    bot.session.commands = [ping];
    await bot.session.start(fake.token);
    await bot.until(() => bot.session.connected(), `${name} to connect`);
    return { fake, home, bot, ops: new InteractionOps((id) => bot.session.takeInteraction(id)) };
}

/** Sends the interaction over the gateway; resolves with its id once the session has it. */
async function deliver(bot: RecordedSession, fake: FakeBot, payload: { id: string }, trigger: string): Promise<string> {
    const seen = bot.triggers.length;
    discord().dispatch(fake, "INTERACTION_CREATE", payload);
    await bot.until(() => bot.triggers.slice(seen).some((t) => t.trigger === trigger), `the ${trigger} trigger`);
    return payload.id;
}

/** What reached Discord for one interaction: its callbacks, and its webhook calls by token. */
function answers(payload: { id: string; token: string }) {
    const all = discord().requests.filter((r) => r.path.startsWith(`/interactions/${payload.id}/`) || r.path.includes(`/${payload.token}`));
    const describe = (r: RecordedRequest) =>
        r.path.endsWith("/callback") ? `callback ${r.body.type}` : `${r.method} ${r.path.includes("/messages/") ? `message ${r.path.split("/messages/")[1]}` : "webhook"}`;
    return all.map(describe);
}

// Interactions get exactly one first answer and stay answerable.
describe("interactions get exactly one first answer and stay answerable", () => {
    test("Respond answers, Follow Up reaches the same interaction, and Respond again edits the answer", async () => {
        const { fake, home, bot, ops } = await connectedBot("responder");
        const payload = slashCommand(fake, { guild: home, name: "ping" });
        const id = await deliver(bot, fake, payload, "command:global:ping");
        expect(await ops.respond(id, { content: "pong" })).toBe(id);
        const followUp = await ops.followUp(id, { content: "and more" });
        expect(followUp).toMatch(/^\d+$/);
        await ops.respond(id, { content: "pong, edited" });
        // 4: a channel message as the first answer
        expect(answers(payload)).toEqual(["callback 4", "POST webhook", "PATCH message @original"]);
        const sent = discord().requests.filter((r) => r.path.includes(payload.token) || r.path.startsWith(`/interactions/${id}/`));
        expect(sent.map((r) => r.body?.data?.content ?? r.body?.content)).toEqual(["pong", "and more", "pong, edited"]);
    });

    test("an unanswered slash command is deferred for the flow, whose Respond then fills it in", async () => {
        const { fake, home, bot, ops } = await connectedBot("slowpoke");
        const payload = slashCommand(fake, { guild: home, name: "ping" });
        const started = Date.now();
        await deliver(bot, fake, payload, "command:global:ping");
        // 5: "thinking…", sent on the flow's behalf inside Discord's 3 s window
        await discord().request((r) => r.path === `/interactions/${payload.id}/${payload.token}/callback`, "the automatic acknowledgement");
        expect(Date.now() - started).toBeGreaterThanOrEqual(AUTO_ACK_DELAY_MS - 100);
        await ops.respond(payload.id, { content: "done at last" });
        expect(answers(payload)).toEqual(["callback 5", "PATCH message @original"]);
    });
});
