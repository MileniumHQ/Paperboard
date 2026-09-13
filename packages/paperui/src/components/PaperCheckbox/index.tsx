import styles from "./index.module.css";
import { splitProps, createSignal, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

export interface PaperCheckboxProps
    extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
    checked?: boolean;
    defaultChecked?: boolean;
    onChange?: (checked: boolean) => void;
    label?: JSX.Element | string;
    description?: JSX.Element | string;
}

export function PaperCheckbox(props: PaperCheckboxProps) {
    let inputRef: HTMLInputElement | undefined;

    const [local, rest] = splitProps(props, [
        "checked",
        "defaultChecked",
        "onChange",
        "label",
        "description",
        "disabled",
        "class",
        "classList",
    ]);

    const [internalChecked, setInternalChecked] = createSignal(
        local.defaultChecked ?? false,
    );

    const isChecked = () => local.checked ?? internalChecked();

    const handleToggle = () => {
        if (local.disabled) return;
        const next = !isChecked();

        if (local.checked === undefined) {
            setInternalChecked(next);
        }

        if (inputRef) {
            inputRef.checked = next;
            inputRef.dispatchEvent(new Event("change", { bubbles: true }));
            inputRef.dispatchEvent(new Event("input", { bubbles: true }));
        }

        local.onChange?.(next);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            handleToggle();
        }
    };

    return (
        <label
            class={[
                styles.PaperCheckboxContainer,
                local.disabled ? styles.disabled : "",
                local.class,
            ]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
            onClick={(e) => {
                e.preventDefault();
                handleToggle();
            }}
        >
            <div
                role="checkbox"
                aria-checked={isChecked()}
                tabIndex={local.disabled ? -1 : 0}
                class={[
                    styles.PaperCheckbox,
                    isChecked() ? styles.checked : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
                onKeyDown={handleKeyDown}
            >
                <input
                    ref={inputRef}
                    {...rest}
                    type="checkbox"
                    checked={isChecked()}
                    disabled={local.disabled}
                    class={styles.hiddenInput}
                    tabIndex={-1}
                    readOnly
                />
                <div class={styles.box}>
                    <Show when={isChecked()}>
                        <PaperIcon class={styles.iconCheck} zeroHeight>
                            check
                        </PaperIcon>
                    </Show>
                </div>
            </div>

            <Show when={local.label || local.description}>
                <div class={styles.content}>
                    <Show when={local.label}>
                        <span class={styles.label}>{local.label}</span>
                    </Show>
                    <Show when={local.description}>
                        <span class={styles.description}>
                            {local.description}
                        </span>
                    </Show>
                </div>
            </Show>
        </label>
    );
}
