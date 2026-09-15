// Registry schema refresh (bun test): stored blocks keep their identity,
// values and position while their schema is replaced with the live one, so
// newly declared metadata (typed output fields, options, categories) reaches
// flows that were built before it existed.
import { describe, test, expect } from "bun:test";
import { mergeActionSchemas, type CanvasBlock } from "../src/lib/tree";

function block(partial: Partial<CanvasBlock> = {}): CanvasBlock {
    return {
        id: "b1",
        panelId: "dev.panel",
        pos: { x: 1, y: 2 },
        isTrigger: false,
        action: { id: "send", name: "Old name", description: "" } as any,
        values: { channel: "123" },
        variableName: "MyVar",
        ...partial,
    };
}

describe("mergeActionSchemas", () => {
    test("replaces the schema but keeps identity, values and position", () => {
        const merged = mergeActionSchemas(
            [block()],
            [
                {
                    panelId: "dev.panel",
                    action: "send",
                    schema: { id: "send", name: "Send Message", description: "new" } as any,
                },
            ],
            [],
        );
        expect(merged[0].action.name).toBe("Send Message");
        expect(merged[0].values).toEqual({ channel: "123" });
        expect(merged[0].pos).toEqual({ x: 1, y: 2 });
        expect(merged[0].variableName).toBe("MyVar");
    });

    test("uses the trigger registry for trigger blocks", () => {
        const triggerBlock = block({
            isTrigger: true,
            action: { id: "on-message", name: "old" } as any,
        });
        const merged = mergeActionSchemas(
            [triggerBlock],
            [],
            [
                {
                    panelId: "dev.panel",
                    trigger: "on-message",
                    schema: { id: "on-message", name: "When a message arrives" } as any,
                },
            ],
        );
        expect(merged[0].action.name).toBe("When a message arrives");
    });

    test("recurses into children and leaves unknown blocks alone", () => {
        const child = block({
            id: "c1",
            action: { id: "ghost", name: "Ghost" } as any,
        });
        const parent = block({
            id: "p1",
            action: { id: "repeat", name: "Repeat" } as any,
            children: [child],
        });
        const merged = mergeActionSchemas(
            [parent],
            [
                {
                    panelId: "dev.panel",
                    action: "repeat",
                    schema: { id: "repeat", name: "Repeat (fresh)" } as any,
                },
            ],
            [],
        );
        expect(merged[0].action.name).toBe("Repeat (fresh)");
        expect(merged[0].children?.[0].action.name).toBe("Ghost");
    });
});
