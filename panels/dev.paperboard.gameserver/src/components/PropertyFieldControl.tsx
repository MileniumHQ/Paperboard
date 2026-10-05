import { createSignal, For } from "solid-js";
import {
    PaperInput,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperToggle,
} from "@mileniumhq/paperui";
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
        case "number": {
            // the draft keeps the rejected keystroke visible so the input can
            // render it as invalid; a valid value flows to the parent. On
            // blur the draft drops and the input returns to the saved value.
            const [draft, setDraft] = createSignal<string | null>(null);
            const shown = () => draft() ?? props.value();
            const invalid = () => {
                const raw = shown().trim();
                if (raw === "") return true;
                const num = Number(raw);
                if (!Number.isFinite(num)) return true;
                if (field.min !== undefined && num < field.min) return true;
                if (field.max !== undefined && num > field.max) return true;
                return false;
            };
            return (
                <PaperInput
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={shown()}
                    invalid={invalid()}
                    disabled={!hasKnownMcVersion()}
                    onInput={(e) => {
                        setDraft(e.currentTarget.value);
                        props.onUpdate(e.currentTarget.value);
                    }}
                    onBlur={() => setDraft(null)}
                />
            );
        }
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
