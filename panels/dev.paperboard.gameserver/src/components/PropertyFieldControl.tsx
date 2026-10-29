import { createSignal, For } from "solid-js";
import {
    PaperFlex,
    PaperInput,
    PaperRange,
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
                    step={field.step}
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
        case "slider": {
            if (field.min === undefined || field.max === undefined) {
                throw new Error(`Slider field ${field.key} needs a min and a max`);
            }
            // dragging moves the draft; the value is stored once the drag ends
            const [draft, setDraft] = createSignal<number | null>(null);
            // a stored value that isn't a number reads as the field's default,
            // as the Minecraft server itself treats it
            const stored = () => {
                const num = Number(props.value());
                return Number.isFinite(num) ? num : Number(field.defaultValue);
            };
            const shown = () => draft() ?? stored();
            return (
                <PaperFlex width="field-wide">
                    <PaperRange
                        aria-label={field.title}
                        min={field.min}
                        max={field.max}
                        value={shown()}
                        formatValue={(n) => (field.unit ? `${n} ${field.unit}` : String(n))}
                        disabled={!hasKnownMcVersion()}
                        onInput={setDraft}
                        onChange={(next) => {
                            props.onUpdate(String(next));
                            setDraft(null);
                        }}
                    />
                </PaperFlex>
            );
        }
        default:
            return (
                <PaperInput
                    value={props.value()}
                    maxLength={props.field.maxLength}
                    disabled={!hasKnownMcVersion()}
                    onInput={(e) => props.onUpdate(e.currentTarget.value)}
                />
            );
    }
}
