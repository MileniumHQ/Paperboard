import { createEffect, createSignal, For, on, Show, type Component } from "solid-js";
import { PaperBadge, PaperButton, PaperList, PaperListItem, PaperPopover } from "@mileniumhq/paperui";
import type { PanelProblem } from "@mileniumhq/paperapi";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * A panel's problems, on its row in the sidebar: what failed with no button
 * waiting to say it. The button counts them and opens the list, where each
 * one can be dismissed; the panel clears one itself once it is fixed.
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
                <PaperBadge variant="danger" icon="error">{count()}</PaperBadge>
            </PaperButton>
            <PaperPopover open={open()} anchor={button} onClose={() => setOpen(false)} title={props.panelName} flush>
                <PaperList selectable={false} borderless fullWidth scrollable={false}>
                    <For each={props.problems}>
                        {(problem) => (
                            <PaperListItem
                                value={problem.key}
                                description={`${time(problem.at)} · ${problem.message}`}
                                onClose={() => props.onDismiss(problem.key)}
                            >
                                {problem.title}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </PaperPopover>
        </Show>
    );
};

export default PanelProblems;
