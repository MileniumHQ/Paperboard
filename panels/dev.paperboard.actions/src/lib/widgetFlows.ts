// What Home's Actions widgets see of the flows: which flows a Run button may
// start, what each is called, and the recent runs. Pure, so the service and
// its tests share one implementation.
import type { CanvasBlock } from "./tree";

/** The trigger a person starts by hand; only these flows get a Run button. */
export const MANUAL_TRIGGER_ID = "on-play";

/** What Home's gallery accepts for one option (paperapi MAX_WIDGET_CHOICES). */
export const MAX_FLOW_CHOICES = 64;
const MAX_LABEL = 64;

/** Runs kept for the Recent runs widget; older ones fall off. */
export const RUN_HISTORY_LIMIT = 12;

export interface FlowRun {
    /** unique per run */
    id: string;
    /** the flow's trigger block id */
    flowId: string;
    /** what the flow was called when it ran */
    label: string;
    status: "passed" | "failed";
    /** the failure, or the flow's last message */
    message: string;
    /** epoch ms, on the computer that ran it */
    finishedAt: number;
}

export interface FlowChoice {
    value: string;
    label: string;
}

export function isManualFlow(block: CanvasBlock): boolean {
    return block.isTrigger === true && block.action?.id === MANUAL_TRIGGER_ID;
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// Flows have no names of their own: a flow is called by what it does.
function baseLabel(flow: CanvasBlock): string {
    const steps = (flow.children ?? []).map((c) => c.action?.name).filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    const summary = steps.length === 0 ? "No steps" : steps.length <= 2 ? steps.join(", ") : `${steps[0]}, ${steps[1]} +${steps.length - 2}`;
    if (isManualFlow(flow)) return summary;
    return `${flow.action?.name || "Flow"}: ${summary}`;
}

/**
 * A label for every top-level flow, by trigger id. Flows that read the same
 * are numbered in canvas order, so two "Log to Console" flows stay apart.
 */
export function flowLabels(flows: CanvasBlock[]): Map<string, string> {
    const labels = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const flow of flows) {
        if (!flow.isTrigger) continue;
        const base = baseLabel(flow);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const suffix = n > 1 ? ` (${n})` : "";
        labels.set(flow.id, truncate(base, MAX_LABEL - suffix.length) + suffix);
    }
    return labels;
}

/** The flows a Run button can start, as Home's gallery lists them. */
export function manualFlowChoices(flows: CanvasBlock[]): FlowChoice[] {
    const labels = flowLabels(flows);
    return flows
        .filter(isManualFlow)
        .slice(0, MAX_FLOW_CHOICES)
        .map((flow) => ({ value: flow.id, label: labels.get(flow.id)! }));
}

/**
 * The manual flow a Run button names, or null when it no longer exists.
 * Malformed ids are refused, not looked up.
 */
export function findManualFlow(flows: CanvasBlock[], flowId: unknown): CanvasBlock | null {
    if (typeof flowId !== "string" || flowId.length === 0 || flowId.length > 128) {
        throw new Error("A workflow id is required");
    }
    return flows.find((flow) => flow.id === flowId && isManualFlow(flow)) ?? null;
}

/** Newest first, at most RUN_HISTORY_LIMIT. */
export function recordRun(history: FlowRun[], run: FlowRun): FlowRun[] {
    return [run, ...history].slice(0, RUN_HISTORY_LIMIT);
}
