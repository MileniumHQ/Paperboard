import styles from "./index.module.css";
import { splitProps, createSignal, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

export interface PaperToggleProps
    extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
    checked?: boolean;
    defaultChecked?: boolean;
    onChange?: (checked: boolean) => void;
    showIcons?: boolean;
}

export function PaperToggle(props: PaperToggleProps) {
    let inputRef: HTMLInputElement | undefined;
    const [isAnimating, setIsAnimating] = createSignal(false);

    const [local, rest] = splitProps(props, [
        "checked",
        "defaultChecked",
        "onChange",
        "showIcons",
        "disabled",
        "class",
        "classList",
        // the name belongs on the switch people focus, not the hidden checkbox
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
    ]);

    const [internalChecked, setInternalChecked] = createSignal(
        local.defaultChecked ?? false
    );

    const isChecked = () => local.checked ?? internalChecked();

    const handleToggle = (e?: MouseEvent) => {
        // A wrapping label forwards its activation to the hidden checkbox,
        // whose click then bubbles back here. Toggling on both passes would
        // cancel out and leave the switch stuck.
        if (e?.target === inputRef) return;
        if (local.disabled) return;
        const next = !isChecked();

        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), 380);

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
        <div
            role="switch"
            aria-checked={isChecked()}
            aria-label={local["aria-label"]}
            aria-labelledby={local["aria-labelledby"]}
            aria-describedby={local["aria-describedby"]}
            tabIndex={local.disabled ? -1 : 0}
            class={[
                styles.PaperToggle,
                isChecked() ? styles.checked : "",
                isAnimating() ? styles.animating : "",
                local.disabled ? styles.disabled : "",
                local.class,
            ]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
            onClick={handleToggle}
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
            <div class={styles.track}>
                <div class={styles.knob}>
                    <Show when={local.showIcons ?? true}>
                        <PaperIcon
                            class={isChecked() ? styles.iconCheck : styles.iconClose}
                            zeroHeight
                        >
                            {isChecked() ? "check" : "close"}
                        </PaperIcon>
                    </Show>
                </div>
            </div>
        </div>
    );
}
