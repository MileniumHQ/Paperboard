// Blockly's own questions (a new variable's name, renaming one, deleting one
// still in use) as PaperUI modals. Blockly asks with the browser's prompt,
// alert and confirm, which a panel's frame isn't allowed to open: without
// this, "Create variable..." would do nothing.
import { createSignal } from "solid-js";
import * as Blockly from "blockly";
import { PaperButton, PaperFlex, PaperInput, PaperModal, PaperText } from "@mileniumhq/paperui";

type Ask =
    | { kind: "prompt"; message: string; value: string; answer(value: string | null): void }
    | { kind: "confirm"; message: string; answer(ok: boolean): void }
    | { kind: "alert"; message: string; answer(): void };

export function BlocklyDialogs() {
    const [ask, setAsk] = createSignal<Ask | null>(null);
    // what the modal shows while it closes, after the question is answered
    const [shown, setShown] = createSignal<Ask | null>(null);
    const [value, setValue] = createSignal("");

    const open = (next: Ask) => {
        setShown(next);
        setValue(next.kind === "prompt" ? next.value : "");
        setAsk(next);
    };

    Blockly.dialog.setPrompt((message, value, answer) => open({ kind: "prompt", message, value, answer }));
    Blockly.dialog.setConfirm((message, answer) => open({ kind: "confirm", message, answer }));
    Blockly.dialog.setAlert((message, answer) => open({ kind: "alert", message, answer: () => answer?.() }));

    /** Answers the open question: OK, or cancelled. */
    const close = (ok: boolean) => {
        const current = ask();
        if (!current) return;
        setAsk(null);
        if (current.kind === "prompt") current.answer(ok ? value() : null);
        else if (current.kind === "confirm") current.answer(ok);
        else current.answer();
    };

    return (
        <PaperModal
            open={ask() !== null}
            onClose={() => close(false)}
            title={shown()?.kind === "prompt" ? shown()!.message.replace(/:\s*$/, "") : "Blocks"}
            footer={
                <>
                    {shown()?.kind === "alert" ? null : (
                        <PaperButton variant="text" onClick={() => close(false)}>
                            Cancel
                        </PaperButton>
                    )}
                    <PaperButton variant="primary" disabled={shown()?.kind === "prompt" && !value().trim()} onClick={() => close(true)}>
                        OK
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                {shown()?.kind === "prompt" ? (
                    <PaperInput
                        fullWidth
                        placeholder="Name"
                        value={value()}
                        onInput={(e) => setValue(e.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && value().trim()) close(true);
                        }}
                    />
                ) : (
                    <PaperText preset="body">{shown()?.message}</PaperText>
                )}
            </PaperFlex>
        </PaperModal>
    );
}
