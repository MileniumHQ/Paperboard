import styles from "./index.module.css";
import { splitProps, Show, createSignal, createEffect, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

/**
 * `ref` is re-declared because the multiline form hands back a textarea, which
 * the inherited input signature cannot express. Attributes that only exist on
 * an input (`type`, `min`, `max`, `step`, `pattern`, `size`) have no effect on a
 * multiline field and are ignored.
 */
export interface PaperInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "ref"> {
    icon?: JSX.Element | string;
    compact?: boolean;
    fullWidth?: boolean;
    invalid?: boolean;
    validate?: (value: string) => boolean;
    defaultValue?: string | number;
    ref?: HTMLInputElement | HTMLTextAreaElement | ((el: HTMLInputElement) => void);
    /** Renders a textarea instead of a single-line field. Every other prop behaves the same. */
    multiline?: boolean;
    /** Visible text rows when multiline. Ignored otherwise. */
    rows?: number;
    /** Whether the browser resize affordance is available when multiline. */
    resize?: boolean;
}

export function PaperInput(props: PaperInputProps) {
    const [local, rest] = splitProps(props, [
        "icon",
        "compact",
        "fullWidth",
        "invalid",
        "validate",
        "value",
        "defaultValue",
        "type",
        "disabled",
        "class",
        "classList",
        "onInput",
        "onChange",
        "ref",
        "multiline",
        "rows",
        "resize",
    ]);

    const [internalValue, setInternalValue] = createSignal(
        String(local.value ?? local.defaultValue ?? "")
    );

    createEffect(() => {
        if (local.value !== undefined) {
            setInternalValue(String(local.value));
        }
    });

    const currentValue = () => (local.value !== undefined ? String(local.value) : internalValue());

    const isInvalid = () => {
        if (local.invalid !== undefined) return local.invalid;
        if (local.validate) return !local.validate(currentValue());
        return false;
    };

    const handleInput: JSX.InputEventHandler<HTMLInputElement | HTMLTextAreaElement, InputEvent> = (e) => {
        if (local.value === undefined) {
            setInternalValue(e.currentTarget.value);
        }
        if (typeof local.onInput === "function") {
            (local.onInput as JSX.InputEventHandler<HTMLInputElement, InputEvent>)(e as never);
        }
    };

    const handleChange: JSX.EventHandler<HTMLInputElement | HTMLTextAreaElement, Event> = (e) => {
        if (local.value === undefined) {
            setInternalValue(e.currentTarget.value);
        }
        if (typeof local.onChange === "function") {
            (local.onChange as JSX.EventHandler<HTMLInputElement, Event>)(e as never);
        }
    };

    const isMultiline = () => Boolean(local.multiline);

    // width:fit-content assumes a single-line field; a textarea should fill the
    // frame it is given, and its resize handle must not be clipped.
    const className = () =>
        [
            styles.PaperInput,
            local.compact ? styles.compact : "",
            local.fullWidth ? styles.fullWidth : "",
            local.icon ? styles.hasIcon : "",
            isInvalid() ? styles.invalid : "",
            local.disabled ? styles.disabled : "",
            isMultiline() ? styles.multiline : "",
            isMultiline() && local.resize === false ? styles.fixedSize : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            class={className()}
            classList={local.classList}
            data-disabled={local.disabled ? "true" : "false"}
            data-invalid={isInvalid() ? "true" : "false"}
        >
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon class={styles.inputIcon} zeroHeight>
                        {local.icon}
                    </PaperIcon>
                ) : (
                    <span class={styles.inputIcon}>{local.icon}</span>
                )}
            </Show>
            <Show
                when={isMultiline()}
                fallback={
                    <input
                        {...rest}
                        type={local.type ?? "text"}
                        disabled={local.disabled}
                        ref={local.ref as never}
                        value={currentValue()}
                        aria-invalid={isInvalid() ? "true" : undefined}
                        onInput={handleInput as never}
                        onChange={handleChange as never}
                    />
                }
            >
                <textarea
                    {...(rest as unknown as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
                    rows={local.rows ?? 4}
                    disabled={local.disabled}
                    ref={local.ref as never}
                    value={currentValue()}
                    aria-invalid={isInvalid() ? "true" : undefined}
                    onInput={handleInput as never}
                    onChange={handleChange as never}
                />
            </Show>
        </div>
    );
}
