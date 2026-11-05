import assert from "node:assert/strict";
import { actions } from "../../../packages/paperapi/src/index";
import { executeFlow } from "../../../panels/dev.paperboard.actions/src/lib/runtime";
import { type CanvasBlock } from "../../../panels/dev.paperboard.actions/src/lib/tree";
import { AGENTS, GAME, buildMarketingFlows, validateMarketingFlow } from "./marketing-flows";

/** Exercise the real resolver and executor. The agent's answers and Minecraft
 * chat are simulated in this temporary demo: no brain or running server is
 * needed to prove the workflow wiring. */
export async function verifyMarketingFlows(flows: ReturnType<typeof buildMarketingFlows>) {
    const call = actions.call;
    const calls: { action: string; inputs: Record<string, unknown> }[] = [];
    let activeBlocks: CanvasBlock[] = [];
    const flatten = (block: CanvasBlock): CanvasBlock[] => [block, ...(block.children || []).flatMap(flatten), ...(block.elseChildren || []).flatMap(flatten)];
    const answer = "Meet everyone at spawn, then follow the lantern path to town. ".repeat(40);
    actions.call = async (owner: string, id: string, inputs: Record<string, unknown>) => {
        const block = activeBlocks.find(item => item.panelId === owner && item.action.id === id);
        assert.ok(block, `Unexpected action ${owner}:${id}`);
        validateMarketingFlow({ ...block, isTrigger: true, values: inputs, children: undefined, elseChildren: undefined }, { resolved: true });
        // a server's blocks are registered as "<server>/<action>"
        const action = id.slice(id.lastIndexOf("/") + 1);
        calls.push({ action, inputs });
        if (owner === AGENTS && action === "get-answer") return answer as any;
        if (owner === GAME && action === "say-chat") { assert.ok(String(inputs.message).length <= 160); return inputs.message as any; }
        throw new Error(`No demo response for ${owner}:${id}`);
    };
    const run = async (name: keyof typeof flows, payload: unknown) => {
        const flow = flows[name]; validateMarketingFlow(flow);
        activeBlocks = flatten(flow); calls.length = 0;
        const log = await executeFlow(flow, payload);
        assert.equal(log.status, "success", log.message);
        return calls.slice();
    };
    try {
        const join = await run("joined", "Dinnerbone");
        assert.deepEqual(join.map(entry => entry.action), ["get-answer", "say-chat"]);
        assert.match(String(join[0].inputs.question), /Dinnerbone/);
        assert.equal(join[1].inputs.message, answer.slice(0, 157) + "...");
        const startup = await run("startup", true);
        assert.deepEqual(startup.map(entry => entry.action), ["get-answer", "say-chat"]);
        assert.equal(startup[1].inputs.message, answer.slice(0, 157) + "...");
        console.log("Verified both flows with the real Actions runtime.");
    } finally { actions.call = call; }
}
