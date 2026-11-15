// Runs a daemon RPC: finds the action's handler, refuses a panel's scoped
// credential for a host action, reads the params against the action's
// shape (rpc/contract.ts) and answers with what the handler returns.
import type { RpcContext } from "./context";
import { isRpcAction, readParams, RPC, type RpcAction, type RpcParams, type RpcResult } from "./contract";
import { Refusal } from "./errors";
import { rpcErrorCode } from "./params";
import { requireHost } from "../principal";

export type RpcHandler<A extends RpcAction> = (params: RpcParams<A>, ctx: RpcContext, action: A) => Promise<RpcResult<A>> | RpcResult<A>;
export type RpcHandlers<A extends RpcAction> = { readonly [K in A]: RpcHandler<K> };

export interface RpcModule {
    readonly handlers: Partial<Record<RpcAction, RpcHandler<any>>>;
    /**
     * What a failure without a message answers. A module that names one
     * answers its failures as they are, typed by their code; one that
     * doesn't lets them reach the socket's catch, which answers
     * "Request failed: <why>".
     */
    readonly failure?: string;
}

export function rpcModule<A extends RpcAction>(handlers: RpcHandlers<A>, failure?: string): RpcModule {
    return { handlers, failure };
}

/** Answers an action one of the modules handles; false for any other. */
export function rpcDispatcher(modules: RpcModule[]) {
    const routes = new Map<RpcAction, { module: RpcModule; handler: RpcHandler<any> }>();
    for (const module of modules) {
        for (const [action, handler] of Object.entries(module.handlers)) {
            if (!isRpcAction(action) || !handler) throw new Error(`${action} is not a declared RPC action`);
            if (routes.has(action)) throw new Error(`${action} has two handlers`);
            routes.set(action, { module, handler });
        }
    }
    return async (action: unknown, id: unknown, params: unknown, ctx: RpcContext): Promise<boolean> => {
        const route = isRpcAction(action) ? routes.get(action) : undefined;
        if (!isRpcAction(action) || !route) return false;
        try {
            if ("host" in RPC[action]) requireHost(ctx.callerPanelId(), action);
            ctx.reply(id, await route.handler(readParams(action, params), ctx, action));
        } catch (err) {
            if (err instanceof Refusal) ctx.reply(id, null, err.message, err.code);
            else if (route.module.failure === undefined) throw err;
            else ctx.reply(id, null, (err instanceof Error && err.message) || route.module.failure, rpcErrorCode(err));
        }
        return true;
    };
}
