// What the canvas needs to tell you: a save another window beat, a save or
// apply that failed, and how a file import or restore went.
import { Show } from "solid-js";
import { PaperButton, PaperText } from "@mileniumhq/paperui";
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
                    <div role="status" class="canvas-sync-status">
                        <PaperText size={1}>{notice()}</PaperText>
                        <PaperButton size="tiny" onClick={() => props.doc.dismissConflict()}>Dismiss</PaperButton>
                    </div>
                )}
            </Show>
            <Show when={props.doc.syncState().status === "error"}>
                <div role="status" class="canvas-sync-status">
                    <PaperText size={1}>{(props.doc.syncState() as { message: string }).message}</PaperText>
                    <PaperButton size="tiny" onClick={() => props.doc.retrySave()}>Retry saving</PaperButton>
                </div>
            </Show>
            <Show when={props.fileNotice}>
                {(notice) => (
                    <div role="status" class="canvas-sync-status">
                        <PaperText size={1} color={notice().kind === "failed" ? "danger" : undefined}>{notice().text}</PaperText>
                        <PaperButton size="tiny" onClick={() => props.onDismissFile()}>Dismiss</PaperButton>
                    </div>
                )}
            </Show>
        </>
    );
}
