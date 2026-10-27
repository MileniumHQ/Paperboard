// A true/false input, or one boolean variable in its place.
import { Show } from "solid-js";
import { parseVariableToken } from "../../lib/variableTypes";
import BoundVariable from "./BoundVariable";
import { clearVariable, pickVariable, type FieldSlot } from "./slot";

// a boolean holds either a literal (click toggles it) or one variable
// (right-click opens the picker; clicking the chip replaces it, the close
// button clears back to a literal)
export default function BoolField(props: { slot: FieldSlot }) {
    const slot = props.slot;
    const boundVariable = () => parseVariableToken(slot.value());

    const currentBool = () =>
        slot.hasValue()
            ? Boolean(slot.value())
            : Boolean(slot.def?.default ?? false);

    return (
        <span
            class={`actionInput actionInputBool ${boundVariable() ? "hasVariable" : currentBool() ? "isTrue" : "isFalse"}`}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pickVariable(slot, e.clientX, e.clientY, "boolean");
            }}
            onClick={(e) => {
                if (slot.block.static || !slot.block.id) return;
                e.stopPropagation();
                const variable = boundVariable();
                if (variable) {
                    if ((e.target as HTMLElement).closest?.(".actionBoolClear")) {
                        clearVariable(slot, e);
                        return;
                    }
                    pickVariable(slot, e.clientX, e.clientY, "boolean");
                    return;
                }
                slot.block.onValueChange?.(slot.block.id, slot.key, !currentBool());
            }}
            title={
                boundVariable()
                    ? "Click to change the variable, right-click to replace it"
                    : `Click to toggle (${currentBool() ? "True" : "False"})`
            }
        >
            <Show
                when={boundVariable()}
                fallback={currentBool() ? "true" : "false"}
            >
                {(variable) => <BoundVariable variable={variable()} />}
            </Show>
        </span>
    );
}
