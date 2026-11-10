// Workspaces for the tests, built the way the editor builds them: every one
// goes through a real (headless) Blockly load and save, so the shapes are
// Blockly's own.
import * as Blockly from "blockly";
import type { SavedBlock, SavedWorkspace } from "../../src/lib/interpreter";

export type Json = Record<string, unknown>;
export const text = (t: string) => ({ shadow: { type: "text", fields: { TEXT: t } } });
export const num = (n: number) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
export const block = (type: string, rest: Json = {}) => ({ block: { type, ...rest } });
export const steps = (...blocks: Json[]): Json | undefined => {
    let next: Json | undefined;
    for (const b of [...blocks].reverse()) next = { block: { ...b, ...(next ? { next } : {}) } };
    return next;
};

/** A workspace as the editor would save it: loaded into Blockly and saved back. */
export function saved(blocks: Json[], variables: { name: string; id: string }[] = []): SavedWorkspace {
    const ws = new Blockly.Workspace();
    try {
        Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks }, ...(variables.length ? { variables } : {}) }, ws);
        return Blockly.serialization.workspaces.save(ws) as SavedWorkspace;
    } finally {
        ws.dispose();
    }
}

export const top = (ws: SavedWorkspace, type: string) => ws.blocks!.blocks.find((b) => b.type === type)!;
export const find = (ws: SavedWorkspace, type: string): SavedBlock => {
    const walk = (b: SavedBlock | undefined): SavedBlock | undefined => {
        if (!b) return undefined;
        if (b.type === type) return b;
        for (const input of Object.values(b.inputs ?? {})) {
            const hit = walk(input.block) ?? walk(input.shadow);
            if (hit) return hit;
        }
        return walk(b.next?.block);
    };
    for (const b of ws.blocks!.blocks) {
        const hit = walk(b);
        if (hit) return hit;
    }
    throw new Error(`no ${type} block`);
};
