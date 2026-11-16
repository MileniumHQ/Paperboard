import { createEffect, createSignal, For, on, Show, type Component } from "solid-js";
import { PaperBadge, PaperButton, PaperFlex, PaperPopover, PaperText } from "@mileniumhq/paperui";
import type { PanelProblem } from "@mileniumhq/paperapi";
import { systemErrorWords } from "../../lib/systemErrorWords";
import styles from "./ComputerSidebar.module.css";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * A panel's problems, on its row in the sidebar: what failed with no button
 * waiting to say it. The badge counts them and opens the list, where each
 * one is read whole and can be dismissed; the panel clears one itself once
 * it is fixed.
 */
const PanelProblems: Component<{
    panelName: string;
    problems: PanelProblem[];
    onDismiss: (key: string) => void;
}> = (props) => {
    let button: HTMLButtonElement | undefined;
    const [open, setOpen] = createSignal(false);
    const count = () => props.problems.length;
    const label = () => `${props.panelName}: ${count() === 1 ? "1 problem" : `${count()} problems`}`;
    // the last one dismissed (or cleared) leaves nothing to show
    createEffect(on(count, (n) => {
        if (n === 0) setOpen(false);
    }));
    return (
        <Show when={count() > 0}>
            <PaperButton
                ref={button}
                size="tiny"
                variant="text"
                class={styles.problems}
                title={label()}
                aria-label={label()}
                aria-expanded={open()}
                onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                onClick={(e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(!open());
                }}
            >
                <PaperBadge variant="danger">{count()}</PaperBadge>
            </PaperButton>
            <PaperPopover open={open()} anchor={button} onClose={() => setOpen(false)} title={props.panelName}>
                <For each={props.problems}>
                    {(problem) => (
                        <PaperFlex direction="row" gap="half" align="flex-start" data-problem={problem.key}>
                            <PaperFlex direction="column" flex={1} minWidth={0}>
                                <PaperText preset="label" breakWord>{problem.title}</PaperText>
                                <PaperText preset="hint" breakWord>{`${time(problem.at)} · ${systemErrorWords(problem.message)}`}</PaperText>
                            </PaperFlex>
                            <PaperButton size="tiny" icon aria-label={`Dismiss: ${problem.title}`} onClick={() => props.onDismiss(problem.key)}>
                                close
                            </PaperButton>
                        </PaperFlex>
                    )}
                </For>
            </PaperPopover>
        </Show>
    );
};

export default PanelProblems;
