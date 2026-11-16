import { createEffect, on } from "solid-js";
import { PaperButton, PaperFlex, PaperModal, showError } from "@mileniumhq/paperui";
import InstallLoaders, { type InstallLoaderItem } from "./InstallLoaders";
import { splitFailure, type Outcome } from "../lib/failure";
import FailureOutput from "./FailureOutput";

/**
 * What an install in the Versions tab shows: its rows, which nothing closes
 * while it runs, and once it fails a Dismiss. The failure's first line is a
 * toast; what the tool printed after it stays here.
 */
export default function InstallProgressModal(props: {
    open: boolean;
    rows: InstallLoaderItem[];
    failure?: Outcome;
    onDismiss(): void;
}) {
    createEffect(
        on(
            () => props.failure,
            (failure) => {
                if (failure) showError(failure.title, splitFailure(failure.message).summary);
            },
        ),
    );
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
                    <FailureOutput message={props.failure?.message ?? ""} />
                </PaperFlex>
            </PaperFlex>
        </PaperModal>
    );
}
