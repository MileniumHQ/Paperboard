import type { RpcContext } from "./context";
import { claimClient, checkClientOwnership, checkSpawnEnv } from "./ownership";
import { assertStr, assertOptStr, assertNum, assertEnvMap } from "./params";

export async function handleTerminal(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "term:create": {
            const termId = assertStr(params?.id, "id", 128);
            const cols = assertNum(params?.cols, "cols", 80);
            const rows = assertNum(params?.rows, "rows", 24);
            const env = assertEnvMap(params?.env, "env");
            checkSpawnEnv(env, ctx, "term:create");
            await claimClient(termId, ctx, "term:create", () => engine.createTerminal(
                termId,
                cols,
                rows,
                assertOptStr(params?.cwd, "cwd", 1024),
                env,
                (data) => sendEvent("term:data", { id: termId, data }),
                (exitCode) => sendEvent("term:exit", { id: termId, exitCode }),
            ));
            reply(id, { success: true });
            return true;
        }
        case "term:write": {
            const termId = assertStr(params?.id, "id", 128);
            checkClientOwnership(termId, ctx, "term:write");
            engine.writeTerminal(termId, assertStr(params?.data, "data", 65536, true));
            reply(id, { success: true });
            return true;
        }
        case "term:resize": {
            const termId = assertStr(params?.id, "id", 128);
            checkClientOwnership(termId, ctx, "term:resize");
            engine.resizeTerminal(termId, assertNum(params?.cols, "cols"), assertNum(params?.rows, "rows"));
            reply(id, { success: true });
            return true;
        }
        case "term:attach": {
            const termId = assertStr(params?.id, "id", 128);
            checkClientOwnership(termId, ctx, "term:attach");
            const success = await engine.attachTerminal(
                termId,
                (data) => sendEvent("term:data", { id: termId, data }),
                (exitCode) => sendEvent("term:exit", { id: termId, exitCode }),
            );
            reply(id, { success });
            return true;
        }
        case "term:exists": {
            const termId = assertStr(params?.id, "id", 128);
            checkClientOwnership(termId, ctx, "term:exists");
            const running = await engine.isTerminalRunning(termId);
            reply(id, { running });
            return true;
        }
        case "term:destroy": {
            const termId = assertStr(params?.id, "id", 128);
            checkClientOwnership(termId, ctx, "term:destroy");
            await engine.destroyTerminal(termId);
            reply(id, { success: true });
            return true;
        }
        default:
            return false;
    }
}
