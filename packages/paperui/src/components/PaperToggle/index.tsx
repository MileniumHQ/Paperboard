import styles from "./index.module.css";
import { splitProps, createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { haptic } from "../../utils/haptics";
import { useSettingListChecked } from "../../contexts/settingList";

export interface PaperToggleProps
    extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
    checked?: boolean;
    defaultChecked?: boolean;
    onChange?: (checked: boolean) => void;
    showIcons?: boolean;
}

// how long the knob takes to travel (its CSS transition), and how long a
// press waits for a parent to answer with the new state before it is let go
const KNOB_TRAVEL_MS = 380;
const PARENT_ANSWER_MS = 10_000;

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
        // the tooltip belongs on the switch people point at
        "title",
    ]);

    const [internalChecked, setInternalChecked] = createSignal(
        local.defaultChecked ?? false
    );

    // in a PaperSettingList, the list's record holds the state
    const listChecked = useSettingListChecked(() => rest.name, "PaperToggle");
    const isChecked = () => local.checked ?? listChecked() ?? internalChecked();

    // A press asks for a flip; the switch only flips once its state does. A
    // controlled switch waits for its parent (a setting saved first), so the
    // knob's thump follows the knob, never the press ahead of it.
    let expected = false;
    let expectedTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
        clearTimeout(expectedTimer);
        clearTimeout(settleTimer);
    });

    createEffect(
        on(
            isChecked,
            () => {
                // a change nobody pressed for (a reload, a reset) moves the knob without a thump
                if (!expected) return;
                expected = false;
                clearTimeout(expectedTimer);
                // the knob gathers speed and thumps into the far edge, either way
                haptic("toggle");
                setIsAnimating(true);
                clearTimeout(settleTimer);
                settleTimer = setTimeout(() => setIsAnimating(false), KNOB_TRAVEL_MS);
            },
            { defer: true },
        ),
    );

    const flip = (next: boolean) => {
        expected = true;
        clearTimeout(expectedTimer);
        // a parent that refuses the flip leaves nothing to feel
        expectedTimer = setTimeout(() => (expected = false), PARENT_ANSWER_MS);

        if (local.checked === undefined) {
            setInternalChecked(next);
        }
    };

    const handleToggle = (e?: MouseEvent) => {
        // A wrapping label's text sends its click to the hidden checkbox. The
        // browser has already flipped it, and fires its change event once
        // this click is done: the switch follows the checkbox.
        if (e && e.target === inputRef) {
            flip(inputRef.checked);
            local.onChange?.(inputRef.checked);
            return;
        }
        // A click on the switch: a wrapping label would send it on to the
        // hidden checkbox, which would flip back and report the old value.
        // Cancelling the click cancels the label's activation, and the
        // switch flips the checkbox itself.
        e?.preventDefault();
        if (local.disabled) return;
        const next = !isChecked();
        flip(next);
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
            aria-disabled={local.disabled ? "true" : undefined}
            aria-label={local["aria-label"]}
            aria-labelledby={local["aria-labelledby"]}
            aria-describedby={local["aria-describedby"]}
            title={local.title}
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
