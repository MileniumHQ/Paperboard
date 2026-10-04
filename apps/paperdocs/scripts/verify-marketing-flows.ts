import assert from "node:assert/strict";
import { actions } from "../../../packages/paperapi/src/index";
import { executeFlow } from "../../../panels/dev.paperboard.actions/src/lib/runtime";
import { type CanvasBlock } from "../../../panels/dev.paperboard.actions/src/lib/tree";
import { buildMarketingFlows, validateMarketingFlow, demoChannel, demoUser, demoInteraction, demoMessage } from "./marketing-flows";
import { buildMessagePayload } from "../../../panels/dev.paperboard.botcreator/src/discordOps";

/** Exercise the real resolver/executor; live player-count crosses the daemon.
 * Discord, chat and inference responses are simulated in this temporary demo.
 * No bot credentials or messages are needed to prove the workflow wiring. */
export async function verifyMarketingFlows(flows: ReturnType<typeof buildMarketingFlows>) {
    const call = actions.call;
    const calls: { action: string; inputs: Record<string, unknown> }[] = [];
    let activeBlocks: CanvasBlock[] = [];
    const flatten = (block: CanvasBlock): CanvasBlock[] => [block, ...(block.children || []).flatMap(flatten), ...(block.elseChildren || []).flatMap(flatten)];
    const answer = "Meet everyone at spawn, then follow the lantern path to town. ".repeat(40);
    let deferred = false;
    actions.call = async (owner: string, id: string, inputs: Record<string, unknown>) => {
        const block = activeBlocks.find(item => item.panelId === owner && item.action.id === id);
        assert.ok(block, `Unexpected action ${owner}:${id}`);
        validateMarketingFlow({ ...block, isTrigger: true, values: inputs, children: undefined, elseChildren: undefined }, { resolved: true });
        calls.push({ action: id, inputs });
        if (owner === "dev.paperboard.gameserver" && id === "player-count" || id === "create-button" || id === "create-embed") return await call(owner, id, inputs) as any;
        if (id === "list-players") return "Dinnerbone, jeb_" as any;
        if (id === "get-channel") { assert.equal(inputs.channelId, demoChannel); return demoChannel as any; }
        if (id === "get-user") { assert.equal(inputs.userId, demoUser); return demoUser as any; }
        if (id === "ask") return answer as any;
        if (id === "say-chat") { assert.ok(String(inputs.message).length <= 160); return inputs.message as any; }
        if (id === "defer-interaction") { assert.equal(inputs.interactionId, demoInteraction); deferred = true; return true as any; }
        if (id === "respond-to-interaction") { assert.ok(deferred); assert.equal(inputs.interactionId, demoInteraction); return demoInteraction as any; }
        if (id === "send-dm") { assert.equal(inputs.user, demoUser); assert.ok(String(inputs.content).length <= 600); buildMessagePayload(inputs).embeds.forEach(embed => embed.toJSON()); return demoMessage as any; }
        if (id === "send-message") {
            assert.equal(inputs.channel, demoChannel); assert.ok(String(inputs.content).length <= 2000);
            if (inputs.reply) assert.equal(inputs.reply, demoMessage);
            const payload = buildMessagePayload(inputs);
            payload.embeds.forEach(embed => embed.toJSON());
            payload.components?.forEach(row => row.toJSON());
            return demoMessage as any;
        }
        if (id === "pin-message" || id === "add-reaction") {
            assert.equal(inputs.channel, demoChannel); assert.equal(inputs.message, demoMessage); return true as any;
        }
        throw new Error(`No demo response for ${owner}:${id}`);
    };
    const run = async (name: keyof typeof flows, payload: unknown) => {
        const flow = flows[name]; validateMarketingFlow(flow);
        activeBlocks = flatten(flow); calls.length = 0; deferred = false;
        const log = await executeFlow(flow, payload);
        assert.equal(log.status, "success", log.message);
        return calls.slice();
    };
    try {
        const startup = await run("startup", true);
        const realCount = startup.find(entry => entry.action === "player-count"); assert.ok(realCount);
        assert.match(String(startup.at(-1)!.inputs.content), /\d+ players online/);
        const join = await run("joined", "Dinnerbone");
        assert.match(String(join.find(entry => entry.action === "ask")!.inputs.prompt), /Dinnerbone/);
        assert.equal(join.find(entry => entry.action === "say-chat")!.inputs.message, answer.slice(0, 157) + "...");
        assert.match(String(join.at(-1)!.inputs.content), /Dinnerbone joined Minecraft/);
        const button = await run("button", { interactionId: demoInteraction, customId: "minecraft-status", userId: demoUser });
        assert.deepEqual(button.map(entry => entry.action), ["defer-interaction", "player-count", "list-players", "respond-to-interaction"]);
        assert.match(String(button.at(-1)!.inputs.content), /Dinnerbone, jeb_/);
        await run("member", { userId: demoUser, username: "Dinnerbone", guildId: "124800000000000050", guildName: "Lantern Town" });
        const model = await run("model", "qwen2.5:0.5b"); assert.equal(model.find(entry => entry.action === "ask")!.inputs.model, "qwen2.5:0.5b");
        assert.match(String(model.at(-1)!.inputs.content), /qwen2.5:0.5b/);
        const payload = { content: "!tip how do I keep mobs away?", channelId: demoChannel, messageId: demoMessage, authorId: demoUser, author: "Dinnerbone" };
        const question = await run("question", payload); assert.equal(question.at(-1)!.inputs.reply, demoMessage);
        assert.equal((await run("question", { ...payload, content: "ordinary conversation" })).length, 0, "Non-command chat must not invoke inference or reply");
        await run("leaving", "Dinnerbone");
        const ready = await run("botReady", { userId: demoUser, username: "Lantern Town Bot" });
        assert.equal((ready.at(-1)!.inputs.components as any[])[0].customId, flows.button.values.customId, "The posted button must start the status flow");
        const night = await run("gameNight", {});
        assert.deepEqual(night.map(entry => entry.action), ["get-channel", "player-count", "ask", "create-embed", "create-button", "send-message", "pin-message"]);
        assert.equal((night.find(entry => entry.action === "send-message")!.inputs.components as any[])[0].customId, flows.button.values.customId);
        const guidePayload = { ...payload, content: "!guide how do I start a villager trading hall?" };
        const guide = await run("helpDesk", guidePayload);
        assert.deepEqual(guide.map(entry => entry.action), ["get-user", "ask", "send-dm", "send-message", "add-reaction"]);
        assert.equal((await run("helpDesk", { ...guidePayload, content: "ordinary conversation" })).length, 0);
        console.log("Verified ten flows with the real Actions runtime and Discord payload builders; player-count, create-button and create-embed crossed the authenticated daemon.");
    } finally { actions.call = call; }
}
