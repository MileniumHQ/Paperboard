import { createMemo, Show } from "solid-js";
import { createPolling, createRead, PaperAvatar, PaperError, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { useServer } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { factorio } from "./index";
import { createUptime, METRICS_MS, overviewStats } from "../../components/overviewStats";

export default function FactorioOverview() {
    const { calls, gameSettings, serverStatus } = useServer();
    // one reader: the world and its mods change as the server starts and stops, and evolution is asked again while it runs
    const status = createRead(() => calls.factorioStatus(), { source: serverStatus, message: errorMessage });
    createPolling(() => (serverStatus() === "online" ? status.reload() : undefined), METRICS_MS);
    const uptime = createUptime();
    const name = () => String(gameSettings().name ?? "");
    const world = () => status.value()?.world ?? null;
    const evolution = createMemo(() => {
        const value = status.value()?.evolution;
        return value === null || value === undefined ? "…" : `${(value * 100).toFixed(1)}%`;
    });
    const failure = () => status.error() ?? "";

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={factorio.art.icon} alt="Factorio" fallbackIcon="factory" />}
            detail={<PaperText color="text-subtle">{name()}</PaperText>}
            // which game the world is played as: the expansion, or the base game alone
            software={status.value() ? (status.value()!.spaceAge ? "Space Age" : "Base game") : "Factorio"}
            control={factorio.describe({ software: "", version: "" }).control}
            stats={overviewStats(
                uptime(),
                { icon: "public", label: "World", value: world() ?? "…" },
                { icon: "bug_report", label: "Evolution", value: evolution() },
            )}
        >
            <Show when={failure()}>
                {(err) => (
                    <PaperError
                        title="Couldn't read the server's status"
                        error={err()}
                        action={{ label: "Try again", disabled: status.loading(), onClick: () => void status.reload() }}
                    />
                )}
            </Show>
        </ServerOverview>
    );
}
