// TODO(remove after v0.4): flows saved before 0.3 may still hold two steps
// 0.3 removed. Loading the canvas (once, then stamped CANVAS_VERSION) and
// importing a flow file both pass the flows through here:
// - Get Variable with a literal name becomes the variable chip itself: every
//   input that read the block's output reads the variable by name instead,
//   which is what the variable picker stores.
// - Bot Creator's Defer Interaction did nothing once the bot acknowledged
//   every interaction itself: it goes, and an input that read its Success
//   output reads "true".
// A Get Variable whose name is itself a reference can't become a chip; it
// stays, and fails at run time as the unknown step it is.
import type { CanvasBlock } from "./tree";

/** the canvas.json layout this panel writes; documents without one are from before 0.3 */
export const CANVAS_VERSION = 2;

const GET_VARIABLE = { panelId: "builtin.logic", action: "get-variable" };
const DEFER_INTERACTION = { panelId: "dev.paperboard.botcreator", action: "defer-interaction" };

const is = (block: CanvasBlock, step: { panelId: string; action: string }) =>
    block.panelId === step.panelId && block.action?.id === step.action;

export interface RemovedSteps {
    flows: CanvasBlock[];
    /** blocks taken out */
    removed: number;
    /** Get Variable blocks left in place: their name is a reference */
    kept: number;
}

/** What a chip naming the removed block reads instead, or null to keep the block. */
function replacementFor(block: CanvasBlock): string | null {
    if (is(block, DEFER_INTERACTION)) return "true";
    if (!is(block, GET_VARIABLE)) return null;
    const key = block.values?.key;
    if (typeof key !== "string") return null;
    const name = key.trim();
    if (!name || /[{}:]/.test(name)) return null;
    return `{{${name}:${name}:data_object}}`;
}

export function withoutRemovedSteps(flows: CanvasBlock[]): RemovedSteps {
    const replacements = new Map<string, string>();
    let kept = 0;
    const collect = (blocks: CanvasBlock[] | undefined) => {
        for (const block of blocks ?? []) {
            const replacement = replacementFor(block);
            if (replacement !== null) replacements.set(block.id, replacement);
            else if (is(block, GET_VARIABLE)) kept++;
            collect(block.children);
            collect(block.elseChildren);
        }
    };
    collect(flows);
    if (replacements.size === 0) return { flows, removed: 0, kept };

    // a chip is {{token:label:icon}}; one whose token names a removed block
    // becomes what that block's output was
    const rewrite = (value: unknown): unknown => {
        if (typeof value === "string") {
            return value.replace(/\{\{([^{}]+)\}\}/g, (whole, inner: string) => {
                const cut = inner.indexOf(":");
                const token = (cut < 0 ? inner : inner.slice(0, cut)).trim();
                return replacements.get(token) ?? whole;
            });
        }
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
        }
        return value;
    };

    const strip = (blocks: CanvasBlock[]): CanvasBlock[] =>
        blocks.flatMap((block): CanvasBlock[] => {
            const children = block.children && strip(block.children);
            const elseChildren = block.elseChildren && strip(block.elseChildren);
            // a removed step is a plain step; anything nested under it stays, in its place
            if (replacements.has(block.id)) return [...(children ?? []), ...(elseChildren ?? [])];
            const next: CanvasBlock = { ...block, values: rewrite(block.values ?? {}) as Record<string, any> };
            if (children) next.children = children;
            if (elseChildren) next.elseChildren = elseChildren;
            return [next];
        });

    return { flows: strip(flows), removed: replacements.size, kept };
}
