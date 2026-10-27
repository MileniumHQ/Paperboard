// An input with fixed choices, or one variable in its place.
import { Show } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import { parseVariableToken } from "../../lib/variableTypes";
import BoundVariable from "./BoundVariable";
import { clearVariable, pickVariable, type FieldSlot } from "./slot";

export default function OptionField(props: { slot: FieldSlot }) {
    const slot = props.slot;
    const def = slot.def;
    // a clearable dropdown can be unselected: the empty entry is offered in
    // the picker and shown on the pill as "(any)" (or the schema's own
    // emptyLabel), never auto-replaced by the first option
    const allowEmpty = Boolean(def.allowEmpty);
    const emptyLabel = def.emptyLabel || "(any)";
    const optionList = () => (def.options ?? []) as { label: string; value: any; icon?: string; description?: string }[];
    const selectedVal = () =>
        slot.hasValue()
            ? slot.value()
            : allowEmpty
              ? null
              : (def.default ?? optionList()[0]?.value);
    const selectedOption = () => optionList().find((o: any) => o.value === selectedVal());
    const displayLabel = () =>
        selectedOption()?.label ||
        (slot.hasValue()
            ? String(slot.value())
            : allowEmpty
              ? emptyLabel
              : slot.placeholder());
    // a dropdown holds either a literal option or one variable (right-click
    // opens the picker, like booleans; a wrong-typed value flows to the
    // service and fails loudly in the console)
    const boundVariable = () => parseVariableToken(slot.value());
    const expectedType = typeof def?.type === "string" ? def.type : "string";

    return (
        <span
            class={`actionInput actionInputOption ${slot.colorless() ? "colorless" : ""} ${slot.requiredError() ? "requiredError" : ""}`}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pickVariable(slot, e.clientX, e.clientY, expectedType);
            }}
            onClick={(e) => {
                const block = slot.block;
                if (block.static || !block.id) return;
                e.stopPropagation();
                if (boundVariable()) {
                    if ((e.target as HTMLElement).closest?.(".actionBoolClear")) {
                        clearVariable(slot, e);
                        return;
                    }
                    pickVariable(slot, e.clientX, e.clientY, expectedType);
                    return;
                }
                const target = e.currentTarget as HTMLElement;
                const rect = target.getBoundingClientRect();
                block.onRequestOptionPicker?.(
                    block.id,
                    slot.key,
                    Math.round(rect.left),
                    Math.round(rect.bottom + 4),
                    [
                        ...(allowEmpty ? [{ label: emptyLabel, value: null }] : []),
                        ...optionList(),
                    ],
                    selectedVal(),
                    (newVal) => {
                        block.onValueChange?.(block.id!, slot.key, newVal === null ? undefined : newVal);
                    },
                    target,
                );
            }}
            title={
                boundVariable()
                    ? "Click to change the variable, right-click to replace it"
                    : allowEmpty ? `Select ${slot.label} (${emptyLabel})` : `Select ${slot.label}`
            }
        >
            <Show
                when={boundVariable()}
                fallback={
                    <>
                        <span>{displayLabel()}</span>
                        <PaperIcon class="dropdownChevronIcon">expand_more</PaperIcon>
                    </>
                }
            >
                {(variable) => <BoundVariable variable={variable()} />}
            </Show>
        </span>
    );
}
