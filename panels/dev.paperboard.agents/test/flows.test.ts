import { afterEach, describe, expect, test } from "bun:test";
import { appRig, type AppRig } from "./support/app";
import { SLOW } from "./support/host";

let rig: AppRig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

const replies = (r: AppRig) => r.blocks.fired.items.filter((f) => f.event === "message-received");

// A flow's message to the agent, through its Send Message block.
describe("a flow's turn", () => {
    test("has no ask_to_sign_in or show_page tools; the user's does", async () => {
        rig = await appRig();
        const r = rig;
        await r.blocks.run("send-message", { message: "list your tools [[tools]]" });
        await r.blocks.fired.until(() => replies(r).length === 1, "the flow's reply");
        r.app.conversation.send("list your tools [[tools]]");
        await r.blocks.fired.until(() => replies(r).length === 2, "the user's reply");
        const [flow, user] = r.log().filter((e) => e.event === "tools");
        expect(flow.status).toBe(200);
        expect(flow.tools).not.toContain("ask_to_sign_in");
        expect(flow.tools).not.toContain("show_page");
        expect(flow.tools).toContain("send_message");
        expect(user.tools).toContain("ask_to_sign_in");
        expect(user.tools).toContain("show_page");
    }, SLOW);
});
