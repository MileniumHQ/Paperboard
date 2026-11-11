// What the Disk, Network and Uptime widgets show, from a usage report. Pure,
// so the rules are tested without a computer: a server too old to report a
// figure and a computer that can't measure it are different messages, and
// neither is ever drawn as zero.
import type { UsageReport } from "@mileniumhq/paperapi";
import { formatBytes } from "./usageSegments";
import type { UsageState } from "./usageStore";

export type Figure<T> =
    | { kind: "loading" }
    | { kind: "ready"; value: T }
    /** the reading failed, or this computer can't measure it */
    | { kind: "unavailable"; message: string; retry: boolean };

type Measured = "disk" | "network" | "uptimeSeconds";

const WHAT: Record<Measured, string> = { disk: "its disk space", network: "its network use", uptimeSeconds: "how long it has been running" };

export function figureOf<K extends Measured>(
    state: UsageState,
    key: K,
    computerName: string,
): Figure<NonNullable<UsageReport[K]>> {
    if (state.kind === "loading") return { kind: "loading" };
    if (state.kind === "unavailable") return { kind: "unavailable", message: state.message, retry: true };
    const value = state.report[key];
    if (value === undefined) {
        return { kind: "unavailable", message: `Update Paperboard Server on ${computerName} to see this.`, retry: false };
    }
    if (value === null) return { kind: "unavailable", message: `${computerName} couldn't report ${WHAT[key]}.`, retry: true };
    return { kind: "ready", value: value as NonNullable<UsageReport[K]> };
}

/** 1.2 MB/s; under a kilobyte a second is shown as such, not as 0 */
export function formatRate(bytesPerSecond: number): string {
    return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

/** The two largest units that matter: "3 d 4 h", "5 h 12 min", "8 min". */
export function formatUptime(seconds: number): string {
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return `${days} d ${hours} h`;
    if (hours > 0) return `${hours} h ${mins} min`;
    return `${mins} min`;
}

export type PanelRunState = "running" | "stopped" | "no-service" | "unknown";

/**
 * A panel is running when the daemon's ownership ledger has live processes
 * for it, stopped when it has a service and none, and has no state to show
 * when it runs no service. Without a usage report, it is unknown, not stopped.
 */
export function panelRunState(hasService: boolean, liveOwners: ReadonlySet<string> | null, panelId: string): PanelRunState {
    if (!hasService) return "no-service";
    if (!liveOwners) return "unknown";
    return liveOwners.has(panelId) ? "running" : "stopped";
}

/** A widget's title, naming its computer when more than one is paired. */
export function widgetTitle(name: string, props: { showComputer: boolean; computerName: string }): string {
    return props.showComputer ? `${name} · ${props.computerName}` : name;
}
