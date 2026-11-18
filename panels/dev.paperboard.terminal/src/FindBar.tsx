// Find in the shell in front: a bar over the screens that highlights the
// matches and moves between them. A find belongs to the screen it was made in.
import { createEffect, createSignal, on, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperIcon, PaperInput, PaperText } from "@mileniumhq/paperui";
import { activeTerminals } from "./Terminal";

export function createFind(session: () => string) {
    const [isOpen, setOpen] = createSignal(false);
    const [query, setQuery] = createSignal("");
    const [missed, setMissed] = createSignal(false);
    const screen = () => activeTerminals.get(session());
    let input: HTMLInputElement | undefined;

    const open = () => {
        setOpen(true);
        queueMicrotask(() => {
            input?.focus();
            input?.select();
        });
    };
    const find = (direction: -1 | 1) => {
        const handle = screen();
        if (!handle || !query()) {
            setMissed(false);
            return;
        }
        setMissed(!handle.find(query(), direction));
    };
    const close = () => {
        screen()?.clearFind();
        setOpen(false);
        setMissed(false);
        screen()?.focus();
    };
    createEffect(on(session, (_now, before) => before && activeTerminals.get(before)?.clearFind(), { defer: true }));

    const bar = (
        <Show when={isOpen()}>
            <PaperFlex direction="row" align="center" gap="half" padding="half" fullWidth>
                <PaperInput
                    size="small"
                    fullWidth
                    icon="search"
                    placeholder="Find"
                    aria-label="Find in this terminal"
                    invalid={missed()}
                    ref={(el: HTMLInputElement) => (input = el)}
                    value={query()}
                    onInput={(e) => {
                        setQuery(e.currentTarget.value);
                        find(1);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") find(e.shiftKey ? -1 : 1);
                        else if (e.key === "Escape") close();
                    }}
                />
                <Show when={missed()}>
                    <PaperText size={1} color="text-subtle" truncate>No matches</PaperText>
                </Show>
                <PaperButton size="tiny" icon onClick={() => find(-1)} title="Previous match" aria-label="Previous match">
                    <PaperIcon>keyboard_arrow_up</PaperIcon>
                </PaperButton>
                <PaperButton size="tiny" icon onClick={() => find(1)} title="Next match" aria-label="Next match">
                    <PaperIcon>keyboard_arrow_down</PaperIcon>
                </PaperButton>
                <PaperButton size="tiny" icon onClick={close} title="Close find" aria-label="Close find">
                    <PaperIcon>close</PaperIcon>
                </PaperButton>
            </PaperFlex>
        </Show>
    );
    return { open, bar };
}
