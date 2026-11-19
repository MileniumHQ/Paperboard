import type { PaperCraneEngine } from "../engine";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { invalidParams } from "./errors";
import { resourcePanelId } from "../principal";
import { PanelProblems } from "../problems";
import { problemKey, readProblemReport } from "@mileniumhq/paperapi/problemShape";
import { errorMessage } from "@mileniumhq/paperapi/errors";

// one list per engine; it lives as long as the engine does
const lists = new WeakMap<PaperCraneEngine, PanelProblems>();

export function problemsFor(engine: PaperCraneEngine): PanelProblems {
    let problems = lists.get(engine);
    if (!problems) lists.set(engine, (problems = new PanelProblems()));
    return problems;
}

// the SDK's own checks, as typed refusals
function checked<T>(read: () => T): T {
    try {
        return read();
    } catch (err) {
        throw invalidParams(errorMessage(err));
    }
}

// A panel reports and clears its own problems; the shell (the host) reads
// every panel's, and dismisses them.
const problemsOf = (panelId: string, action: string, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), panelId, action)!;

export const problemsRpc = rpcModule({
    "problems:report": (params, ctx, action) => {
        const report = checked(() => readProblemReport(params));
        if (report.key === undefined) throw invalidParams("A problem needs a key");
        problemsFor(ctx.engine).report(problemsOf(params.panelId, action, ctx), { key: report.key, title: report.title, message: report.message });
        return { success: true };
    },
    "problems:clear": ({ panelId, key }, ctx, action) => {
        problemsFor(ctx.engine).clear(problemsOf(panelId, action, ctx), key === undefined ? undefined : checked(() => problemKey(key)));
        return { success: true };
    },
    "problems:clear-prefix": ({ panelId, prefix }, ctx, action) => {
        problemsFor(ctx.engine).clearPrefix(problemsOf(panelId, action, ctx), checked(() => problemKey(prefix)));
        return { success: true };
    },
    "problems:list": ({ panelId }, ctx, action) => ({ problems: problemsFor(ctx.engine).list(problemsOf(panelId, action, ctx)) }),
    "problems:every": (_, ctx) => ({ panels: problemsFor(ctx.engine).every() }),
}, "Problem operation failed");
