import type { ActionSchema, TriggerSchema } from "@paperboard-dev/paperapi";

export interface CanvasBlock {
    id: string;
    panelId: string;
    pos: { x: number; y: number };
    isTrigger: boolean;
    action: ActionSchema | TriggerSchema;
    iconSrc?: string;
    values: Record<string, any>;
    variableName?: string;
    zIndex?: number;
    children?: CanvasBlock[];
    elseChildren?: CanvasBlock[];
}

export function outputLabelOf(action: ActionSchema | TriggerSchema): string | null {    const out = (action as ActionSchema)?.output;
    if (!out) return null;
    if (typeof out === "string") return out;
    return (out as any).label || (out as any).type || null;
}

export function blockVariableName(block: CanvasBlock): string | null {
    if (block.variableName?.trim()) return block.variableName.trim();
    return outputLabelOf(block.action);
}

// shape validator for stored/synced flows: the sync-flows boundary filters
// with this instead of accepting arbitrary arrays. Recursion is depth-
// capped so a hostile nested payload cannot blow the stack.
const MAX_BLOCK_DEPTH = 32;

// Where a dragged block may land. A zone can declare the only action id it
// accepts (a Switch's rows take Cases), and a Case only ever lives inside a
// Switch; the executor enforces the same rules at run time.
export function isDropAllowed(
    target: { parentId: string; accepts?: string | null } | null,
    actionId: string | undefined,
    findParent: (id: string) => CanvasBlock | null,
): boolean {
    if (!target) return false;
    if (target.accepts && target.accepts !== actionId) return false;
    if (actionId === "switch-case") {
        const parent = findParent(target.parentId.replace(/:else$/, ""));
        return parent?.action?.id === "switch";
    }
    return true;
}

export function isCanvasBlock(value: unknown, depth = 0): value is CanvasBlock {
    if (!value || typeof value !== "object") return false;
    if (depth > MAX_BLOCK_DEPTH) return false;
    const b = value as Record<string, unknown>;
    if (typeof b.id !== "string" || b.id.length === 0) return false;
    if (typeof b.panelId !== "string") return false;
    if (typeof b.isTrigger !== "boolean") return false;
    const action = b.action as Record<string, unknown> | null;
    if (!action || typeof action !== "object" || typeof action.id !== "string") return false;
    if (b.values !== undefined && (typeof b.values !== "object" || b.values === null)) return false;
    for (const key of ["children", "elseChildren"] as const) {
        const kids = b[key];
        if (kids === undefined) continue;
        if (!Array.isArray(kids)) return false;
        if (!kids.every((k) => isCanvasBlock(k, depth + 1))) return false;
    }
    return true;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function walkBlocks(
    blocks: CanvasBlock[],
    fn: (block: CanvasBlock) => CanvasBlock,
): CanvasBlock[] {
    return blocks.map((item) => {
        const mapped = fn(item);
        const children = mapped.children ? walkBlocks(mapped.children, fn) : mapped.children;
        const elseChildren = mapped.elseChildren
            ? walkBlocks(mapped.elseChildren, fn)
            : mapped.elseChildren;
        if (children !== mapped.children || elseChildren !== mapped.elseChildren) {
            return { ...mapped, children, elseChildren };
        }
        return mapped;
    });
}

/**
 * Refreshes each block's action/trigger schema from the live registry while
 * keeping its id, position, values and name. Stored flows otherwise keep the
 * schema they were dragged with, so newly declared metadata (typed output
 * fields, categories, options) would never reach existing blocks.
 */
export function mergeActionSchemas(
    blocks: CanvasBlock[],
    actions: { panelId: string; action: string; schema?: ActionSchema }[],
    triggers: { panelId: string; trigger: string; schema?: TriggerSchema }[],
): CanvasBlock[] {
    const actionMap = new Map<string, ActionSchema>();
    for (const entry of actions) {
        if (entry.schema) actionMap.set(`${entry.panelId}:${entry.action}`, entry.schema);
    }
    const triggerMap = new Map<string, TriggerSchema>();
    for (const entry of triggers) {
        if (entry.schema) triggerMap.set(`${entry.panelId}:${entry.trigger}`, entry.schema);
    }
    return walkBlocks(blocks, (block) => {
        const actionId = (block.action as { id?: string } | undefined)?.id;
        if (!actionId) return block;
        const fresh = (block.isTrigger ? triggerMap : actionMap).get(
            `${block.panelId}:${actionId}`,
        );
        if (!fresh) return block;
        return { ...block, action: fresh };
    });
}

export function relabelVariableRefs(
    blocks: CanvasBlock[],
    blockId: string,
    newLabel: string,
): CanvasBlock[] {
    const pattern = new RegExp(`\\{\\{${escapeRegExp(blockId)}:[^}]*\\}\\}`, "g");
    const rewrite = (val: any): any => {
        if (typeof val === "string") {
            return val.replace(pattern, (m) => {
                const icon = m.slice(2, -2).split(":")[2] || "";
                return `{{${blockId}:${newLabel}:${icon}}}`;
            });
        }
        if (Array.isArray(val)) return val.map(rewrite);
        return val;
    };
    return walkBlocks(blocks, (item) => {
        const values: Record<string, any> = {};
        for (const [k, v] of Object.entries(item.values || {})) {
            values[k] = rewrite(v);
        }
        return { ...item, values };
    });
}

export function renameBlockVariable(
    blocks: CanvasBlock[],
    blockId: string,
    name: string,
): CanvasBlock[] {
    // colons and braces would corrupt the {{id:label:icon}} chip format
    const clean = name.trim().replace(/[{}:]/g, "");
    return walkBlocks(blocks, (item) =>
        item.id === blockId ? { ...item, variableName: clean ? clean : undefined } : item,
    );
}

export function findOwnerTrigger(
    blocks: CanvasBlock[],
    id: string,
): CanvasBlock | null {
    for (const b of blocks) {
        if (b.id === id) {
            return b.isTrigger ? b : null;
        }
        const contains =
            (b.children && findBlock(b.children, id)) ||
            (b.elseChildren && findBlock(b.elseChildren, id));
        if (contains) {
            return b.isTrigger ? b : null;
        }
    }
    return null;
}

export function findBlock(
    blocks: CanvasBlock[],
    id: string,
): CanvasBlock | null {
    for (const b of blocks) {
        if (b.id === id) return b;
        if (b.children && b.children.length > 0) {
            const found = findBlock(b.children, id);
            if (found) return found;
        }
        if (b.elseChildren && b.elseChildren.length > 0) {
            const found = findBlock(b.elseChildren, id);
            if (found) return found;
        }
    }
    return null;
}

export function removeBlock(
    blocks: CanvasBlock[],
    id: string,
): { blocks: CanvasBlock[]; removed: CanvasBlock | null } {
    let removed: CanvasBlock | null = null;

    function filterTree(list: CanvasBlock[]): CanvasBlock[] {
        const result: CanvasBlock[] = [];
        for (const item of list) {
            if (item.id === id) {
                removed = item;
                continue;
            }
            let children = item.children;
            let elseChildren = item.elseChildren;
            if (children && children.length > 0) {
                children = filterTree(children);
            }
            if (elseChildren && elseChildren.length > 0) {
                elseChildren = filterTree(elseChildren);
            }
            result.push({
                ...item,
                children,
                elseChildren,
            });
        }
        return result;
    }

    const updated = filterTree(blocks);
    return { blocks: updated, removed };
}

export function insertBlock(
    blocks: CanvasBlock[],
    targetParentId: string | null,
    insertIndex: number,
    blockToInsert: CanvasBlock,
): CanvasBlock[] {
    if (!targetParentId) {
        const copy = [...blocks];
        copy.splice(
            Math.max(0, Math.min(insertIndex, copy.length)),
            0,
            blockToInsert,
        );
        return copy;
    }

    const isElseBranch = targetParentId.endsWith(":else");
    const rawParentId = isElseBranch ? targetParentId.slice(0, -5) : targetParentId;

    function insertIntoTree(list: CanvasBlock[]): CanvasBlock[] {
        return list.map((item) => {
            if (item.id === rawParentId) {
                if (isElseBranch) {
                    const currentElse = [...(item.elseChildren || [])];
                    const validIndex = Math.max(
                        0,
                        Math.min(insertIndex, currentElse.length),
                    );
                    currentElse.splice(validIndex, 0, {
                        ...blockToInsert,
                        pos: { x: 0, y: 0 },
                    });
                    return {
                        ...item,
                        elseChildren: currentElse,
                    };
                } else {
                    const currentChildren = [...(item.children || [])];
                    const validIndex = Math.max(
                        0,
                        Math.min(insertIndex, currentChildren.length),
                    );
                    currentChildren.splice(validIndex, 0, {
                        ...blockToInsert,
                        pos: { x: 0, y: 0 },
                    });
                    return {
                        ...item,
                        children: currentChildren,
                    };
                }
            }

            let updatedItem = item;
            if (item.children && item.children.length > 0) {
                updatedItem = {
                    ...updatedItem,
                    children: insertIntoTree(item.children),
                };
            }
            if (item.elseChildren && item.elseChildren.length > 0) {
                updatedItem = {
                    ...updatedItem,
                    elseChildren: insertIntoTree(item.elseChildren),
                };
            }
            return updatedItem;
        });
    }

    return insertIntoTree(blocks);
}

export function updateBlockPos(
    blocks: CanvasBlock[],
    id: string,
    newPos: { x: number; y: number },
): CanvasBlock[] {
    return blocks.map((b) => (b.id === id ? { ...b, pos: newPos } : b));
}

export function updateBlockValue(
    blocks: CanvasBlock[],
    blockId: string,
    paramKey: string,
    val: any,
): CanvasBlock[] {
    function updateInTree(list: CanvasBlock[]): CanvasBlock[] {
        return list.map((item) => {
            if (item.id === blockId) {
                return {
                    ...item,
                    values: {
                        ...(item.values || {}),
                        [paramKey]: val,
                    },
                };
            }

            let updated = item;
            if (item.children && item.children.length > 0) {
                updated = {
                    ...updated,
                    children: updateInTree(item.children),
                };
            }
            if (item.elseChildren && item.elseChildren.length > 0) {
                updated = {
                    ...updated,
                    elseChildren: updateInTree(item.elseChildren),
                };
            }
            return updated;
        });
    }

    return updateInTree(blocks);
}
