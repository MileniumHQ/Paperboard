// One input on a block, as every field kind sees it: where its value lives,
// how it reads when empty, and the block callbacks that change it.
import type { ActionBlockProps } from "../actionBlockProps";

export interface FieldSlot {
    block: ActionBlockProps;
    key: string;
    def: any;
    label: string;
    value: () => any;
    hasValue: () => boolean;
    placeholder: () => string;
    colorless: () => boolean;
    requiredError: () => boolean;
}

// a field that holds one variable binds it from the picker in place of
// its literal value
export function pickVariable(slot: FieldSlot, x: number, y: number, expectedType: string): void {
    const { block, key } = slot;
    if (block.static || !block.id) return;
    block.onRequestVariablePicker?.(
        block.id,
        key,
        x,
        y,
        (varId, label, icon) => {
            block.onValueChange?.(block.id!, key, `{{${varId}:${label}:${icon}}}`);
        },
        expectedType,
    );
}

export function clearVariable(slot: FieldSlot, e: MouseEvent): void {
    const { block, key } = slot;
    if (block.static || !block.id) return;
    e.stopPropagation();
    block.onValueChange?.(block.id!, key, undefined);
}
