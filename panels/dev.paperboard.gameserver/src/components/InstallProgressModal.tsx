import { Show } from "solid-js";
import { PaperButton, PaperFlex, PaperModal, PaperQuote } from "@mileniumhq/paperui";
import InstallLoaders, { type InstallLoaderItem } from "./InstallLoaders";
import type { Outcome } from "../lib/failure";

/**
 * What an install in the Versions tab shows: its rows, which nothing closes
 * while it runs, and the failure with a Dismiss once it stops.
 */
export default function InstallProgressModal(props: {
    open: boolean;
    rows: InstallLoaderItem[];
    failure?: Outcome;
    onDismiss(): void;
}) {
    return (
        <PaperModal
            open={props.open}
            size="medium"
            noHeader
            closeOnBackdropClick={false}
            closeOnEsc={false}
            footer={props.failure ? <PaperButton onClick={props.onDismiss}>Dismiss</PaperButton> : undefined}
        >
            <PaperFlex fullWidth center>
                <PaperFlex fullWidth maxWidth="panel-small">
                    <InstallLoaders items={props.rows} />
                    <Show when={props.failure}>
                        {(note) => <PaperQuote variant="danger" icon="warning" title={note().title}>{note().message}</PaperQuote>}
                    </Show>
                </PaperFlex>
            </PaperFlex>
        </PaperModal>
    );
}
