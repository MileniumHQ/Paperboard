// Pure tree manipulation proofs (bun test): insert/remove/find/relabel
// operate on stored flows, so corruption here loses user work. Every
// function below is total — no throws on missing ids, no mutation of the
// input array.
import { describe, test, expect } from "bun:test";
import {
    type CanvasBlock,
    findBlock,
    findOwnerTrigger,
    insertBlock,
    isCanvasBlock,
    relabelVariableRefs,
    removeBlock,
    renameBlockVariable,
    updateBlockPos,
    updateBlockValue,
    walkBlocks,
} from "../src/lib/tree";

function block(partial: Partial<CanvasBlock> = {}): CanvasBlock {
    return {
        id: "b1",
        panelId: "builtin.logic",
        pos: { x: 0, y: 0 },
        isTrigger: false,
        action: { id: "act", name: "Act" } as any,
        values: {},
        ...partial,
    };
}

describe("findBlock / findOwnerTrigger", () => {
    test("finds nested blocks through children and elseChildren", () => {
        const tree = [
            block({
                id: "root",
                isTrigger: true,
                children: [block({ id: "kid" })],
                elseChildren: [block({ id: "ekid" })],
            }),
        ];
        expect(findBlock(tree, "kid")?.id).toBe("kid");
        expect(findBlock(tree, "ekid")?.id).toBe("ekid");
        expect(findBlock(tree, "missing")).toBeNull();
        expect(findOwnerTrigger(tree, "kid")?.id).toBe("root");
        expect(findOwnerTrigger(tree, "root")?.id).toBe("root");
        expect(findOwnerTrigger([block({ id: "plain" })], "plain")).toBeNull();
    });
});

describe("removeBlock", () => {
    test("removes nested blocks and reports what was removed", () => {
        const tree = [block({ id: "root", children: [block({ id: "kid" }), block({ id: "kid2" })] })];
        const { blocks, removed } = removeBlock(tree, "kid");
        expect(removed?.id).toBe("kid");
        expect(blocks[0].children?.map((b) => b.id)).toEqual(["kid2"]);
        // input untouched
        expect(tree[0].children).toHaveLength(2);
    });

    test("a missing id removes nothing", () => {
        const tree = [block({ id: "root" })];
        const { blocks, removed } = removeBlock(tree, "nope");
        expect(removed).toBeNull();
        expect(blocks).toHaveLength(1);
    });
});

describe("insertBlock", () => {
    test("inserts at top level with clamped index", () => {
        const out = insertBlock([block({ id: "a" })], null, 99, block({ id: "b" }));
        expect(out.map((b) => b.id)).toEqual(["a", "b"]);
        const front = insertBlock([block({ id: "a" })], null, -5, block({ id: "b" }));
        expect(front.map((b) => b.id)).toEqual(["b", "a"]);
    });

    test("inserts into children and else branches", () => {
        const tree = [block({ id: "root", children: [], elseChildren: [] })];
        const withKid = insertBlock(tree, "root", 0, block({ id: "kid" }));
        expect(withKid[0].children?.map((b) => b.id)).toEqual(["kid"]);
        const withElse = insertBlock(tree, "root:else", 0, block({ id: "ekid" }));
        expect(withElse[0].elseChildren?.map((b) => b.id)).toEqual(["ekid"]);
    });

    test("an unknown parent leaves the tree unchanged", () => {
        const tree = [block({ id: "root" })];
        expect(insertBlock(tree, "ghost", 0, block({ id: "x" }))).toEqual(tree);
    });
});

describe("relabelVariableRefs / renameBlockVariable", () => {
    test("relabel rewrites chips and preserves the icon segment", () => {
        const tree = [block({ id: "a", values: { text: "hi {{b1:Old:star}} bye" } })];
        const out = relabelVariableRefs(tree, "b1", "New");
        expect(out[0].values.text).toBe("hi {{b1:New:star}} bye");
    });

    test("relabel does not touch other blocks' chips", () => {
        const tree = [block({ id: "a", values: { text: "{{zz:Old:star}}" } })];
        const out = relabelVariableRefs(tree, "b1", "New");
        expect(out[0].values.text).toBe("{{zz:Old:star}}");
    });

    test("rename strips chip-breaking characters", () => {
        const out = renameBlockVariable([block({ id: "a" })], "a", "evil:name{with}braces");
        expect(out[0].variableName).toBe("evilnamewithbraces");
    });
});

describe("updateBlockPos / updateBlockValue / walkBlocks", () => {
    test("updates are immutable and scoped to the id", () => {
        const tree = [block({ id: "a", pos: { x: 1, y: 1 } }), block({ id: "b" })];
        const moved = updateBlockPos(tree, "a", { x: 9, y: 9 });
        expect(moved[0].pos).toEqual({ x: 9, y: 9 });
        expect(tree[0].pos).toEqual({ x: 1, y: 1 });
        const valued = updateBlockValue(tree, "b", "k", 42);
        expect(valued[1].values).toEqual({ k: 42 });
        expect(tree[1].values).toEqual({});
    });

    test("walkBlocks maps the whole tree", () => {
        const tree = [block({ id: "a", children: [block({ id: "b" })] })];
        const out = walkBlocks(tree, (b) => ({ ...b, id: `${b.id}!` }));
        expect(out[0].id).toBe("a!");
        expect(out[0].children?.[0].id).toBe("b!");
    });
});

describe("isCanvasBlock", () => {
    test("accepts well-formed blocks", () => {
        expect(isCanvasBlock(block())).toBe(true);
        expect(
            isCanvasBlock(block({ children: [block({ id: "kid" })], elseChildren: [] })),
        ).toBe(true);
    });

    test("rejects malformed payloads", () => {
        for (const bad of [
            null,
            undefined,
            42,
            "block",
            [],
            {},
            { id: "x" },
            block({ id: "" }),
            block({ panelId: 7 } as any),
            block({ isTrigger: "yes" } as any),
            block({ action: null } as any),
            block({ action: { name: "no-id" } } as any),
            block({ children: [null] } as any),
            block({ children: {} } as any),
        ]) {
            expect(isCanvasBlock(bad)).toBe(false);
        }
    });

    test("depth-capped recursion cannot blow the stack", () => {
        let deep: any = block({ id: "leaf" });
        for (let i = 0; i < 100; i++) deep = block({ id: `n${i}`, children: [deep] });
        expect(isCanvasBlock(deep)).toBe(false);
    });
});
