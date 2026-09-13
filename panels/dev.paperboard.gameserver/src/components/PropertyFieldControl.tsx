import { For } from "solid-js";
import {
    PaperInput,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperToggle,
} from "@paperboard-dev/paperui";
import { hasKnownMcVersion } from "../lib/capabilities";
import type { PropertyField } from "../lib/properties";

// Component so the DOM node persists across value changes and transitions play
export function FieldControl(props: {
    field: PropertyField;
    value: () => string;
    onUpdate: (value: string) => void;
}) {
    const field = props.field;

    switch (field.control) {
        case "toggle":
            return (
                <PaperToggle
                    checked={props.value() === "true"}
                    onChange={(checked) => props.onUpdate(String(checked))}
                />
            );
        case "select":
            return (
                <PaperSelectMenu
                    name={field.key}
                    value={props.value()}
                    onValueChange={(val) => props.onUpdate(String(val))}
                >
                    <For each={field.options?.() ?? []}>
                        {(option) => (
                            <PaperSelectMenuItem value={option.value}>
                                {option.label}
                            </PaperSelectMenuItem>
                        )}
                    </For>
                </PaperSelectMenu>
            );
        case "number":
            return (
                <PaperInput
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={props.value()}
                    disabled={!hasKnownMcVersion()}
                    onInput={(e) => props.onUpdate(e.currentTarget.value)}
                />
            );
        default:
            return (
                <PaperInput
                    value={props.value()}
                    disabled={!hasKnownMcVersion()}
                    onInput={(e) => props.onUpdate(e.currentTarget.value)}
                />
            );
    }
}
