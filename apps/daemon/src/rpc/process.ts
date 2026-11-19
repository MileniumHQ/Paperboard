import type { RpcContext } from "./context";
import { claimClient, checkClientOwnership, checkSpawnEnv } from "./ownership";
import type { ProcessStreams } from "../engineWorkloads";
import { InvalidParamsError } from "@mileniumhq/paperapi/protocol";
import { rpcModule } from "./dispatch";

// a process's streams as the events its socket receives
function streamsTo(procId: string, sendEvent: RpcContext["sendEvent"]): ProcessStreams {
    return {
        stdout: (data) => sendEvent("process:data", { id: procId, data, stream: "stdout" }),
        stderr: (data) => sendEvent("process:data", { id: procId, data, stream: "stderr" }),
        exit: (exitCode) => sendEvent("process:exit", { id: procId, exitCode }),
    };
}

export const processRpc = rpcModule({
    "process:run": async ({ id, command, args, cwd, env, stdin, inputEncoding, consoleInput, important }, ctx, action) => {
        if (inputEncoding !== undefined && stdin === false) {
            throw new InvalidParamsError("Invalid parameter: a process started with no input has no inputEncoding");
        }
        checkSpawnEnv(env, ctx, action);
        await claimClient(id, ctx, action, () =>
            ctx.engine.startProcess(id, command, args ?? [], cwd, env, ctx.ws, streamsTo(id, ctx.sendEvent), {
                stdin,
                inputEncoding,
                consoleInput,
                important: important === true,
            }),
        );
        return { success: true };
    },
    "process:write": ({ id, data }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        ctx.engine.writeProcess(id, data);
        return { success: true };
    },
    "process:close-input": ({ id }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        ctx.engine.closeProcessInput(id);
        return { success: true };
    },
    "process:kill": async ({ id, signal }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        await ctx.engine.killProcess(id, signal ?? "SIGTERM");
        return { success: true };
    },
    "process:exists": async ({ id }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        return { running: await ctx.engine.isProcessRunning(id) };
    },
    "process:attach": async ({ id }, ctx, action) => {
        checkClientOwnership(id, ctx, action);
        return { success: await ctx.engine.attachProcess(id, ctx.ws, streamsTo(id, ctx.sendEvent)) };
    },
});
