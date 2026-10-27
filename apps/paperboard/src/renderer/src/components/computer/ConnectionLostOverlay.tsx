import { type Component, createSignal, Show } from "solid-js";
import { PaperFlex, PaperText, PaperButton, PaperIcon } from "@mileniumhq/paperui";
import styles from "./ConnectionLostOverlay.module.css";
import type { ComputerItem } from "../../App";
import { computersApi, logToMain } from "../../lib/shell";

export interface ConnectionLostOverlayProps {
    computer: ComputerItem;
    onReconnectSuccess?: () => void;
}

export const ConnectionLostOverlay: Component<ConnectionLostOverlayProps> = (
    props,
) => {
    const [isReconnecting, setIsReconnecting] = createSignal(false);
    const [lastError, setLastError] = createSignal<string | null>(null);

    const handleReconnect = async () => {
        if (isReconnecting()) return;
        setIsReconnecting(true);
        setLastError(null);
        try {
            const probe = await computersApi.probe(
                props.computer.host,
                props.computer.port,
            );
            if (probe && probe.reachable) {
                await computersApi.switch(props.computer.id);
                props.onReconnectSuccess?.();
            } else {
                setLastError(probe?.error || "Unreachable");
            }
        } catch (err: any) {
            logToMain("error", "Reconnect attempt failed:", err);
            setLastError(err?.message || "Unreachable");
        } finally {
            setIsReconnecting(false);
        }
    };

    return (
        <PaperFlex
            center
            direction="column"
            gap="full"
            class={styles.overlay}
        >
            <PaperFlex center direction="column" gap="half">
                <PaperIcon class={styles.icon}>
                    cloud_off
                </PaperIcon>
                <PaperText size={6} weight={700}>
                    Connection Lost
                </PaperText>
                <PaperText
                    size={3}
                    color="text-subtle"
                    class={styles.message}
                >
                    Cannot communicate with{" "}
                    <strong>{props.computer.name}</strong> at{" "}
                    {props.computer.host}:{props.computer.port}. Make sure
                    the Paperboard server daemon is running. Paperboard
                    keeps retrying on its own.
                </PaperText>
                <Show when={props.computer.status?.error}>
                    <PaperText
                        size={2}
                        color="text-subtle"
                        class={styles.message}
                    >
                        {props.computer.status?.error}
                    </PaperText>
                </Show>
            </PaperFlex>

            <PaperFlex center direction="column" gap="half">
                <PaperButton size="tiny"
                    disabled={isReconnecting()}
                    onClick={handleReconnect}>
                    <PaperIcon>restart_alt</PaperIcon>
                    {isReconnecting() ? "Reconnecting..." : "Attempt Reconnect"}
                </PaperButton>
                <Show when={lastError()}>
                    <PaperText size={2} color="text-subtle">
                        Last error: {lastError()}
                    </PaperText>
                </Show>
            </PaperFlex>
        </PaperFlex>
    );
};

export default ConnectionLostOverlay;
