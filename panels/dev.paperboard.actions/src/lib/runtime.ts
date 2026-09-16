import {
    actions as actionsApi,
    processApi,
    systemApi,
    files,
    resolveOneShotShell,
} from "@paperboard-dev/paperapi";
import { Parser as ExprParser } from "expr-eval";
import type { CanvasBlock } from "./tree";
import { BUILTIN_DEFS } from "./builtinRegistry";
import { ACTIONS_PANEL_ID } from "../panelId";
import {
    base64Decode,
    base64Encode,
    getField,
    isTruthyFlowValue,
    listLength,
    measureDuration,
    padText,
    parseJson,
    pickFromList,
    regexExtract,
    regexMatch,
    splitText,
    stringifyJson,
    toNumber,
    truncateText,
} from "./builtinData";
import { egressRefusal } from "./networkEgress";

const mathParser = new ExprParser();

export interface ExecutionLog {
    id: string;
    timestamp: string;
    triggerName: string;
    status: "running" | "success" | "error";
    message: string;
    steps: {
        actionName: string;
        result?: any;
        error?: string;
    }[];
}

async function getHostPlatform(): Promise<"linux" | "darwin" | "win32"> {
    try {
        const info = await systemApi.getInfo();
        const o = (info?.os || "").toLowerCase();
        if (o.includes("win")) return "win32";
        if (o.includes("darwin") || o.includes("mac")) return "darwin";
        return "linux";
    } catch (err) {
        // daemon unreachable — user-agent sniffing is the documented
        // fallback, not a silent one
        console.debug("[ActionsRuntime] host platform probe failed, sniffing UA:", err);
        const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
        if (ua.includes("Win")) return "win32";
        if (ua.includes("Mac")) return "darwin";
        return "linux";
    }
}

async function runHostShell(cmd: string): Promise<string> {
    const plat = await getHostPlatform();
    // shared with the terminal panel (PaperAPI): one shell resolution
    const shell = resolveOneShotShell(plat);

    try {
        const res = await processApi.exec(shell.command, [...shell.baseArgs, cmd]);
        return res.stdout || res.stderr;
    } catch (err: any) {
        // a shell failure fails the step loudly: returning "" would report
        // success with empty output and let the flow continue on a lie
        throw new Error(`Shell command failed: ${err?.message || String(err)}`);
    }
}

function stringifyValue(val: any): string {
    if (val === undefined || val === null) return "";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);

    if (typeof val === "object") {
        if (typeof val.content === "string") return val.content;
        if (typeof val.text === "string") return val.text;
        if (typeof val.message === "string") return val.message;
        if (typeof val.name === "string") return val.name;
        if (typeof val.value === "string") return val.value;
        return JSON.stringify(val);
    }

    return String(val);
}

function getNestedValue(obj: any, path: string): any {
    if (obj === null || obj === undefined) return undefined;
    if (path === "output" || path === "data" || path === "value" || path === "result") {
        return obj;
    }
    const parts = path.split(".");

    if (parts.length === 2 && (parts[0] === "message" || parts[0] === "chat") && obj[parts[1]] !== undefined) {
        return obj[parts[1]];
    }

    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

export function resolveToken(
    token: string,
    label: string,
    contextPayload: any = {},
    triggerPayload: any = {},
    outputType?: string,
    stepOutputsByLabel?: Map<string, any>,
    stepOutputsByRef?: Map<string, any>,
): { found: boolean; value?: any } {
    // block refs win over shared labels
    if (stepOutputsByRef) {
        const byRef = stepOutputsByRef.get(token);
        if (byRef !== undefined && byRef !== null) {
            return { found: true, value: byRef };
        }
    }

    // step outputs by label
    if (stepOutputsByLabel) {
        if (label) {
            const byLabel = stepOutputsByLabel.get(label.toLowerCase());
            if (byLabel !== undefined && byLabel !== null) {
                return { found: true, value: byLabel };
            }
        }
        const byToken = stepOutputsByLabel.get(token.toLowerCase());
        if (byToken !== undefined && byToken !== null) {
            return { found: true, value: byToken };
        }
    }

    // last output
    if (typeof contextPayload === "object" && contextPayload !== null) {
        const nested = getNestedValue(contextPayload, token);
        if (nested !== undefined) {
            return { found: true, value: nested };
        }
    }

    // trigger payload
    if (typeof triggerPayload === "object" && triggerPayload !== null) {
        const nested = getNestedValue(triggerPayload, token);
        if (nested !== undefined) {
            return { found: true, value: nested };
        }
    }

    const lowerToken = token.toLowerCase();

    // generic names
    if (["output", "data", "value", "result"].includes(lowerToken)) {
        const source =
            contextPayload !== undefined && contextPayload !== null
                ? contextPayload
                : triggerPayload;
        if (source !== undefined && source !== null) {
            return { found: true, value: source };
        }
    }

    // output type match
    if (outputType && lowerToken === outputType.toLowerCase()) {
        if (triggerPayload !== undefined && triggerPayload !== null) {
            return { found: true, value: triggerPayload };
        }
    }

    // primitive payloads
    if (typeof triggerPayload === "string" || typeof triggerPayload === "number") {
        return { found: true, value: triggerPayload };
    }

    if (typeof contextPayload === "string" || typeof contextPayload === "number") {
        return { found: true, value: contextPayload };
    }

    return { found: false };
}

export function interpolateString(
    template: string,
    contextPayload: any,
    triggerPayload: any,
    outputType?: string,
    stepOutputsByLabel?: Map<string, any>,
    stepOutputsByRef?: Map<string, any>,
): string {
    if (typeof template !== "string") return template;

    // double braces only, single-brace text survives untouched
    return template.replace(/\{\{([^{}]+)\}\}/g, (fullMatch, rawToken) => {
        const parts = rawToken.split(":");
        const token = parts[0].trim();
        const label = parts[1] ? parts[1].trim() : "";

        const lookup = resolveToken(
            token,
            label,
            contextPayload,
            triggerPayload,
            outputType,
            stepOutputsByLabel,
            stepOutputsByRef,
        );
        if (lookup.found) return stringifyValue(lookup.value);
        return fullMatch;
    });
}

const VARIABLE_REF_PATTERN = /\{\{([^{}]+)\}\}/g;

function parseVariableRef(raw: string): { token: string; label: string } {
    const parts = raw.split(":");
    return {
        token: (parts[0] || "").trim(),
        label: parts[1] ? parts[1].trim() : "",
    };
}

function isArrayLikeType(t?: string): boolean {
    if (!t) return false;
    return t === "array" || t.startsWith("list<") || t.startsWith("array<");
}

// pure refs in object/array inputs resolve raw, not stringified
function tryResolveRawReferences(
    val: string,
    defType: string | undefined,
    contextPayload: any,
    triggerPayload: any,
    outputType?: string,
    stepOutputsByLabel?: Map<string, any>,
    stepOutputsByRef?: Map<string, any>,
): { handled: boolean; value?: any } {
    const refs: string[] = [];
    let match: RegExpExecArray | null;
    VARIABLE_REF_PATTERN.lastIndex = 0;
    while ((match = VARIABLE_REF_PATTERN.exec(val)) !== null) {
        refs.push(match[1]);
    }
    if (refs.length === 0) return { handled: false };

    const remainder = val.replace(VARIABLE_REF_PATTERN, "").trim();
    if (remainder !== "") return { handled: false };

    const resolvedAll: any[] = [];
    for (const raw of refs) {
        const { token, label } = parseVariableRef(raw);
        if (!token) return { handled: false };
        const lookup = resolveToken(
            token,
            label,
            contextPayload,
            triggerPayload,
            outputType,
            stepOutputsByLabel,
            stepOutputsByRef,
        );
        if (!lookup.found) return { handled: false };
        resolvedAll.push(lookup.value);
    }

    if (isArrayLikeType(defType)) {
        if (resolvedAll.length === 1 && Array.isArray(resolvedAll[0])) {
            return { handled: true, value: resolvedAll[0] };
        }
        return { handled: true, value: resolvedAll };
    }

    if (resolvedAll.length === 1) {
        return { handled: true, value: resolvedAll[0] };
    }

    return { handled: false };
}

function isObjectishType(t?: string): boolean {
    if (!t) return false;
    if (isArrayLikeType(t)) return true;
    return !["string", "number", "boolean", "select", "any", "void", "file"].includes(t);
}

/**
 * Tokens left in a string after interpolation are references whose source is
 * gone (block moved/removed). Surfacing them here gives the console a
 * readable reason instead of forwarding `{{channelId:Channel:tag}}` to an
 * API that answers with a raw validation error.
 */
export function findUnresolvedReferences(
    text: string,
): { token: string; label: string }[] {
    const found: { token: string; label: string }[] = [];
    const pattern = /\{\{([^{}]+)\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const parts = match[1].split(":");
        found.push({
            token: (parts[0] || "").trim(),
            label: (parts[1] || "").trim(),
        });
    }
    return found;
}

function unresolvedReferenceError(
    key: string,
    label: string | undefined,
    unresolved: { token: string; label: string }[],
): Error {
    const first = unresolved[0];
    const name = first.label || first.token || "variable";
    return new Error(
        `Variable "${name}" for "${label || key}" has no source here. The block that provided it was moved or removed. Reconnect it or clear the reference.`,
    );
}

export function resolveInputs(
    inputsMap: Record<string, any> = {},
    values: Record<string, any> = {},
    contextPayload: any = {},
    triggerPayload: any = {},
    outputType?: string,
    stepOutputsByLabel?: Map<string, any>,
    stepOutputsByRef?: Map<string, any>,
): Record<string, any> {
    const resolved: Record<string, any> = {};
    const allKeys = new Set([
        ...Object.keys(inputsMap || {}),
        ...Object.keys(values || {}),
    ]);

    for (const key of allKeys) {
        const def = inputsMap?.[key];
        let val = values?.[key];

        if (val === undefined || val === null || val === "") {
            val = def?.default !== undefined ? def.default : "";
        }

        if (typeof val === "string") {
            if (isObjectishType(def?.type)) {
                const raw = tryResolveRawReferences(
                    val,
                    def?.type,
                    contextPayload,
                    triggerPayload,
                    outputType,
                    stepOutputsByLabel,
                    stepOutputsByRef,
                );
                if (raw.handled) {
                    resolved[key] = raw.value;
                    continue;
                }
            }

            const interpolated = interpolateString(
                val,
                contextPayload,
                triggerPayload,
                outputType,
                stepOutputsByLabel,
                stepOutputsByRef,
            );

            const unresolved = findUnresolvedReferences(interpolated);
            if (unresolved.length > 0) {
                throw unresolvedReferenceError(key, def?.label, unresolved);
            }

            if (def?.type === "number") {
                const parsed = Number(interpolated);
                if (!isNaN(parsed) && interpolated.trim() !== "") {
                    resolved[key] = parsed;
                    continue;
                }
            } else if (def?.type === "boolean") {
                if (interpolated === "true" || interpolated === "1") {
                    resolved[key] = true;
                    continue;
                }
                if (interpolated === "false" || interpolated === "0") {
                    resolved[key] = false;
                    continue;
                }
            }

            resolved[key] = interpolated;
        } else {
            resolved[key] = val;
        }
    }

    return resolved;
}

function evaluateMath(expression: string): number {
    const text = (expression ?? "").trim();
    if (!text) {
        throw new Error("math-calculate: expression is empty");
    }
    let result: unknown;
    try {
        result = mathParser.evaluate(text);
    } catch (err) {
        throw new Error(
            `math-calculate: cannot parse expression "${text}": ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (typeof result !== "number" || !Number.isFinite(result)) {
        throw new Error(`math-calculate: expression "${text}" did not evaluate to a finite number`);
    }
    return result;
}

function evaluateCondition(left: any, operator: string, right: any): boolean {
    const l = left !== undefined && left !== null ? String(left).trim() : "";
    const r = right !== undefined && right !== null ? String(right).trim() : "";

    const lNum = Number(l);
    const rNum = Number(r);
    const areBothNumbers = !isNaN(lNum) && !isNaN(rNum) && l !== "" && r !== "";

    switch (operator) {
        case "==":
        case "equals":
            return areBothNumbers ? lNum === rNum : l.toLowerCase() === r.toLowerCase();

        case "!=":
        case "not-equals":
            return areBothNumbers ? lNum !== rNum : l.toLowerCase() !== r.toLowerCase();

        case ">":
        case "greater":
            return areBothNumbers ? lNum > rNum : l.localeCompare(r) > 0;

        case "<":
        case "less":
            return areBothNumbers ? lNum < rNum : l.localeCompare(r) < 0;

        case "includes":
        case "contains":
            return l.toLowerCase().includes(r.toLowerCase());

        case "starts-with":
        case "startsWith":
            return l.toLowerCase().startsWith(r.toLowerCase());

        case "ends-with":
        case "endsWith":
            return l.toLowerCase().endsWith(r.toLowerCase());

        case "is-true":
            return (
                l.toLowerCase() === "true" ||
                l === "1" ||
                (areBothNumbers && lNum !== 0) ||
                (l !== "" && l !== "0" && l.toLowerCase() !== "false")
            );

        case "is-false":
            return (
                l.toLowerCase() === "false" ||
                l === "0" ||
                l === "" ||
                (areBothNumbers && lNum === 0)
            );

        default:
            return areBothNumbers ? lNum === rNum : l === r;
    }
}

// bounded per loop: a million-item list must not park the flow forever
export const MAX_FOREACH_ITERATIONS = 10_000;

export class FlowLoopSignal extends Error {
    readonly kind: "break" | "continue";
    constructor(kind: "break" | "continue") {
        super(kind === "break" ? "Break outside a loop" : "Continue outside a loop");
        this.name = "FlowLoopSignal";
        this.kind = kind;
    }
}

const flowVariablesStore = new Map<string, any>();

// BOUNDED: an action flow that set-variables in a loop must not be able to
// grow the persisted store without limit (both memory and variables.json).
const MAX_VARIABLES = 500;

const VARIABLES_PATH = "actions-variables/variables.json";
let variablesPersistTimer: ReturnType<typeof setTimeout> | undefined;

export async function initVariablesStore(): Promise<void> {
    try {
        const raw = await files.read(VARIABLES_PATH, ACTIONS_PANEL_ID);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            for (const [k, v] of Object.entries(parsed)) {
                flowVariablesStore.set(k, v);
            }
        }
    } catch (err) {
        // a wiped variables store looks like "user lost data" — surface it
        console.error("[ActionsRuntime] variables store failed to load:", err);
    }
}

function schedulePersistVariables() {
    if (variablesPersistTimer) clearTimeout(variablesPersistTimer);
    variablesPersistTimer = setTimeout(() => {
        variablesPersistTimer = undefined;
        try {
            const obj = Object.fromEntries(flowVariablesStore);
            files
                .write(VARIABLES_PATH, JSON.stringify(obj), ACTIONS_PANEL_ID)
                .catch((err) =>
                    console.error("[ActionsRuntime] variables persist failed:", err),
                );
        } catch (err) {
            console.error("[ActionsRuntime] variables serialize failed:", err);
        }
    }, 250);
}

// responses are text-only feature data: cap what a block will hold
const HTTP_RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
// fetch steps honor the panel's own manifest network declaration (see
// lib/networkEgress.ts); the daemon CSP stays the enforcement boundary
function assertNetworkAllowed(rawUrl: string): void {
    const refusal = egressRefusal(rawUrl);
    if (refusal) {
        throw new Error(`Refusing fetch: ${refusal}`);
    }
}
async function fetchCappedText(res: Response): Promise<string> {
    const declared = Number(res.headers.get("content-length")) || 0;
    if (declared > HTTP_RESPONSE_MAX_BYTES) {
        throw new Error(`Response exceeds ${HTTP_RESPONSE_MAX_BYTES / 1024 / 1024}MB cap (${declared} declared)`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Response has no body");
    const decoder = new TextDecoder();
    let text = "";
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > HTTP_RESPONSE_MAX_BYTES) {
            await reader.cancel();
            throw new Error(`Response exceeds ${HTTP_RESPONSE_MAX_BYTES / 1024 / 1024}MB cap`);
        }
        text += decoder.decode(value, { stream: true });
    }
    return text;
}

type BuiltinHandler = (
    inputs: Record<string, any>,
    onConsoleLog?: (entry: { time: string; message: string }) => void,
) => Promise<any> | any;

// control-flow ids run in executeFlow, so no handler entry here
// wait durations are CLAMPED: an "Infinity"/huge duration must not be able
// to park a flow execution (and its resources) forever
export const MAX_WAIT_SECONDS = 3600;
export const MAX_WAIT_MILLIS = MAX_WAIT_SECONDS * 1000;

// pure clamp, exported for tests
export function clampWaitValue(raw: string | number, unit: "s" | "ms"): number {
    const parsed =
        typeof raw === "number"
            ? raw
            : unit === "s"
                ? parseFloat(raw || "1")
                : parseInt(raw || "500", 10);
    if (Number.isNaN(parsed)) return unit === "s" ? 1 : 500;
    // infinity (explicit or parsed) clamps to the cap, never the default:
    // the author asked for a long wait, the cap is the long wait
    if (!Number.isFinite(parsed)) return unit === "s" ? MAX_WAIT_SECONDS : MAX_WAIT_MILLIS;
    const cap = unit === "s" ? MAX_WAIT_SECONDS : MAX_WAIT_MILLIS;
    return Math.max(0, Math.min(cap, parsed));
}

const builtinHandlers: Record<string, BuiltinHandler> = {
    wait: async (inputs) => {
        const sec = clampWaitValue(
            typeof inputs.duration === "number" ? inputs.duration : (inputs.duration as string), "s",
        );
        await new Promise((resolve) => setTimeout(resolve, sec * 1000));
        return sec;
    },
    "wait-millis": async (inputs) => {
        const ms = clampWaitValue(
            typeof inputs.duration === "number" ? inputs.duration : (inputs.duration as string), "ms",
        );
        await new Promise((resolve) => setTimeout(resolve, ms));
        return ms;
    },
    "stop-flow": () => {
        throw new Error("FLOW_STOPPED");
    },
    break: () => {
        throw new FlowLoopSignal("break");
    },
    continue: () => {
        throw new FlowLoopSignal("continue");
    },
    "set-variable": (inputs) => {
        const key = String(inputs.key || "var");
        if (!flowVariablesStore.has(key) && flowVariablesStore.size >= MAX_VARIABLES) {
            throw new Error(
                `Variable store full: ${MAX_VARIABLES} variables is the limit. Clear unused variables`,
            );
        }
        const val = inputs.value ?? "";
        flowVariablesStore.set(key, val);
        schedulePersistVariables();
        return val;
    },
    "increment-variable": (inputs) => {
        const key = String(inputs.key || "counter");
        const cur = Number(flowVariablesStore.get(key) || 0);
        const amt = Number(inputs.amount || 1);
        const next = cur + amt;
        flowVariablesStore.set(key, next);
        schedulePersistVariables();
        return next;
    },
    "clear-variable": (inputs) => {
        const key = String(inputs.key || "");
        flowVariablesStore.delete(key);
        schedulePersistVariables();
        return null;
    },
    "get-variable": (inputs) => {
        const key = String(inputs.key || "");
        return flowVariablesStore.get(key) ?? "";
    },
    "math-calculate": (inputs) => evaluateMath(String(inputs.expression || "0")),
    "math-random": (inputs) => {
        const min = Math.ceil(Number(inputs.min ?? 1));
        const max = Math.floor(Number(inputs.max ?? 10));
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    "math-round": (inputs) => Math.round(Number(inputs.number ?? 0)),
    "math-clamp": (inputs) => {
        const value = Number(inputs.value ?? 0);
        const min = Number(inputs.min ?? 0);
        const max = Number(inputs.max ?? 0);
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        return Math.min(hi, Math.max(lo, value));
    },
    "math-min": (inputs) => Math.min(Number(inputs.a ?? 0), Number(inputs.b ?? 0)),
    "math-max": (inputs) => Math.max(Number(inputs.a ?? 0), Number(inputs.b ?? 0)),
    "math-absolute": (inputs) => Math.abs(Number(inputs.value ?? 0)),
    "math-floor": (inputs) => Math.floor(Number(inputs.value ?? 0)),
    "math-ceiling": (inputs) => Math.ceil(Number(inputs.value ?? 0)),
    "random-uuid": () => crypto.randomUUID(),
    "logic-not": (inputs) => !inputs.value,
    "is-empty": (inputs) => String(inputs.text ?? "").trim().length === 0,
    coalesce: (inputs) => {
        const first = String(inputs.first ?? "");
        return first.trim() !== "" ? first : String(inputs.second ?? "");
    },
    "now-timestamp": () => Date.now(),
    "format-date": (inputs) => {
        const ts = Number(inputs.timestamp ?? Date.now());
        const d = new Date(isNaN(ts) ? Date.now() : ts);
        return d.toLocaleString();
    },
    "day-of-week": (inputs) => {
        const ts = Number(inputs.timestamp ?? Date.now());
        const d = new Date(isNaN(ts) ? Date.now() : ts);
        return d.toLocaleDateString(undefined, { weekday: "long" });
    },
    "add-time": (inputs) => {
        const ts = Number(inputs.timestamp ?? Date.now());
        const amount = Number(inputs.amount ?? 0);
        const multipliers: Record<string, number> = {
            seconds: 1000,
            minutes: 60000,
            hours: 3600000,
            days: 86400000,
        };
        const mult = multipliers[String(inputs.unit || "minutes")] || 60000;
        return (isNaN(ts) ? Date.now() : ts) + (isNaN(amount) ? 0 : amount) * mult;
    },
    "http-get": async (inputs) => {
        const url = String(inputs.url ?? "").trim();
        if (!url) throw new Error("URL is required");
        assertNetworkAllowed(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) {
            throw new Error(`Request failed with status ${res.status}`);
        }
        return await fetchCappedText(res);
    },
    "http-post": async (inputs) => {
        const url = String(inputs.url ?? "").trim();
        if (!url) throw new Error("URL is required");
        assertNetworkAllowed(url);
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": String(inputs.contentType || "application/json"),
            },
            body: String(inputs.body ?? ""),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            throw new Error(`Request failed with status ${res.status}`);
        }
        return await fetchCappedText(res);
    },
    "get-url-json": async (inputs) => {
        const url = String(inputs.url ?? "").trim();
        if (!url) throw new Error("URL is required");
        assertNetworkAllowed(url);
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            throw new Error(`Request failed with status ${res.status}`);
        }
        return parseJson(await fetchCappedText(res));
    },
    "wait-until": async (inputs) => {
        const name = String(inputs.variable ?? "").trim();
        if (!name) throw new Error("Wait Until needs a variable name");
        const seconds = clampWaitValue(
            typeof inputs.timeout === "number" ? inputs.timeout : (inputs.timeout as string),
            "s",
        );
        const deadline = Date.now() + seconds * 1000;
        // poll, don't subscribe: the store lives in this module and the
        // step is bounded by the deadline either way
        while (Date.now() <= deadline) {
            if (isTruthyFlowValue(flowVariablesStore.get(name))) return true;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw new Error(
            `Wait Until timed out after ${seconds}s waiting for "${name}" to become true`,
        );
    },
    "measure-duration": (inputs) => measureDuration(inputs.since),
    "throw-error": (inputs) => {
        throw new Error(String(inputs.message ?? "Flow stopped by a Throw Error step"));
    },
    "text-split": (inputs) => splitText(inputs.text, inputs.separator),
    "text-regex-match": (inputs) => regexMatch(inputs.text, inputs.pattern),
    "text-regex-extract": (inputs) =>
        regexExtract(inputs.text, inputs.pattern, inputs.group),
    "text-truncate": (inputs) => truncateText(inputs.text, inputs.length, inputs.ellipsis),
    "text-pad": (inputs) => padText(inputs.text, inputs.length, inputs.side, inputs.fill),
    "text-to-number": (inputs) => toNumber(inputs.text),
    "text-base64-encode": (inputs) => base64Encode(inputs.text),
    "text-base64-decode": (inputs) => base64Decode(inputs.text),
    "json-parse": (inputs) => parseJson(inputs.text),
    "json-stringify": (inputs) => stringifyJson(inputs.value, inputs.pretty),
    "get-field": (inputs) => getField(inputs.value, inputs.path),
    "list-length": (inputs) => listLength(inputs.list),
    "pick-from-list": (inputs) => pickFromList(inputs.list, inputs.index),
    text: (inputs) => String(inputs.value ?? ""),
    "text-join": (inputs) => `${inputs.text1 ?? ""}${inputs.text2 ?? ""}`,
    "text-replace": (inputs) => {
        const text = String(inputs.text ?? "");
        const find = String(inputs.find ?? "");
        if (!find) return text;
        return text.split(find).join(String(inputs.replacement ?? ""));
    },
    "text-trim": (inputs) => String(inputs.text ?? "").trim(),
    "text-contains": (inputs) =>
        String(inputs.text ?? "")
            .toLowerCase()
            .includes(String(inputs.substring ?? "").toLowerCase()),
    "text-starts-with": (inputs) =>
        String(inputs.text ?? "")
            .toLowerCase()
            .startsWith(String(inputs.prefix ?? "").toLowerCase()),
    "text-ends-with": (inputs) =>
        String(inputs.text ?? "")
            .toLowerCase()
            .endsWith(String(inputs.suffix ?? "").toLowerCase()),
    "text-slice": (inputs) => {
        const text = String(inputs.text ?? "");
        const start = Math.trunc(Number(inputs.start ?? 0));
        const endRaw = inputs.end;
        if (endRaw === undefined || endRaw === null || String(endRaw).trim() === "") {
            return text.slice(start);
        }
        return text.slice(start, Math.trunc(Number(endRaw)));
    },
    "text-length": (inputs) => String(inputs.text ?? "").length,
    "text-uppercase": (inputs) => String(inputs.text ?? "").toUpperCase(),
    "text-lowercase": (inputs) => String(inputs.text ?? "").toLowerCase(),
    "log-console": (inputs, onConsoleLog) => {
        const msg = String(inputs.message ?? "");
        onConsoleLog?.({
            time: new Date().toLocaleTimeString(),
            message: msg,
        });
        return msg;
    },
    "play-beep": async () => {
        await systemApi.beep();
        return true;
    },
    "run-command": async (inputs) => {
        return await runHostShell(inputs.command || "");
    },
    "take-screenshot": async (inputs) => {
        const savePath = inputs.savePath || "screenshot.png";
        return await systemApi.screenshot(savePath);
    },
    "set-volume": async (inputs) => {
        const vol = Math.max(0, Math.min(100, Math.round(Number(inputs.volume ?? 50))));
        return await systemApi.setVolume(vol);
    },
    "mute-audio": async (inputs) => {
        const muted = Boolean(inputs.muted);
        return await systemApi.setMuted(muted);
    },
    "send-notification": async (inputs) => {
        const title = String(inputs.title || "Paperboard");
        const message = String(inputs.message || "Notification");
        await systemApi.notify(title, message);
        return true;
    },
    "lock-screen": async () => {
        const plat = await getHostPlatform();
        if (plat === "linux") {
            await runHostShell(
                `loginctl lock-session 2>/dev/null || qdbus org.freedesktop.ScreenSaver /ScreenSaver Lock 2>/dev/null || xdg-screensaver lock 2>/dev/null`,
            );
        } else if (plat === "darwin") {
            await runHostShell(
                `pmset displaysleepnow 2>/dev/null || /System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend 2>/dev/null`,
            );
        } else {
            await runHostShell(`rundll32.exe user32.dll,LockWorkStation`);
        }
        return true;
    },
};

async function executeBuiltinAction(
    actionId: string,
    inputs: Record<string, any>,
    onConsoleLog?: (entry: { time: string; message: string }) => void,
): Promise<any> {
    const handler = builtinHandlers[actionId];
    // silent success is worse than an error: downstream steps would consume
    // garbage. A registry id with no handler fails the step loudly.
    if (!handler) {
        throw new Error(`Unknown builtin action "${actionId}": no handler registered`);
    }
    return await handler(inputs, onConsoleLog);
}

// every registry id needs a handler or a control-flow exemption
const BUILTIN_NO_HANDLER_IDS = new Set([
    "repeat",
    "if",
    "if-else",
    "for-each",
    "switch",
    "switch-case",
    "on-play",
]);
for (const def of BUILTIN_DEFS) {
    if (!builtinHandlers[def.id] && !BUILTIN_NO_HANDLER_IDS.has(def.id)) {
        console.warn(`[Actions Runtime] No handler for builtin "${def.id}"`);
    }
}

export interface FunctionCallHooks {
    getFunctionBody?: (fid: string) => CanvasBlock[] | null;
    getFunctionName?: (fid: string) => string;
    countFunctionBodies?: (fid: string) => number;
    captureOutput?: (output: any) => void;
}

const activeFunctionCalls = new Set<string>();

export async function runFunctionCall(
    fid: string,
    inputs: Record<string, any>,
    hooks: FunctionCallHooks & {
        onStepChange?: (stepBlockId: string | null, status: "start" | "end") => void;
        onConsoleLog?: (entry: { time: string; message: string }) => void;
    },
): Promise<any> {
    const body = hooks.getFunctionBody?.(fid);
    if (!body) {
        throw new Error(`Unknown function (id: ${fid})`);
    }
    const bodies = hooks.countFunctionBodies?.(fid) || 1;
    if (bodies > 1) {
        hooks.onConsoleLog?.({
            time: new Date().toLocaleTimeString(),
            message: `Function "${hooks.getFunctionName?.(fid) || fid}" has ${bodies} body triggers; using the first.`,
        });
    }
    if (activeFunctionCalls.has(fid)) {
        const name = hooks.getFunctionName?.(fid) || fid;
        throw new Error(`Recursive call of function "${name}" is not allowed`);
    }
    activeFunctionCalls.add(fid);
    try {
        let bodyOutput: any = undefined;
        const subTrigger = {
            id: `fnbody_${fid}`,
            action: {
                id: `function-trigger-${fid}`,
                name: `Function ${hooks.getFunctionName?.(fid) || fid}`,
            },
            children: body,
        } as CanvasBlock;
        await executeFlow(
            subTrigger,
            { ...(inputs || {}) },
            undefined,
            hooks.onStepChange,
            hooks.onConsoleLog,
            {
                getFunctionBody: hooks.getFunctionBody,
                getFunctionName: hooks.getFunctionName,
                countFunctionBodies: hooks.countFunctionBodies,
                captureOutput: (o) => {
                    bodyOutput = o;
                },
            },
        );
        return bodyOutput;
    } finally {
        activeFunctionCalls.delete(fid);
    }
}

export async function executeFlow(
    triggerBlock: CanvasBlock,
    triggerPayload: any = {},
    onLog?: (log: ExecutionLog) => void,
    onStepChange?: (stepBlockId: string | null, status: "start" | "end") => void,
    onConsoleLog?: (entry: { time: string; message: string }) => void,
    hooks?: FunctionCallHooks,
): Promise<ExecutionLog> {
    const log: ExecutionLog = {
        id: `exec_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        triggerName: triggerBlock.action.name,
        status: "running",
        message: `Trigger "${triggerBlock.action.name}" fired`,
        steps: [],
    };

    // neutral start/success states are not logged: the console shows only
    // failures and the flow's own Log to Console actions
    if (!triggerBlock.children || triggerBlock.children.length === 0) {
        log.status = "success";
        log.message = "Trigger fired (no actions to execute)";
        hooks?.captureOutput?.(triggerPayload);
        return log;
    }

    const triggerOutputType =
        typeof triggerBlock.action.output === "string"
            ? triggerBlock.action.output
            : (triggerBlock.action.output as any)?.type;

    const stepOutputsByLabel = new Map<string, any>();
    const stepOutputsByRef = new Map<string, any>();
    let lastOutput = triggerPayload;

    // Break/Continue are thrown by their steps and caught by the nearest
    // loop; anywhere else the message explains itself
    const runLoopBody = async (
        body: CanvasBlock[] | undefined,
    ): Promise<"completed" | "break" | "continue"> => {
        if (!body || body.length === 0) return "completed";
        try {
            await executeBlockList(body);
            return "completed";
        } catch (err) {
            if (err instanceof FlowLoopSignal) return err.kind;
            throw err;
        }
    };

    async function executeBlockList(blocksToRun: CanvasBlock[]): Promise<void> {
        for (const child of blocksToRun) {
            onStepChange?.(child.id, "start");

            const schema = child.action as any;
            const panelId = child.panelId || schema.panelId || triggerBlock.panelId;
            const actionId = schema.id;
            if (!panelId || !actionId) {
                throw new Error(
                    `Corrupt block ${child.id}: missing panelId/action id (no migration; re-create the block)`,
                );
            }

            const resolvedInputs = resolveInputs(
                schema.inputs || {},
                child.values || {},
                lastOutput,
                triggerPayload,
                triggerOutputType,
                stepOutputsByLabel,
                stepOutputsByRef,
            );

            const stepLog: { actionName: string; result?: any; error?: string } = {
                actionName: schema.name || actionId,
            };

            try {
                let result: any;

                if (typeof actionId === "string" && actionId.startsWith("call-function-")) {
                    const fid = actionId.slice("call-function-".length);
                    const fname =
                        hooks?.getFunctionName?.(fid) ||
                        (schema.name || "").replace(/^Call /, "") ||
                        fid;
                    stepLog.actionName = `Call ${fname}`;
                    log.steps.push(stepLog);

                    result = await runFunctionCall(fid, resolvedInputs, {
                        getFunctionBody: hooks?.getFunctionBody,
                        getFunctionName: hooks?.getFunctionName,
                        onStepChange,
                        onConsoleLog,
                    });
                    // step already pushed above, attach result here
                    stepLog.result = result;
                } else if (actionId === "repeat") {
                    const count = Math.max(0, Math.min(1000, Number(resolvedInputs.count ?? 5)));
                    stepLog.actionName = `Repeat (${count} times)`;
                    log.steps.push(stepLog);

                    let ran = 0;
                    for (let r = 0; r < count; r++) {
                        const outcome = await runLoopBody(child.children);
                        ran += 1;
                        if (outcome === "break") break;
                    }
                    result = ran;
                } else if (actionId === "for-each") {
                    const items = Array.isArray(resolvedInputs.list) ? resolvedInputs.list : [];
                    const capped = Math.min(items.length, MAX_FOREACH_ITERATIONS);
                    if (items.length > capped) {
                        console.warn(
                            `[Actions Runtime] For Each capped at ${MAX_FOREACH_ITERATIONS} of ${items.length} items`,
                        );
                    }
                    stepLog.actionName = `For Each (${capped} items)`;
                    log.steps.push(stepLog);

                    let ran = 0;
                    for (const item of items.slice(0, capped)) {
                        // the current item is this block's output for the body
                        stepOutputsByRef.set(child.id, item);
                        lastOutput = item;
                        const outcome = await runLoopBody(child.children);
                        ran += 1;
                        if (outcome === "break") break;
                    }
                    result = ran;
                } else if (actionId === "if") {
                    const conditionMet = evaluateCondition(
                        resolvedInputs.left,
                        resolvedInputs.operator || "==",
                        resolvedInputs.right,
                    );
                    stepLog.actionName = `If (${conditionMet ? "true" : "false"})`;
                    log.steps.push(stepLog);

                    if (conditionMet && child.children && child.children.length > 0) {
                        await executeBlockList(child.children);
                    }
                    result = conditionMet;
                } else if (actionId === "switch") {
                    const strays = (child.children ?? []).filter(
                        (c) => (c.action as any)?.id !== "switch-case",
                    );
                    if (strays.length > 0) {
                        throw new Error(
                            "Switch can only contain Case blocks; move the other blocks into a Case or out of the Switch",
                        );
                    }
                    const cases = child.children ?? [];
                    stepLog.actionName = `Switch on ${JSON.stringify(resolvedInputs.value)}`;
                    log.steps.push(stepLog);

                    let matched: CanvasBlock | null = null;
                    for (const caseBlock of cases) {
                        const caseInputs = resolveInputs(
                            (caseBlock.action as any).inputs || {},
                            caseBlock.values || {},
                            lastOutput,
                            triggerPayload,
                            triggerOutputType,
                            stepOutputsByLabel,
                            stepOutputsByRef,
                        );
                        if (String(caseInputs.value) === String(resolvedInputs.value)) {
                            matched = caseBlock;
                            break;
                        }
                    }
                    if (matched) {
                        // a Break/Continue inside a Case belongs to the
                        // enclosing loop, so it passes straight through
                        await runLoopBody(matched.children);
                        result = true;
                    } else {
                        await runLoopBody(child.elseChildren);
                        result = false;
                    }
                } else if (actionId === "switch-case") {
                    // Switch consumes its Case children itself; a Case that
                    // runs on its own is misplaced and must say so
                    throw new Error("Case blocks only run inside a Switch");
                } else if (actionId === "if-else") {
                    const conditionMet = evaluateCondition(
                        resolvedInputs.left,
                        resolvedInputs.operator || "==",
                        resolvedInputs.right,
                    );
                    stepLog.actionName = `If/Else (${conditionMet ? "if branch" : "else branch"})`;
                    log.steps.push(stepLog);

                    if (conditionMet) {
                        if (child.children && child.children.length > 0) {
                            await executeBlockList(child.children);
                        }
                    } else {
                        if (child.elseChildren && child.elseChildren.length > 0) {
                            await executeBlockList(child.elseChildren);
                        }
                    }
                    result = conditionMet;
                } else {
                    console.log(
                        `[Actions Runtime] Executing action "${actionId}" on panel "${panelId}" with inputs:`,
                        resolvedInputs,
                    );

                    const isBuiltin = Boolean(panelId && panelId.startsWith("builtin."));
                    if (isBuiltin) {
                        result = await executeBuiltinAction(actionId, resolvedInputs, onConsoleLog);
                    } else {
                        result = await actionsApi.call(panelId, actionId, resolvedInputs);
                    }

                    stepLog.result = result;
                    log.steps.push(stepLog);
                }

                lastOutput = result !== undefined ? result : lastOutput;

                if (result !== undefined) {
                    stepOutputsByRef.set(child.id, result);
                    if (schema.name) stepOutputsByLabel.set(schema.name.toLowerCase(), result);
                    if (actionId) stepOutputsByLabel.set(actionId.toLowerCase(), result);
                    const outDef = schema.output;
                    if (typeof outDef === "string") {
                        stepOutputsByLabel.set(outDef.toLowerCase(), result);
                    } else if (outDef?.label) {
                        stepOutputsByLabel.set(outDef.label.toLowerCase(), result);
                    }
                    stepOutputsByLabel.set("output", result);
                    stepOutputsByLabel.set("result", result);
                }
            } catch (err: any) {
                if (err instanceof FlowLoopSignal) {
                    // loop control is not a failure: the nearest loop
                    // decides, other callers see the explanatory message
                    throw err;
                }
                if (err?.message === "FLOW_STOPPED") {
                    log.status = "success";
                    log.message = `Flow stopped at step "${schema.name}"`;
                    onLog?.(log);
                    onStepChange?.(child.id, "end");
                    throw err;
                }
                console.error(`[Actions Runtime] Error running action "${actionId}":`, err);
                stepLog.error = err?.message || String(err);
                log.steps.push(stepLog);
                log.status = "error";
                log.message = `Failed at step "${schema.name}": ${err?.message || err}`;
                onLog?.(log);
                throw err;
            } finally {
                onStepChange?.(child.id, "end");
            }
        }
    }

    try {
        await executeBlockList(triggerBlock.children);
        log.status = "success";
        log.message = `Successfully completed flow actions`;
        hooks?.captureOutput?.(lastOutput);
    } catch (err: any) {
        if (err?.message !== "FLOW_STOPPED") {
            log.status = "error";
            // loop-control signals escaped without a step entry (the step
            // books them as failures above); the message must still say why
            if (err instanceof FlowLoopSignal) {
                log.message = err.message;
            }
        }
    }

    // errors already emitted above; a clean run logs nothing
    return log;
}
