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
    /** Try Again reached it: the caller selects the computer normally. */
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

    // The dialog opens on the answer of the probe that found the computer
    // unreachable, so it shows that answer instead of asking again; Try
    // Again probes. Opened for another computer (it stays mounted), it shows
    // that computer's answer; closed, a probe still out is moot.
    createEffect(
        on(
            () => (props.open ? props.computer?.id : undefined),
            (id) => {
                probeRequest++;
                setIsProbing(false);
                setError(id ? (props.computer?.status?.error ?? null) : null);
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
