import type { RpcContext } from "./context";
import { claimClient, checkClientOwnership, checkSpawnEnv } from "./ownership";
import { rpcModule } from "./dispatch";
import { offeredShells } from "../workloads/shellIntegration";
import type { TerminalStreams } from "../engine/index";

// every stream a terminal has, as events for the socket that asked
function terminalEvents(termId: string, sendEvent: RpcContext["sendEvent"]): TerminalStreams {
    return {
        data: (data) => sendEvent("term:data", { id: termId, data }),
        exit: (exitCode) => sendEvent("term:exit", { id: termId, exitCode }),
        foreground: (name) => sendEvent("term:foreground", { id: termId, name }),
        command: (finished) => sendEvent("term:command", { id: termId, ...finished }),
        cwd: (cwd) => sendEvent("term:cwd", { id: termId, cwd }),
    };
}

export const terminalRpc = rpcModule({
    "term:create": async ({ id, cols, rows, cwd, env, shell }, ctx, action) => {
        checkSpawnEnv(env, ctx, action);
        await claimClient(id, ctx, action, () =>
            ctx.engine.createTerminal(id, { cols: cols ?? 80, rows: rows ?? 24, cwd, env, shell }, terminalEvents(id, ctx.sendEvent), ctx.ws),
        );
        return { success: true };
    },
    "term:write": ({ id, data }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        ctx.engine.writeTerminal(id, data);
        return { success: true };
    },
    "term:resize": ({ id, cols, rows }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        ctx.engine.resizeTerminal(id, cols, rows);
        return { success: true };
    },
    "term:attach": async ({ id }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        const success = await ctx.engine.attachTerminal(id, ctx.ws, terminalEvents(id, ctx.sendEvent));
        // what was said before this socket listened
        const known = ctx.engine.terminalState(id);
        if (known.foreground) ctx.sendEvent("term:foreground", { id, name: known.foreground });
        if (known.cwd) ctx.sendEvent("term:cwd", { id, cwd: known.cwd });
        return { success };
    },
    "term:shells": () => ({ shells: offeredShells() }),
    "term:exists": async ({ id }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        return { running: await ctx.engine.isTerminalRunning(id) };
    },
    "term:destroy": async ({ id }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        await ctx.engine.destroyTerminal(id);
        return { success: true };
    },
});
