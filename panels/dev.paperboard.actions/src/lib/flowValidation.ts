import { normalizeMatchRules } from "@mileniumhq/paperapi";
import { isBlankMatchInput } from "./runtime";
import { isCanvasBlock, isEventOnlyAction, walkBlocks, type CanvasBlock } from "./tree";

/** The sync boundary owns these rules; tests call the same validator. */
export function validateFlowDefinitions(input: unknown[]): CanvasBlock[] {
    // Executable definitions are refused as a whole if any block is invalid.
    const valid = input.filter(isCanvasBlock);
    if (valid.length !== input.length) throw new Error("Flow sync refused: malformed blocks; repair them before applying");
    for (const b of valid) {
        if (!b.panelId || b.panelId === "*") throw new Error(`Flow "${b.id}" needs an explicit source panel`);
        // a match input is either a literal (filters) or, when
        // the schema declares allowEmpty, unselected ("(any)"):
        // the trigger fires for every payload. A variable chip can
        // never be routing identity: refuse it loudly instead of
        // saving a dead listener.
        for (const rule of normalizeMatchRules((b.action as any)?.match)) {
            const def = (b.action as any)?.inputs?.[rule.input];
            const literal = b.values?.[rule.input];
            if (isBlankMatchInput(literal)) {
                if (def?.allowEmpty) continue;
                throw new Error(
                    `Flow "${b.id}": "${b.action.name}" needs a value for "${rule.input}" — without it this trigger would never fire`,
                );
            }
            if (typeof literal === "string" && literal.includes("{{")) {
                throw new Error(
                    `Flow "${b.id}": "${rule.input}" on "${b.action.name}" must be a literal value, not a variable`,
                );
            }
        }
        for (const nested of walkBlocks(b.children || [], (c) => c)) {
            if (isEventOnlyAction(nested.action)) {
                throw new Error(
                    `Flow "${b.id}": "${nested.action.name}" fires as an event and starts flows; it cannot be nested`,
                );
            }
        }
    }
    return valid;
}
