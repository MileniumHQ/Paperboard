// Closing a tab, or a split's second shell, stops what its shells run: a
// command still running is asked about first, by name.
import { createSignal, For } from "solid-js";
import { PaperButton, PaperCode, PaperFlex, PaperModal, PaperText } from "@mileniumhq/paperui";
import { shortTitle } from "./lib/tabs";

interface CloseAsk {
    /** "tab" closes the tab and every shell in it; "split" closes its second shell */
    what: "tab" | "split";
    /** the commands running in the shells it closes, as typed */
    commands: string[];
    answer: (go: boolean) => void;
}

export function createCloseConfirm() {
    const [ask, setAsk] = createSignal<CloseAsk | null>(null);
    const commands = () => ask()?.commands ?? [];
    const closeLabel = () => (ask()?.what === "split" ? "Close Split" : "Close Tab");

    /** resolves true to close; a newer ask answers the one before it with no */
    const confirm = (what: CloseAsk["what"], running: string[]) =>
        new Promise<boolean>((resolve) => {
            ask()?.answer(false);
            setAsk({
                what,
                commands: running,
                answer: (go) => {
                    setAsk(null);
                    resolve(go);
                },
            });
        });

    const modal = (
        <PaperModal
            open={ask() !== null}
            onClose={() => ask()?.answer(false)}
            title={commands().length === 1 ? `Stop ${shortTitle(commands()[0])}?` : `Stop ${commands().length} commands?`}
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={() => ask()?.answer(false)}>Cancel</PaperButton>
                    <PaperButton variant="danger" onClick={() => ask()?.answer(true)} autofocus>{closeLabel()}</PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="body">
                    {commands().length === 1 ? "It's still running." : "They're still running."}{" "}
                    {ask()?.what === "split" ? "Closing the split stops its shell." : "Closing the tab stops every shell in it."}
                </PaperText>
                <For each={commands()}>{(command) => <PaperCode block>{command}</PaperCode>}</For>
            </PaperFlex>
        </PaperModal>
    );
    return { confirm, modal };
}
