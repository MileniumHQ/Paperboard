import styles from "./index.module.css";
import { splitProps, Show, createSignal, createEffect, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

export interface PaperInputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
    icon?: JSX.Element | string;
    compact?: boolean;
    fullWidth?: boolean;
    invalid?: boolean;
    validate?: (value: string) => boolean;
    defaultValue?: string | number;
    ref?: HTMLInputElement | ((el: HTMLInputElement) => void);
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

    const handleInput: JSX.InputEventHandler<HTMLInputElement, InputEvent> = (e) => {
        if (local.value === undefined) {
            setInternalValue(e.currentTarget.value);
        }
        if (typeof local.onInput === "function") {
            (local.onInput as JSX.InputEventHandler<HTMLInputElement, InputEvent>)(e);
        }
    };

    const handleChange: JSX.EventHandler<HTMLInputElement, Event> = (e) => {
        if (local.value === undefined) {
            setInternalValue(e.currentTarget.value);
        }
        if (typeof local.onChange === "function") {
            (local.onChange as JSX.EventHandler<HTMLInputElement, Event>)(e);
        }
    };

    const className = () =>
        [
            styles.PaperInput,
            local.compact ? styles.compact : "",
            local.fullWidth ? styles.fullWidth : "",
            local.icon ? styles.hasIcon : "",
            isInvalid() ? styles.invalid : "",
            local.disabled ? styles.disabled : "",
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
            <input
                {...rest}
                type={local.type ?? "text"}
                disabled={local.disabled}
                ref={local.ref}
                value={currentValue()}
                aria-invalid={isInvalid() ? "true" : undefined}
                onInput={handleInput}
                onChange={handleChange}
            />
        </div>
    );
}
