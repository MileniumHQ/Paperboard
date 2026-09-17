// Action/type schema DSL (bun test). Lives here because the code
// lives here (src/schema.ts, src/actions.ts) — it was previously a
// misplaced test in the gameserver panel, which imports the DSL but owns
// none of it.
import { describe, test, expect } from "bun:test";
import {
    defineAction,
    defineType,
    isTypeCompatible,
    validateActionDefinition,
} from "../src/actions";

describe("schema DSL", () => {
    test("semantic action types and compatibility", () => {
        defineType({
            id: "player",
            name: "Player",
            base: "string",
        });

        defineType({
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
            description: "Sends a message to a recipient",
            writtenOut: "Send {content} to {recipient}",
            inputs: {
                content: { type: "string", label: "Content", required: true },
                recipient: { type: "player", label: "Recipient", required: true },
            },
            output: { type: "message", label: "Sent Message" },
            quick: true,
            run: async (_ctx: any, inputs: any) => ({
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

    test("event action definition schema structure", () => {
        const trig = defineAction({
            id: "player-joined",
            name: "When Player Joins",
            description: "Fires when a player joins",
            writtenOut: "When player {player} joins",
            output: { type: "player", label: "Joining Player" },
        });

        expect(trig.id).toBe("player-joined");
        expect(trig.template).toBe("When player {player} joins");
        expect(trig.output).toBeDefined();
        expect(trig.run).toBeUndefined();
    });

    describe("validateActionDefinition", () => {
        const eventDef = (overrides: any = {}) =>
            defineAction({
                id: "item-ready",
                name: "When Item Ready",
                description: "",
                inputs: { itemId: { type: "string", label: "Item" } },
                ...overrides,
            });

        test("match rules on an event action with declared inputs are valid", () => {
            expect(() =>
                validateActionDefinition(
                    eventDef({ match: { field: "itemId", input: "itemId" } }) as any,
                ),
            ).not.toThrow();
        });

        test("match on a callable action is refused: routing is not for executors", () => {
            expect(() =>
                validateActionDefinition(
                    eventDef({ run: () => {}, match: { field: "itemId", input: "itemId" } }) as any,
                ),
            ).toThrow(/not an event source/);
        });

        test("a match naming an undeclared input is refused", () => {
            expect(() =>
                validateActionDefinition(eventDef({ match: { field: "itemId", input: "ghost" } }) as any),
            ).toThrow(/undeclared input/);
        });

        test("a match without a payload field is refused", () => {
            expect(() =>
                validateActionDefinition(eventDef({ match: { input: "itemId" } }) as any),
            ).toThrow(/without a payload field/);
        });

        test("multiple rules AND together and stay valid", () => {
            expect(() =>
                validateActionDefinition(
                    eventDef({
                        inputs: {
                            itemId: { type: "string", label: "Item" },
                            channel: { type: "string", label: "Channel" },
                        },
                        match: [
                            { field: "itemId", input: "itemId" },
                            { field: "channelId", input: "channel" },
                        ],
                    }) as any,
                ),
            ).not.toThrow();
        });
    });
});
