import { type Component, createEffect, on, Show } from "solid-js";
import { PaperError, PaperButton, PaperIcon, PaperModal } from "@mileniumhq/paperui";
import type { ComputerInfo } from "../../lib/shell";
import { createReachCheck } from "../../lib/reachCheck";

export interface OfflineComputerModalProps {
    computer?: ComputerInfo;
    open: boolean;
    onClose: () => void;
    /** User chose to forget the unreachable computer. */
    onForget: () => void;
    /** Try Again reached it: the caller reconnects to it */
    onReconnectSuccess: () => void;
}

// Explicit choice when a paired computer can't be reached; stays mounted so
// PaperModal animations play normally.
export const OfflineComputerModal: Component<OfflineComputerModalProps> = (
    props,
) => {
    const reach = createReachCheck();
    const attemptReconnect = async () => {
        const target = props.computer;
        if (target && (await reach.check(target))) props.onReconnectSuccess();
    };

    // The dialog opens on the answer of the probe that found the computer
    // unreachable, so it shows that answer instead of asking again; Try
    // Again probes. Opened for another computer (it stays mounted), it shows
    // that computer's answer; closed, a probe still out is moot.
    createEffect(
        on(
            () => (props.open ? props.computer?.id : undefined),
            (id) => reach.reset(id ? (props.computer?.status?.error ?? null) : null),
        ),
    );

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title={`Can't reach ${props.computer?.name ?? "computer"}`}
            size="small"
            footer={
                <>
                    <PaperButton
                        variant="danger"
                        onClick={props.onForget}>
                        Forget Computer
                    </PaperButton>
                    <PaperButton disabled={reach.checking()} onClick={attemptReconnect}>
                        <PaperIcon>restart_alt</PaperIcon>
                        {reach.checking() ? "Checking…" : "Try Again"}
                    </PaperButton>
                </>
            }
        >
            {/* why the last look found nothing, at the address it looked; Try Again looks again */}
            <Show when={reach.error()}>
                {(why) => <PaperError title={`Couldn't reach ${props.computer?.host}:${props.computer?.port}`} error={why()} />}
            </Show>
        </PaperModal>
    );
};

export default OfflineComputerModal;
