import { type Component, createSignal, Show } from "solid-js";
import { createReducedMotion } from "../../utils/reducedMotion";
import { PaperFlex, PaperText, PaperButton, PaperIcon, getVarCss } from "@mileniumhq/paperui";
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
    const reducedMotion = createReducedMotion();

    // PaperProvider publishes theme on <body>; fall back to OS preference
    const isDark = () => {
        const forced = document.body?.getAttribute("data-paperui-theme");
        if (forced === "dark" || forced === "light") return forced === "dark";
        return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
    };

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
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                // Reduced motion removes blur; fall back opaque to stay legible
                "background-color": reducedMotion()
                    ? isDark()
                        ? getVarCss("surface-inset")
                        : getVarCss("surface-raised")
                    : isDark()
                      ? getVarCss("scrim")
                      : getVarCss("scrim-light"),
                "backdrop-filter": reducedMotion()
                    ? "none"
                    : getVarCss("blur-medium"),
                "-webkit-backdrop-filter": reducedMotion()
                    ? "none"
                    : getVarCss("blur-medium"),
                "z-index": 100,
                padding: "2rem",
            }}
        >
            <PaperFlex center direction="column" gap="half">
                <PaperIcon
                    style={{
                        "font-size": "3rem",
                        color: getVarCss("danger"),
                        opacity: 0.9,
                    }}
                >
                    cloud_off
                </PaperIcon>
                <PaperText size={6} weight={700}>
                    Connection Lost
                </PaperText>
                <PaperText
                    size={3}
                    color="text-subtle"
                    style={{
                        "text-align": "center",
                        "max-width": "24rem",
                    }}
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
                        style={{ "text-align": "center", "max-width": "24rem" }}
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
