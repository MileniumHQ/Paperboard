import { expect, test } from "bun:test";
import { validateMarketingFlow } from "../scripts/marketing-flows";
import { BUILTIN_DEFS } from "../../../panels/dev.paperboard.actions/src/lib/builtin";
import type { CanvasBlock } from "../../../panels/dev.paperboard.actions/src/lib/tree";

function fixture(): CanvasBlock {
    return {
        id: "interaction", panelId: "dev.paperboard.botcreator", iconSrc: "/bot.png",
        pos: { x: 0, y: 0 }, isTrigger: true, values: {},
        action: { id: "button", name: "Button", icon: "touch_app", eventOnly: true,
            outputFields: { interactionId: { type: "discord-interaction" }, success: { type: "boolean" } } },
        children: [{ id: "reply", panelId: "dev.paperboard.botcreator", iconSrc: "/bot.png",
            pos: { x: 0, y: 0 }, isTrigger: false,
            action: { id: "reply", name: "Reply", icon: "reply", inputs: { interactionId: { type: "discord-interaction", label: "Interaction", required: true } } },
            values: { interactionId: "{{interactionId:Interaction:reply}}" } }],
    };
}

test("screenshot inputs retain typed trigger fields instead of accepting any available variable", () => {
    const flow = fixture(); expect(() => validateMarketingFlow(flow)).not.toThrow();
    flow.children![0].values.interactionId = "{{success:Success:toggle_on}}";
    expect(() => validateMarketingFlow(flow)).toThrow(/boolean cannot supply discord-interaction/);
    flow.children![0].values.interactionId = "{{missing:Missing:reply}}";
    expect(() => validateMarketingFlow(flow)).toThrow(/unavailable variable/);
    flow.children![0].values.interactionId = "fake-interaction";
    expect(() => validateMarketingFlow(flow)).toThrow(/requires a typed block/);
    flow.children![0].values.interactionId = "124800000000000030";
    expect(() => validateMarketingFlow(flow)).toThrow(/requires a typed block/);
});

test("panel screenshots require icons and cannot nest event-only blocks", () => {
    const flow = fixture(); flow.children![0].iconSrc = undefined;
    expect(() => validateMarketingFlow(flow)).toThrow(/panel icon/);
    flow.children![0].iconSrc = "/bot.png"; flow.children![0].isTrigger = true;
    expect(() => validateMarketingFlow(flow)).toThrow(/cannot be nested/);
});

test("conditions use actual builtin options and branch outputs stay within their branch", () => {
    const flow = fixture();
    const schema = BUILTIN_DEFS.find(item => item.id === "if")!.item.schema!;
    flow.children = [{ id: "condition", panelId: "builtin.logic", action: schema,
        pos: { x: 0, y: 0 }, isTrigger: false, values: { left: "!tip hello", operator: "starts-with", right: "!tip " } }];
    expect(() => validateMarketingFlow(flow)).not.toThrow();
    flow.children[0].values.operator = "startsWith";
    expect(() => validateMarketingFlow(flow)).toThrow(/invalid option/);
    flow.children[0].values.operator = "starts-with";
    const text = BUILTIN_DEFS.find(item => item.id === "text")!.item.schema!;
    flow.children[0].children = [{ id: "branch-text", panelId: "builtin.logic", action: text,
        pos: { x: 0, y: 0 }, isTrigger: false, values: { value: "only in this branch" } }];
    flow.children.push({ id: "outside", panelId: "builtin.logic", action: text,
        pos: { x: 0, y: 0 }, isTrigger: false, values: { value: "{{branch-text:Text:notes}}" } });
    expect(() => validateMarketingFlow(flow)).toThrow(/unavailable variable branch-text/);
});
