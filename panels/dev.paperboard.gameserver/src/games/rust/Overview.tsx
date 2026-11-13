import { Show } from "solid-js";
import { PaperAvatar, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { gameSettings } from "../../lib/server";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";
import { rust } from "./index";
import { fpsTone } from "./health";
import type { RustInfo } from "./webrcon";

export default function RustOverview() {
    const description = () => String(gameSettings().description ?? "");
    const metrics = createMetrics<RustInfo>("rust-metrics");
    const uptime = createUptime();

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
            stats={metrics.value() && overviewStats(
                uptime(),
                { icon: "speed", label: "Server FPS", value: String(Math.round(metrics.value()!.Framerate)), tone: fpsTone(metrics.value()!.Framerate) },
                { icon: "deployed_code", label: "Entities", value: metrics.value()!.EntityCount.toLocaleString() },
            )}
        >
            <Show when={metrics.error()}>
                <PaperQuote variant="danger" icon="warning" title="Server health unavailable">{metrics.error()}</PaperQuote>
            </Show>
        </ServerOverview>
    );
}
