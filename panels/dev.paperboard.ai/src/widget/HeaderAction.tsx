// A widget's one way out (Retry, Start, Open AI, Unload) as the header's
// compact icon button: a 1-row tile has no room for a message's own
// buttons under a description.

import { PaperButton } from "@mileniumhq/paperui";

export interface WidgetAction {
    /** Material Symbols name */
    icon: string;
    /** the accessible name and tooltip */
    label: string;
    run: () => void;
    disabled?: boolean;
    primary?: boolean;
}

export function HeaderAction(props: { action: WidgetAction }) {
    return (
        <PaperButton
            icon
            size="tiny"
            variant={props.action.primary ? "primary" : "text"}
            aria-label={props.action.label}
            title={props.action.label}
            disabled={props.action.disabled}
            onClick={() => props.action.run()}
        >
            {props.action.icon}
        </PaperButton>
    );
}
