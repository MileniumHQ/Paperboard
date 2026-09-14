import { type Component, createEffect, createSignal, Show } from "solid-js";
import { PaperFlex, PaperText, PaperButton, PaperIcon, PaperModal } from "@paperboard-dev/paperui";
import type { ComputerItem } from "../../App";
import { computersApi } from "../../lib/shell";

export interface OfflineComputerModalProps {
    computer?: ComputerItem;
    open: boolean;
    onClose: () => void;
    /** User chose to proceed onto this computer despite it being offline. */
    onWorkOffline: () => void;
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

    const attemptReconnect = async () => {
        const target = props.computer;
        if (!target || isProbing()) return;
        setIsProbing(true);
        setError(null);
        try {
            const probe = await computersApi.probe(target.host, target.port);
            if (target !== props.computer) return;
            if (probe?.reachable) {
                props.onReconnectSuccess();
                return;
            }
            setError(probe?.error || "Unreachable");
        } catch (err: any) {
            if (target !== props.computer) return;
            setError(err?.message || "Unreachable");
        } finally {
            // R13: only the probe that owns the CURRENT target may clear
            // the busy flag — a stale probe's finally used to re-enable
            // "Try Again" while a newer probe for a new target was in
            // flight, briefly allowing a double-probe.
            if (target === props.computer) {
                setIsProbing(false);
            }
        }
    };

    // Probe each time the modal opens (it stays mounted, so onMount won't refire)
    createEffect(() => {
        if (props.open && props.computer) void attemptReconnect();
    });

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title={`Can't reach ${props.computer?.name ?? "computer"}`}
            size="small"
            footer={
                <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                    <PaperButton
                        compact
                        variant="text"
                        disabled={isProbing()}
                        onClick={props.onWorkOffline}
                    >
                        Work Offline
                    </PaperButton>
                    <PaperButton compact disabled={isProbing()} onClick={attemptReconnect}>
                        <PaperIcon>restart_alt</PaperIcon>
                        {isProbing() ? "Checking…" : "Try Again"}
                    </PaperButton>
                </PaperFlex>
            }
        >
            <PaperFlex direction="column" gap="half">
                <Show when={props.computer}>
                    {(comp) => (
                        <PaperText preset="body">
                            Nothing responded at {comp().host}:
                            {comp().port}. Make sure the Paperboard Server
                            daemon is running on that computer and both
                            devices are on the same trusted network.
                        </PaperText>
                    )}
                </Show>

                <Show when={error()}>
                    <PaperText size={2} color="light-text">
                        Last error: {error()}
                    </PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
};

export default OfflineComputerModal;
