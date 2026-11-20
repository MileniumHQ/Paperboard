import { afterEach, describe, expect, test } from "bun:test";
import { ACTION_IDS } from "../src/contract";
import { action, appRig, type AppRig } from "./support/app";
import { SLOW } from "./support/host";

let rig: AppRig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

// The agent's flow actions.
describe("the agent's flow actions", () => {
    test("a flow's turn has no ask_to_sign_in or show_page tools; the user's does", async () => {
        rig = await appRig();
        await action(rig, ACTION_IDS.sendMessage)({ text: "list your tools [[tools]]" });
        await rig.triggers.until((t) => t.length === 1, "the flow's reply");
        rig.app.conversation.send("list your tools [[tools]]");
        await rig.triggers.until((t) => t.length === 2, "the user's reply");
        const [flow, user] = rig.log().filter((e) => e.event === "tools");
        expect(flow.status).toBe(200);
        expect(flow.tools).not.toContain("ask_to_sign_in");
        expect(flow.tools).not.toContain("show_page");
        expect(flow.tools).toContain("send_message");
        expect(user.tools).toContain("ask_to_sign_in");
        expect(user.tools).toContain("show_page");
    }, SLOW);
});
