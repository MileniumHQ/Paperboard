import type { RpcContext } from "./context";

export async function handleProcess(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "process:run": {
            engine.runProcess(
                params.id,
                params.command,
                params.args,
                params.cwd,
                params.env,
                undefined, // onData omitted — stdout & stderr are individually routed below
                (stdout) => sendEvent("process:data", { id: params.id, data: stdout, stream: "stdout" }),
                (stderr) => sendEvent("process:data", { id: params.id, data: stderr, stream: "stderr" }),
            ).then(({ exitCode }) => {
                sendEvent("process:exit", { id: params.id, exitCode });
            }).catch((err) => {
                sendEvent("process:data", { id: params.id, data: `\n[Process Error] ${err.message}\n`, stream: "stderr" });
                sendEvent("process:exit", { id: params.id, exitCode: 1 });
            });
            reply(id, { success: true });
            return true;
        }
        case "process:write": {
            engine.writeProcess(params.id, params.data);
            reply(id, { success: true });
            return true;
        }
        case "process:kill": {
            engine.killProcess(params.id, params.signal);
            reply(id, { success: true });
            return true;
        }
        case "process:exists": {
            const running = await engine.isProcessRunning(params.id);
            reply(id, { running });
            return true;
        }
        case "process:attach": {
            const success = await engine.attachProcess(
                params.id,
                (data) => sendEvent("process:data", { id: params.id, data, stream: "stdout" }),
                (stdout) => sendEvent("process:data", { id: params.id, data: stdout, stream: "stdout" }),
                (stderr) => sendEvent("process:data", { id: params.id, data: stderr, stream: "stderr" }),
                (exitCode) => sendEvent("process:exit", { id: params.id, exitCode }),
            );
            reply(id, { success });
            return true;
        }
        default:
            return false;
    }
}
