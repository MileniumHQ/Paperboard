import { expect, test } from "bun:test";
import {
    actions,
    defineAction,
    defineTrigger,
    defineType,
    isTypeCompatible,
} from "@paperboard-dev/paperapi";

test("semantic action types and compatibility", () => {
    const playerType = defineType({
        id: "player",
        name: "Player",
        base: "string",
    });

    const messageType = defineType({
        id: "message",
        name: "Message",
        base: "object",
    });

    expect(isTypeCompatible("player", "player")).toBe(true);
    expect(isTypeCompatible("player", "string")).toBe(true);
    expect(isTypeCompatible("player", "number")).toBe(false);
    expect(isTypeCompatible("message", "object")).toBe(true);
    expect(isTypeCompatible("string", "player")).toBe(false);
});

test("action definition schema structure", () => {
    const act = defineAction({
        id: "send-message",
        name: "Send Message",
        writtenOut: "Send {content} to {recipient}",
        inputs: {
            content: { type: "string", label: "Content", required: true },
            recipient: { type: "player", label: "Recipient", required: true },
        },
        output: { type: "message", label: "Sent Message" },
        quick: true,
        run: async (_ctx, inputs: any) => ({
            id: "msg-123",
            text: inputs.content,
            recipient: inputs.recipient,
        }),
    });

    expect(act.id).toBe("send-message");
    expect(act.template).toBe("Send {content} to {recipient}");
    expect(act.inputs?.recipient.type).toBe("player");
    expect(act.quick).toBe(true);
});

test("trigger definition schema structure", () => {
    const trig = defineTrigger({
        id: "player-joined",
        name: "When Player Joins",
        writtenOut: "When player {player} joins",
        output: { type: "player", label: "Joining Player" },
    });

    expect(trig.id).toBe("player-joined");
    expect(trig.template).toBe("When player {player} joins");
    expect(trig.output).toBeDefined();
});
