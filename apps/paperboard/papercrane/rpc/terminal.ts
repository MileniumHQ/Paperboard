import type { RpcContext } from "./context";

export async function handleTerminal(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "term:create": {
            await engine.createTerminal(
                params.id,
                params.cols,
                params.rows,
                params.cwd,
                params.env,
                (data) => sendEvent("term:data", { id: params.id, data }),
                (exitCode) => sendEvent("term:exit", { id: params.id, exitCode }),
            );
            reply(id, { success: true });
            return true;
        }
        case "term:write": {
            engine.writeTerminal(params.id, params.data);
            reply(id, { success: true });
            return true;
        }
        case "term:resize": {
            engine.resizeTerminal(params.id, params.cols, params.rows);
            reply(id, { success: true });
            return true;
        }
        case "term:attach": {
            const success = await engine.attachTerminal(
                params.id,
                (data) => sendEvent("term:data", { id: params.id, data }),
                (exitCode) => sendEvent("term:exit", { id: params.id, exitCode }),
            );
            reply(id, { success });
            return true;
        }
        case "term:exists": {
            const running = await engine.isTerminalRunning(params.id);
            reply(id, { running });
            return true;
        }
        case "term:destroy": {
            engine.destroyTerminal(params.id);
            reply(id, { success: true });
            return true;
        }
        default:
            return false;
    }
}
