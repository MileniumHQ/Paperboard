import type { PaperCraneEngine } from "../engine";
import type { RpcContext } from "./context";
import { assertPanelId, rpcErrorCode } from "./params";
import { invalidParams } from "./errors";
import { requireHost, resourcePanelId } from "../principal";
import { PanelProblems } from "../problems";
import { problemKey, readProblemReport } from "../../../../packages/paperapi/src/problemShape";
import { errorMessage } from "../../../../packages/paperapi/src/errors";

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
export async function handleProblems(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    if (!action.startsWith("problems:")) return false;
    const problems = problemsFor(ctx.engine);
    const panelId = () => resourcePanelId(ctx.callerPanelId(), assertPanelId(params?.panelId), action)!;
    try {
        switch (action) {
            case "problems:report": {
                const report = checked(() => readProblemReport(params));
                if (report.key === undefined) throw invalidParams("A problem needs a key");
                problems.report(panelId(), { key: report.key, title: report.title, message: report.message });
                ctx.reply(id, { success: true });
                return true;
            }
            case "problems:clear": {
                const key = params?.key === undefined ? undefined : checked(() => problemKey(params.key));
                problems.clear(panelId(), key);
                ctx.reply(id, { success: true });
                return true;
            }
            case "problems:list":
                ctx.reply(id, { problems: problems.list(panelId()) });
                return true;
            case "problems:every":
                requireHost(ctx.callerPanelId(), action);
                ctx.reply(id, { panels: problems.every() });
                return true;
            default:
                return false;
        }
    } catch (err: any) {
        ctx.reply(id, null, err?.message || "Problem operation failed", rpcErrorCode(err));
        return true;
    }
}
