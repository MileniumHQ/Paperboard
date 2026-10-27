// A field that holds one variable instead of its literal value: the
// variable's chip, and the button that clears back to the literal.
import { PaperIcon } from "@mileniumhq/paperui";
import type { VariableToken } from "../../lib/variableTypes";

export default function BoundVariable(props: { variable: VariableToken }) {
    return (
        <>
            <span
                class="actionVariableChip"
                data-var-id={props.variable.id}
                data-label={props.variable.label}
                data-icon={props.variable.icon}
            >
                <span class="chipIcon">{props.variable.icon}</span>
                <span class="chipLabel">{props.variable.label}</span>
            </span>
            <span
                class="actionBoolClear"
                title="Clear variable"
            >
                <PaperIcon>close</PaperIcon>
            </span>
        </>
    );
}
