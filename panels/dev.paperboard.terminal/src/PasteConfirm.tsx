// A paste that would run commands as it lands is asked about first: how many
// lines, and the first of them.
import { createSignal } from "solid-js";
import { PaperButton, PaperCode, PaperFlex, PaperModal, PaperText } from "@mileniumhq/paperui";
import { pasteLines } from "./lib/screen";

// the lines of a paste shown when it is asked about
const PASTE_PREVIEW_LINES = 12;

function pastePreview(text: string): string {
    const lines = text.replace(/(\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/);
    const shown = lines.slice(0, PASTE_PREVIEW_LINES).join("\n");
    return lines.length > PASTE_PREVIEW_LINES ? `${shown}\n…` : shown;
}

export function createPasteConfirm() {
    const [ask, setAsk] = createSignal<{ text: string; answer: (go: boolean) => void } | null>(null);
    const count = () => pasteLines(ask()?.text ?? "");

    /** resolves true to paste; a newer paste answers the one before it with no */
    const confirm = (text: string) =>
        new Promise<boolean>((resolve) => {
            ask()?.answer(false);
            setAsk({
                text,
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
            title={count() === 1 ? "Paste 1 line?" : `Paste ${count()} lines?`}
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={() => ask()?.answer(false)}>Cancel</PaperButton>
                    <PaperButton variant="primary" onClick={() => ask()?.answer(true)} autofocus>Paste</PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="body">{count() === 1 ? "It runs as a command as soon as it lands." : "Each line runs as a command as soon as it lands."}</PaperText>
                <PaperCode block>{pastePreview(ask()?.text ?? "")}</PaperCode>
            </PaperFlex>
        </PaperModal>
    );
    return { confirm, modal };
}
