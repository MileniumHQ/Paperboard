import type { RpcContext } from "./context";
import { claimClient, checkClientOwnership, checkSpawnEnv } from "./ownership";
import { assertStr, assertOptStr, assertNum, assertEnvMap } from "./params";
import { offeredShells } from "../shellIntegration";
import type { TerminalStreams } from "../engine";

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
                {
                    cols,
                    rows,
                    cwd: assertOptStr(params?.cwd, "cwd", 1024),
                    env,
                    shell: assertOptStr(params?.shell, "shell", 1024),
                },
                terminalEvents(termId, sendEvent),
                ctx.ws,
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
            const success = await engine.attachTerminal(termId, ctx.ws, terminalEvents(termId, sendEvent));
            // what was said before this socket listened
            const known = engine.terminalState(termId);
            if (known.foreground) sendEvent("term:foreground", { id: termId, name: known.foreground });
            if (known.cwd) sendEvent("term:cwd", { id: termId, cwd: known.cwd });
            reply(id, { success });
            return true;
        }
        case "term:shells": {
            reply(id, { shells: offeredShells() });
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
