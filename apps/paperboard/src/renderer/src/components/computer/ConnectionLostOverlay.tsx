import { type Component, Show } from "solid-js";
import { PaperFlex, PaperText, PaperButton, PaperIcon } from "@mileniumhq/paperui";
import styles from "./ConnectionLostOverlay.module.css";
import type { ComputerInfo } from "../../lib/shell";
import { createReachCheck } from "../../lib/reachCheck";

export interface ConnectionLostOverlayProps {
    computer: ComputerInfo;
    /** Attempt Reconnect reached it: the caller reconnects to it */
    onReconnectSuccess: () => void;
}

export const ConnectionLostOverlay: Component<ConnectionLostOverlayProps> = (
    props,
) => {
    const reach = createReachCheck();
    const handleReconnect = async () => {
        if (!reach.checking() && (await reach.check(props.computer))) props.onReconnectSuccess();
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
                <PaperText preset="title">
                    Connection Lost
                </PaperText>
                <PaperText preset="text" class={styles.message}>
                    Cannot communicate with{" "}
                    <strong>{props.computer.name}</strong> at{" "}
                    {props.computer.host}:{props.computer.port}. Make sure
                    the Paperboard server daemon is running. Paperboard
                    keeps retrying on its own.
                </PaperText>
                <Show when={props.computer.status?.error}>
                    <PaperText preset="error" class={styles.message}>
                        {props.computer.status?.error}
                    </PaperText>
                </Show>
            </PaperFlex>

            <PaperFlex center direction="column" gap="half">
                <PaperButton size="tiny"
                    disabled={reach.checking()}
                    onClick={handleReconnect}>
                    <PaperIcon>restart_alt</PaperIcon>
                    {reach.checking() ? "Reconnecting..." : "Attempt Reconnect"}
                </PaperButton>
                <Show when={reach.error()}>
                    <PaperText preset="error">
                        Last error: {reach.error()}
                    </PaperText>
                </Show>
            </PaperFlex>
        </PaperFlex>
    );
};

export default ConnectionLostOverlay;
