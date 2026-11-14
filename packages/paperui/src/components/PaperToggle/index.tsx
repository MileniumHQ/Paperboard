import styles from "./index.module.css";
import { splitProps, createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { haptic } from "../../utils/haptics";
import { useSettingListChecked } from "../../contexts/settingList";

export interface PaperToggleProps
    extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
    checked?: boolean;
    defaultChecked?: boolean;
    /**
     * Called on a press with the state asked for. Return the save's promise
     * when the state changes only once it is saved: the knob's thump waits
     * for it.
     */
    onChange?: (checked: boolean) => void | Promise<unknown>;
    showIcons?: boolean;
}

// how long the knob takes to travel (its CSS transition)
const KNOB_TRAVEL_MS = 380;

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

    // A press asks for a flip; the switch only flips once its state does, so
    // the knob's thump follows the knob, never the press ahead of it. The
    // switch waits for the answer to its own press only: while onChange runs,
    // and until the promise onChange returns (a setting saved first) settles.
    // A parent that refuses leaves nothing waiting, and a change nobody
    // pressed for (a reload, a reset) moves the knob without a thump.
    let presses = 0;
    let waitingFor = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(settleTimer));

    createEffect(
        on(
            isChecked,
            () => {
                if (!waitingFor) return;
                waitingFor = 0;
                // the knob gathers speed and thumps into the far edge, either way
                haptic("toggle");
                setIsAnimating(true);
                clearTimeout(settleTimer);
                settleTimer = setTimeout(() => setIsAnimating(false), KNOB_TRAVEL_MS);
            },
            { defer: true },
        ),
    );

    const stopWaiting = (press: number) => {
        if (waitingFor === press) waitingFor = 0;
    };

    /**
     * A press asking for `next`. `answer` tells the parent: it may change the
     * state at once, or return a promise that it changes it by.
     * `untilChange`: the hidden checkbox still has its change event to fire
     * (a label's click), and a parent listening to it answers then.
     */
    const ask = (next: boolean, answer: () => unknown, untilChange: boolean) => {
        const press = ++presses;
        waitingFor = press;
        let answered: unknown;
        try {
            if (local.checked === undefined) setInternalChecked(next);
            answered = answer();
        } finally {
            if (answered instanceof Promise) {
                // the rejection stays unhandled on the chained promise, so it
                // is still reported, once
                void answered.finally(() => stopWaiting(press));
            } else if (untilChange && inputRef) {
                inputRef.addEventListener("change", () => stopWaiting(press), { once: true });
            } else {
                stopWaiting(press);
            }
        }
    };

    const handleToggle = (e?: MouseEvent) => {
        // A wrapping label's text sends its click to the hidden checkbox. The
        // browser has already flipped it, and fires its input and change
        // events once this click is done: the switch follows the checkbox.
        if (e && e.target === inputRef) {
            const next = inputRef.checked;
            ask(next, () => local.onChange?.(next), true);
            return;
        }
        // A click on the switch: a wrapping label would send it on to the
        // hidden checkbox, which would flip back and report the old value.
        // Cancelling the click cancels the label's activation, and the
        // switch flips the checkbox itself.
        e?.preventDefault();
        if (local.disabled) return;
        const next = !isChecked();
        ask(
            next,
            () => {
                if (inputRef) {
                    inputRef.checked = next;
                    inputRef.dispatchEvent(new Event("change", { bubbles: true }));
                    inputRef.dispatchEvent(new Event("input", { bubbles: true }));
                }
                return local.onChange?.(next);
            },
            false,
        );
        // the hidden checkbox (what a form reads) shows the state held: a
        // parent that kept the old one, or answers later, leaves it at that
        if (inputRef) inputRef.checked = isChecked();
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
