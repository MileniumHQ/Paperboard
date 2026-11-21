// How much of a brain's subscription is used, as its harness reports it to
// its own usage screen. Asking reaches no model and costs nothing.
//
// Claude: the `get_usage` control request of its stream-json mode, what its
// /usage shows: the 5-hour session, the week, each model with a week of its
// own, and extra usage when it's on. Codex: `account/rateLimits/read` of its
// app-server, what its /status shows: a primary and a secondary window, each
// with its length (5 hours and a week on paid plans, a month on Free).
// OpenCode connects other providers' keys and has no limits of its own to read.

import type { BrainUsage, Harness, UsageWindow } from "../contract";
import type { TurnHost } from "./conversation";
import { askClaude, askCodex, type AskLaunch } from "./harnessAsk";

const HOUR_MINS = 60;
const WEEK_MINS = 7 * 24 * HOUR_MINS;
const MONTH_MINS = 28 * 24 * HOUR_MINS;

export async function readUsage(harness: Harness, host: TurnHost, launch: AskLaunch): Promise<BrainUsage> {
    const doing: [string, string] = ["say how much of its plan is used", "said how much of its plan is used"];
    if (harness === "claude-code") return claudeUsage(await askClaude(host, launch, { subtype: "get_usage", skip_behaviors: true }, doing, "usage"));
    if (harness === "codex") return codexUsage(await askCodex(host, launch, "account/rateLimits/read", null, doing, "usage"));
    throw new Error(`${harness} has no usage limits of its own to show`);
}

const percent = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null);

/** an ISO time from Claude's timestamps (microseconds and an offset) or Codex's epoch seconds */
function isoOf(v: unknown): string | null {
    const ms = typeof v === "number" ? v * 1000 : typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

const planName = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().charAt(0).toUpperCase() + v.trim().slice(1) : null);

/** Claude's answer to get_usage: utilization is 0–100 already. */
export function claudeUsage(answer: unknown): BrainUsage {
    const a = answer as { subscription_type?: unknown; rate_limits_available?: unknown; rate_limits?: Record<string, any> | null } | null;
    if (!a || typeof a !== "object") throw new Error("Claude's usage answer wasn't what was expected");
    const plan = planName(a.subscription_type);
    // signed in with an API key: billed by use, with no plan limits to show
    if (a.rate_limits_available !== true) return { plan, windows: [] };
    // a plan whose limits didn't come back: Claude couldn't reach them this time, which isn't "no limits"
    if (!a.rate_limits || typeof a.rate_limits !== "object") throw new Error("Claude couldn't get its plan's limits right now. Try again in a moment.");
    const r = a.rate_limits;
    const windows: UsageWindow[] = [];
    const add = (id: string, label: string, used: unknown, resetsAt: unknown) => {
        const p = percent(used);
        if (p !== null) windows.push({ id, label, used: p, resetsAt: isoOf(resetsAt) });
    };
    add("session", "Session", r.five_hour?.utilization, r.five_hour?.resets_at);
    add("weekly", "Weekly", r.seven_day?.utilization, r.seven_day?.resets_at);
    // a model with a week of its own ("Weekly · Fable")
    for (const l of Array.isArray(r.limits) ? r.limits : []) {
        const model = l?.scope?.model?.display_name;
        if (l?.kind !== "weekly_scoped" || typeof model !== "string" || !model.trim()) continue;
        add(`weekly-${model.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, `Weekly · ${model.trim()}`, l.percent, l.resets_at);
    }
    const extra = r.extra_usage;
    if (extra?.is_enabled === true) {
        const used = typeof extra.used_credits === "number" && typeof extra.monthly_limit === "number" && extra.monthly_limit > 0 ? (extra.used_credits / extra.monthly_limit) * 100 : extra.utilization;
        add("extra", "Extra usage", used, null);
    }
    if (!windows.length) throw new Error("Claude's answer had none of the plan limits Paperboard knows how to show.");
    return { plan, windows };
}

function codexLabel(mins: number): string {
    if (mins >= MONTH_MINS) return "Monthly";
    if (mins >= WEEK_MINS) return "Weekly";
    return "Session";
}

/** Codex's answer to account/rateLimits/read: primary and secondary are positions, each with its window's length. */
export function codexUsage(answer: unknown): BrainUsage {
    const a = answer as { rateLimits?: any; rateLimitsByLimitId?: Record<string, any> } | null;
    const s = a?.rateLimitsByLimitId?.codex ?? a?.rateLimits;
    if (!s || typeof s !== "object") throw new Error("Codex's usage answer wasn't what was expected");
    const monthlyPlan = s.planType === "free" || s.planType === "go";
    const windows: UsageWindow[] = [];
    const positions: [string, any, number][] = [
        ["primary", s.primary, monthlyPlan ? MONTH_MINS : 5 * HOUR_MINS],
        ["secondary", s.secondary, WEEK_MINS],
    ];
    for (const [id, w, fallback] of positions) {
        const used = percent(w?.usedPercent);
        if (used === null) continue;
        const mins = typeof w.windowDurationMins === "number" && w.windowDurationMins > 0 ? w.windowDurationMins : fallback;
        windows.push({ id, label: codexLabel(mins), used, resetsAt: isoOf(w.resetsAt) });
    }
    const left = percent(s.individualLimit?.remainingPercent);
    if (left !== null) windows.push({ id: "credits", label: "Monthly credits", used: 100 - left, resetsAt: isoOf(s.individualLimit.resetsAt) });
    return { plan: planName(s.planType), windows };
}
