import { type Component, createEffect, createSignal, on, Show } from "solid-js";
import { PaperFlex, PaperText, PaperButton, PaperIcon, PaperModal } from "@mileniumhq/paperui";
import type { ComputerItem } from "../../App";
import { computersApi } from "../../lib/shell";

export interface OfflineComputerModalProps {
    computer?: ComputerItem;
    open: boolean;
    onClose: () => void;
    /** User chose to forget the unreachable computer. */
    onForget: () => void;
    /** Probe succeeded — caller should select the computer normally. */
    onReconnectSuccess: () => void;
}

// Explicit choice when a paired computer can't be reached; stays mounted so
// PaperModal animations play normally.
export const OfflineComputerModal: Component<OfflineComputerModalProps> = (
    props,
) => {
    const [isProbing, setIsProbing] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);

    // a newer probe, or the dialog closing, makes an older probe's answer moot
    let probeRequest = 0;
    const attemptReconnect = async () => {
        const target = props.computer;
        if (!target) return;
        const request = ++probeRequest;
        setIsProbing(true);
        setError(null);
        try {
            const probe = await computersApi.probe(target.host, target.port);
            if (request !== probeRequest) return;
            if (probe?.reachable) {
                props.onReconnectSuccess();
                return;
            }
            setError(probe?.error || "Unreachable");
        } catch (err: any) {
            if (request !== probeRequest) return;
            setError(err?.message || "Unreachable");
        } finally {
            // only the current probe may clear the busy flag: a stale one
            // would re-enable "Try Again" while a newer probe is in flight
            if (request === probeRequest) setIsProbing(false);
        }
    };

    // Probe once each time the modal opens, and again if it is opened for
    // another computer (it stays mounted, so onMount won't refire). Only the
    // opening and the computer's id are followed: the probe's own busy flag
    // and status must not start it again, or a failed probe would retry
    // without end while the dialog is open.
    createEffect(
        on(
            () => (props.open ? props.computer?.id : undefined),
            (id) => {
                if (id) {
                    void attemptReconnect();
                    return;
                }
                probeRequest++;
                setIsProbing(false);
            },
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
                    <PaperButton disabled={isProbing()} onClick={attemptReconnect}>
                        <PaperIcon>restart_alt</PaperIcon>
                        {isProbing() ? "Checking…" : "Try Again"}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                <Show when={props.computer}>
                    {(comp) => (
                        <PaperText preset="text">
                            Nothing responded at {comp().host}:
                            {comp().port}. Make sure the Paperboard Server
                            daemon is running on that computer and its
                            port is reachable from this device.
                        </PaperText>
                    )}
                </Show>

                <Show when={error()}>
                    <PaperText preset="error">
                        Last error: {error()}
                    </PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
};

export default OfflineComputerModal;
