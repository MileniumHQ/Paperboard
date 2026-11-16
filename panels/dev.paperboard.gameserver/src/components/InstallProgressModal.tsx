import { Show } from "solid-js";
import { PaperButton, PaperError, PaperFlex, PaperModal } from "@mileniumhq/paperui";
import InstallLoaders, { type InstallLoaderItem } from "./InstallLoaders";
import type { Outcome } from "../lib/failure";

/**
 * What an install in the Versions tab shows: its rows, which nothing closes
 * while it runs, and once it fails why, with what the tool printed under
 * its Details, until Dismiss.
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
                <PaperFlex direction="column" gap="half" fullWidth maxWidth="panel-small">
                    <InstallLoaders items={props.rows} />
                    <Show when={props.failure}>
                        {(failure) => <PaperError alert title={failure().title} error={failure().message} />}
                    </Show>
                </PaperFlex>
            </PaperFlex>
        </PaperModal>
    );
}
