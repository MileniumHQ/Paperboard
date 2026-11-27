import { createMemo, Show } from "solid-js";
import { createRead, PaperAvatar, PaperError, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { useServer } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { factorio } from "./index";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";

export default function FactorioOverview() {
    const { calls, gameSettings, serverStatus } = useServer();
    // the world and its mods change as the server starts and stops; evolution only while it runs
    const status = createRead(() => calls.factorioStatus(), { source: serverStatus, message: errorMessage });
    const metrics = createMetrics(() => calls.factorioStatus());
    const uptime = createUptime();
    const name = () => String(gameSettings().name ?? "");
    const world = () => metrics.value()?.world ?? status.value()?.world ?? null;
    const evolution = createMemo(() => {
        const value = metrics.value()?.evolution;
        return value === null || value === undefined ? "…" : `${(value * 100).toFixed(1)}%`;
    });
    const failure = () => metrics.error() || (status.error() ?? "");

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
                        action={{ label: "Try again", disabled: metrics.loading() || status.loading(), onClick: () => void Promise.all([metrics.reload(), status.reload()]) }}
                    />
                )}
            </Show>
        </ServerOverview>
    );
}
