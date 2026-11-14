import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import {
    PaperFlex,
    PaperInput,
    PaperRange,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { hasKnownMcVersion } from "../lib/capabilities";
import type { PropertyField } from "../lib/properties";

/**
 * A setting row's description, followed while the typed value can't be used
 * by why not, in the colour of an error.
 */
export function describeWithProblem(description: JSX.Element, problem: string): JSX.Element {
    if (!description && !problem) return undefined;
    return (
        <>
            {description}
            <Show when={problem}>
                {description ? " " : ""}
                <PaperText preset="error">{problem}</PaperText>
            </Show>
        </>
    );
}

/** What a number field takes, as the sentence shown while a typed value doesn't fit it. */
function numberRange(field: PropertyField): string {
    const kind = field.step === "any" ? "a number" : "a whole number";
    if (field.min !== undefined && field.max !== undefined) return `Must be ${kind} from ${field.min} to ${field.max}.`;
    if (field.min !== undefined) return `Must be ${kind} of at least ${field.min}.`;
    if (field.max !== undefined) return `Must be ${kind} of at most ${field.max}.`;
    return `Must be ${kind}.`;
}

/** A field's setting row: its title, its description and, while the typed value can't be used, why not. */
export function FieldItem(props: {
    field: PropertyField;
    description?: JSX.Element;
    value: () => string;
    onUpdate: (value: string) => void;
}) {
    const [problem, setProblem] = createSignal("");
    return (
        <PaperSettingItem title={props.field.title} description={describeWithProblem(props.description ?? props.field.description, problem())}>
            <FieldControl field={props.field} value={props.value} onUpdate={props.onUpdate} onProblem={setProblem} />
        </PaperSettingItem>
    );
}

// Component so the DOM node persists across value changes and transitions play
export function FieldControl(props: {
    field: PropertyField;
    value: () => string;
    onUpdate: (value: string) => void;
    /** why the typed value can't be used, or "" once it can */
    onProblem?: (problem: string) => void;
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
            // render it as invalid, with why; a valid value flows to the
            // parent. On blur a valid draft drops and the input shows the
            // saved value; a rejected one stays until it is corrected.
            const [draft, setDraft] = createSignal<string | null>(null);
            const shown = () => draft() ?? props.value();
            const invalid = () => {
                const raw = shown().trim();
                if (raw === "") return true;
                const num = Number(raw);
                if (!Number.isFinite(num)) return true;
                if (field.step !== "any" && !Number.isInteger(num)) return true;
                if (field.min !== undefined && num < field.min) return true;
                if (field.max !== undefined && num > field.max) return true;
                return false;
            };
            createEffect(() => props.onProblem?.(invalid() ? numberRange(field) : ""));
            return (
                <PaperFlex width="field">
                    <PaperInput
                        fullWidth
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
                        onBlur={() => {
                            if (!invalid()) setDraft(null);
                        }}
                    />
                </PaperFlex>
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
                <PaperFlex width="field-wide">
                    <PaperInput
                        fullWidth
                        value={props.value()}
                        maxLength={props.field.maxLength}
                        disabled={!hasKnownMcVersion()}
                        onInput={(e) => props.onUpdate(e.currentTarget.value)}
                    />
                </PaperFlex>
            );
    }
}
