import type { RpcContext } from "./context";
import { claimClient, checkClientOwnership, checkSpawnEnv } from "./ownership";
import { assertStr, assertOptStr, assertEnvMap, InvalidParamsError } from "./params";

export async function handleProcess(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "process:run": {
            const procId = assertStr(params?.id, "id", 128);
            const command = assertStr(params?.command, "command");
            // refuse, don't coerce: a non-string arg is a caller bug, and
            // silently dropping it would run a different command than asked
            const rawArgs = params?.args ?? [];
            if (!Array.isArray(rawArgs)) {
                throw new InvalidParamsError('Invalid parameter: args must be an array of strings');
            }
            const args = rawArgs.map((a: unknown) => {
                if (typeof a !== "string") {
                    throw new InvalidParamsError("Invalid parameter: every arg must be a string");
                }
                return a;
            });
            const env = assertEnvMap(params?.env, "env");
            checkSpawnEnv(env, ctx, "process:run");
            const started = await claimClient(procId, ctx, "process:run", () => engine.startProcess(
                procId,
                command,
                args,
                assertOptStr(params?.cwd, "cwd", 1024),
                env,
                undefined, // onData omitted — stdout & stderr are individually routed below
                (stdout) => sendEvent("process:data", { id: procId, data: stdout, stream: "stdout" }),
                (stderr) => sendEvent("process:data", { id: procId, data: stderr, stream: "stderr" }),
            ));
            void started.completion.then(({ exitCode }) => {
                sendEvent("process:exit", { id: procId, exitCode });
            }).catch((err) => {
                sendEvent("process:data", { id: procId, data: `\n[Process Error] ${err.message}\n`, stream: "stderr" });
                sendEvent("process:exit", { id: procId, exitCode: 1 });
            });
            reply(id, { success: true });
            return true;
        }
        case "process:write": {
            const procId = assertStr(params?.id, "id", 128);
            checkClientOwnership(procId, ctx, "process:write");
            engine.writeProcess(procId, assertStr(params?.data, "data", 65536, true));
            reply(id, { success: true });
            return true;
        }
        case "process:kill": {
            const procId = assertStr(params?.id, "id", 128);
            checkClientOwnership(procId, ctx, "process:kill");
            await engine.killProcess(procId, assertOptStr(params?.signal, "signal", 32) ?? "SIGTERM");
            reply(id, { success: true });
            return true;
        }
        case "process:exists": {
            const procId = assertStr(params?.id, "id", 128);
            checkClientOwnership(procId, ctx, "process:exists");
            const running = await engine.isProcessRunning(procId);
            reply(id, { running });
            return true;
        }
        case "process:attach": {
            const procId = assertStr(params?.id, "id", 128);
            checkClientOwnership(procId, ctx, "process:attach");
            const success = await engine.attachProcess(
                procId,
                (data) => sendEvent("process:data", { id: procId, data, stream: "stdout" }),
                (stdout) => sendEvent("process:data", { id: procId, data: stdout, stream: "stdout" }),
                (stderr) => sendEvent("process:data", { id: procId, data: stderr, stream: "stderr" }),
                (exitCode) => sendEvent("process:exit", { id: procId, exitCode }),
            );
            reply(id, { success });
            return true;
        }
        default:
            return false;
    }
}
