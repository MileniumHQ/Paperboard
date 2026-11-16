import { Show } from "solid-js";
import { createFailureToast, PaperAvatar, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { useServer } from "../../lib/server";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";
import { rust } from "./index";
import { fpsTone } from "./health";

export default function RustOverview() {
    const { calls, gameSettings } = useServer();
    const description = () => String(gameSettings().description ?? "");
    const metrics = createMetrics(calls.rustMetrics);
    createFailureToast(metrics.error, { title: "Couldn't read the server's health" });
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
        />
    );
}
