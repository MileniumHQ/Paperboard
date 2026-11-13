import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { PaperAvatar, PaperGrid, PaperQuote, PaperStatTile, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { gameSettings, serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { uptimeLabel } from "../palworld/health";
import { rust } from "./index";
import { fpsTone } from "./health";
import type { RustInfo } from "./webrcon";

const METRICS_MS = 5_000;

export default function RustOverview() {
    const description = () => String(gameSettings().description ?? "");
    const [metrics, setMetrics] = createSignal<RustInfo>();
    const [metricsError, setMetricsError] = createSignal("");
    // the server is asked for its health while it runs; the numbers are gone when it stops
    createEffect(on(serverStatus, (status) => {
        setMetrics(undefined);
        setMetricsError("");
        if (status !== "online") return;
        const load = () => serverBridge.call<RustInfo>("rust-metrics").then(
            (answer) => { setMetrics(answer); setMetricsError(""); },
            (err) => setMetricsError(errorMessage(err)),
        );
        void load();
        const timer = setInterval(() => void load(), METRICS_MS);
        onCleanup(() => clearInterval(timer));
    }));

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={rust.art.icon} alt="Rust" fallbackIcon="forest" />}
            detail={
                <Show when={description()} fallback={<PaperText color="text-subtle">No description</PaperText>}>
                    <PaperText color="text-subtle">{description()}</PaperText>
                </Show>
            }
            software="Steam"
            control={rust.describe({ software: "", version: "" }).control}
        >
            <Show when={metrics()}>
                {(health) => (
                    <PaperGrid min="field">
                        <PaperStatTile icon="speed" label="Server FPS" value={Math.round(health().Framerate)} tone={fpsTone(health().Framerate)} />
                        <PaperStatTile icon="group" label="Players" value={`${health().Players} / ${health().MaxPlayers}`} />
                        <PaperStatTile icon="deployed_code" label="Entities" value={health().EntityCount.toLocaleString()} />
                        <PaperStatTile icon="schedule" label="Uptime" value={uptimeLabel(health().Uptime)} />
                    </PaperGrid>
                )}
            </Show>
            <Show when={metricsError()}>
                <PaperQuote variant="danger" icon="warning" title="Server health unavailable">{metricsError()}</PaperQuote>
            </Show>
        </ServerOverview>
    );
}
