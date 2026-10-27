// What the canvas needs to tell you: a save another window beat, a save or
// apply that failed, and how a file import or restore went.
import { Show } from "solid-js";
import { PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";
import type { CanvasNotice } from "../components/CanvasFileMenu";
import type { CanvasDocumentState } from "./document";

export default function Notices(props: {
    doc: CanvasDocumentState;
    fileNotice: CanvasNotice | null;
    onDismissFile: () => void;
}) {
    return (
        <>
            <Show when={props.doc.conflictNotice()}>
                {(notice) => (
                    <PaperQuote
                        class="canvas-notice"
                        variant="warning"
                        icon="sync_problem"
                        title="Changed in another window"
                        role="status"
                        onDismiss={() => props.doc.dismissConflict()}
                    >
                        {notice()}
                    </PaperQuote>
                )}
            </Show>
            <Show when={props.doc.syncState().status === "error"}>
                <PaperQuote class="canvas-notice" variant="danger" icon="warning" title="Canvas out of sync" role="alert">
                    <PaperFlex direction="column" gap="half">
                        {(props.doc.syncState() as { message: string }).message}
                        <PaperButton size="tiny" onClick={() => props.doc.retrySave()}>Retry saving</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={props.fileNotice}>
                {(notice) => (
                    <PaperQuote
                        class="canvas-notice"
                        variant={notice().kind === "failed" ? "danger" : "success"}
                        icon={notice().kind === "failed" ? "warning" : "check_circle"}
                        title={notice().title}
                        role={notice().kind === "failed" ? "alert" : "status"}
                        onDismiss={() => props.onDismissFile()}
                    >
                        {notice().text}
                    </PaperQuote>
                )}
            </Show>
        </>
    );
}
