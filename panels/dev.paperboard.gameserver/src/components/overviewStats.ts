import { createEffect, createSignal, on, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { createPolling, createRead, type PaperRole } from "@mileniumhq/paperui";
import { useServer } from "../lib/server";
import { errorMessage } from "../lib/failure";
import { durationLabel } from "../core/format";

/** One readout of a running server on its Overview. */
export interface OverviewStat {
    icon: string;
    label: string;
    value: JSX.Element | string;
    tone?: PaperRole;
}

/**
 * A running server's readouts: always four, so every game's Overview has the
 * same row. Players comes first and Uptime last; the two between are the
 * game's own.
 */
export type OverviewStats = readonly [OverviewStat, OverviewStat, OverviewStat, OverviewStat];

/** How many are on, of how many the server takes once it has said; read where the Overview draws it. */
export function playersStat(): OverviewStat {
    const { maxPlayers, onlinePlayerNames } = useServer();
    const cap = maxPlayers();
    return { icon: "group", label: "Players", value: cap === null ? String(onlinePlayerNames().size) : `${onlinePlayerNames().size} / ${cap}` };
}

/** How long the server has been online. Call `createUptime` once in the component and hand its value here. */
export const uptimeStat = (seconds: number): OverviewStat => ({ icon: "schedule", label: "Uptime", value: durationLabel(seconds) });

/** Seconds the server has been online, counted on while the component is shown. */
export function createUptime(): () => number {
    const { onlineSince } = useServer();
    const [now, setNow] = createSignal(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    onCleanup(() => clearInterval(timer));
    return () => {
        const since = onlineSince();
        return since === null ? 0 : Math.max(0, (now() - since) / 1000);
    };
}

const METRICS_MS = 5_000;

/**
 * A running server's own figures, asked of the game's call every few seconds
 * while it is online; they are gone when it stops. `error` says why the last
 * ask failed, for the Overview to show. An answer that lands after the
 * server stopped, or after the Overview closed, is dropped.
 */
export function createMetrics<T>(read: () => Promise<T>): { value: () => T | undefined; error: () => string; loading: () => boolean; reload: () => Promise<void> } {
    const { serverStatus } = useServer();
    const online = () => serverStatus() === "online";
    const metrics = createRead(read, { source: online, message: errorMessage });
    createEffect(on(online, (now) => now || metrics.set(undefined), { defer: true }));
    createPolling(() => (online() ? metrics.reload() : undefined), METRICS_MS);
    return { value: metrics.value, error: () => metrics.error() ?? "", loading: metrics.loading, reload: metrics.reload };
}

/** The game's own stats between Players and Uptime. */
export const overviewStats = (uptime: number, second: OverviewStat, third: OverviewStat): OverviewStats => [playersStat(), second, third, uptimeStat(uptime)];
