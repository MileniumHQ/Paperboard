// A page open beside the chat: a bar of icons over the page itself. The
// address never shows; the page is the agent's, served on this computer. A
// document's bar also prints it and saves it as a PDF.

import { Show, createSignal } from "solid-js";
import { fileApi, grantedComputerId } from "@mileniumhq/paperapi";
import { PaperButton, PaperEmptyState, PaperFlex, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { PANEL_ID } from "../contract";
import { failure, type Failure } from "../lib/failure";
import type { Launcher, OpenPage } from "./launcher";
import styles from "./PageView.module.css";

const PDF_FILTERS = [{ name: "PDF", extensions: ["pdf"] }];

export default function PageView(props: { page: OpenPage; pages: Launcher; extended: boolean; phone: boolean; onExtend: () => void; onClose: () => void }) {
    let frame: HTMLIFrameElement | undefined;
    // the page is served on the agent's computer's loopback, which a screen elsewhere can't reach
    const here = grantedComputerId() === "local";
    const isDocument = () => props.page.kind === "document";
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal<Failure | null>(null);

    // a frame from another origin can't be printed from here: the page's own script prints it when asked
    const print = () => {
        frame?.contentWindow?.postMessage({ type: "paperboard:print" }, new URL(props.page.url).origin);
    };

    const savePdf = async () => {
        setSaving(true);
        setError(null);
        let file: string | null = null;
        try {
            const pdf = await props.pages.savePdf(props.page.name);
            file = pdf.file;
            await fileApi.exportFile(pdf.file, PANEL_ID, { suggestedName: pdf.name, filters: PDF_FILTERS });
        } catch (e) {
            setError(failure("PDF not saved", e));
        } finally {
            if (file) await props.pages.discardPdf(file).catch((e) => setError(failure("PDF saved, but its copy wasn't removed", e)));
            setSaving(false);
        }
    };

    return (
        <div class={styles.view}>
            <PaperFlex direction="row" align="center" gap="half" padding="half">
                <Show when={!props.phone}>
                    <PaperButton
                        icon
                        variant="text"
                        aria-label={props.extended ? "Show the chat" : "Hide the chat"}
                        title={props.extended ? "Show the chat" : "Hide the chat"}
                        onClick={() => props.onExtend()}
                    >
                        {props.extended ? "close_fullscreen" : "open_in_full"}
                    </PaperButton>
                </Show>
                <PaperButton icon variant="text" aria-label="Reload" title="Reload" disabled={!here} onClick={() => frame && (frame.src = props.page.url)}>
                    refresh
                </PaperButton>
                <PaperFlex flex minWidth={0} align="center">
                    <PaperText preset="label" truncate>
                        {props.page.title}
                    </PaperText>
                </PaperFlex>
                <Show when={isDocument()}>
                    <PaperButton icon variant="text" aria-label="Print" title="Print" disabled={!here} onClick={print}>
                        print
                    </PaperButton>
                    <PaperButton icon variant="text" aria-label="Save as PDF" title={saving() ? "Saving as PDF..." : "Save as PDF"} disabled={!here || saving()} onClick={() => void savePdf()}>
                        picture_as_pdf
                    </PaperButton>
                </Show>
                <PaperButton icon variant="text" aria-label="Close" title="Close" onClick={() => props.onClose()}>
                    close
                </PaperButton>
            </PaperFlex>
            <Show when={error()}>
                {(shown) => (
                    <PaperFlex padding="half">
                        <PaperQuote variant="danger" icon="error" title={shown().title} role="alert" onDismiss={() => setError(null)}>
                            {shown().message}
                        </PaperQuote>
                    </PaperFlex>
                )}
            </Show>
            <Show
                when={here}
                fallback={
                    <PaperFlex flex center>
                        <PaperEmptyState
                            icon="desktop_access_disabled"
                            title="Open it on the computer it's on"
                            description="Pages are served on the agent's computer, and only a screen on that computer can reach them."
                        />
                    </PaperFlex>
                }
            >
                {/* its own origin: the page can't reach into the panel, nor the panel into it. A document may open
                    the print dialog (allow-modals); an app has no need to */}
                <iframe
                    ref={frame}
                    class={styles.frame}
                    src={props.page.url}
                    title={props.page.title}
                    sandbox={isDocument() ? "allow-scripts allow-forms allow-same-origin allow-modals" : "allow-scripts allow-forms allow-same-origin"}
                />
            </Show>
        </div>
    );
}
