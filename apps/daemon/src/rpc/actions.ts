import { actionsRegistry } from "../actions";
import { rpcModule, type RpcHandler } from "./dispatch";
import { InvalidParamsError } from "@mileniumhq/paperapi/protocol";
import { answeredAs, ownNamespace, ownedElsewhere } from "./blocks";

// The Actions registry (Blocks' predecessor). Malformed calls are refused
// by their shapes (PaperAPI's protocol/rpc.ts); registry conflicts answer CONFLICT,
// and registry call failures answer as they are.
const register: RpcHandler<"actions:register" | "action:register"> = ({ panelId, action: act, actions: acts, schema }, ctx, action) => {
    const owner = ownNamespace(panelId, action, ctx);
    if (acts) {
        ownedElsewhere(
            actionsRegistry.registerMultiple(owner, acts, ctx.ws),
            `Registry namespace is owned by another socket: action registration for panel "${owner}" conflicts`,
        );
    } else if (act) {
        ownedElsewhere(
            actionsRegistry.register(owner, act, ctx.ws, schema),
            `Registry namespace is owned by another socket: action "${act}" for panel "${owner}" conflicts`,
        );
    } else {
        // a registration naming nothing must not answer success:
        // success means registered, and nothing was
        throw new InvalidParamsError('actions:register requires "action" or "actions"');
    }
    ctx.broadcastEvent("actions:registry-updated", { type: "action:registered", panelId: owner, action: act, actions: acts });
    return { success: true };
};

const unregister: RpcHandler<"actions:unregister" | "action:unregister"> = ({ panelId, action: act }, ctx, action) => {
    const owner = ownNamespace(panelId, action, ctx);
    ownedElsewhere(
        actionsRegistry.unregister(owner, act, ctx.ws),
        `Registry namespace is owned by another socket: cannot unregister action "${act}" for panel "${owner}"`,
    );
    ctx.broadcastEvent("actions:registry-updated", { type: "action:unregistered", panelId: owner, action: act });
    return { success: true };
};

const call: RpcHandler<"actions:call" | "action:call"> = ({ panelId, action: act, args, timeoutMs }, ctx) =>
    answeredAs(() => actionsRegistry.call(panelId, act, Array.isArray(args) ? args : [], ctx.ws, timeoutMs === undefined ? 30_000 : timeoutMs, ctx.callerPanelId()));

const list: RpcHandler<"actions:list" | "action:list"> = ({ panelId }) => ({ actions: actionsRegistry.list(panelId) });

const emit: RpcHandler<"actions:emit" | "action:emit" | "event:emit"> = ({ panelId, event, payload }, ctx, action) => {
    ctx.broadcastEvent(`actions:${ownNamespace(panelId, action, ctx)}:${event}`, payload);
    return { success: true };
};

const trigger: RpcHandler<"triggers:emit" | "trigger:emit"> = ({ panelId, trigger: name, output }, ctx, action) => {
    ctx.broadcastEvent(`triggers:${ownNamespace(panelId, action, ctx)}:${name}`, output);
    return { success: true };
};

export const actionsRpc = rpcModule({
    "actions:register": register,
    "action:register": register,
    "actions:unregister": unregister,
    "action:unregister": unregister,
    "actions:project-define": ({ panelId, project, name, icon }, ctx, action) => {
        const owner = ownNamespace(panelId, action, ctx);
        ownedElsewhere(actionsRegistry.defineProject(owner, { id: project, name, icon }, ctx.ws), `Project "${project}" for panel "${owner}" is owned by another socket`);
        ctx.broadcastEvent("actions:registry-updated", { type: "project:defined", panelId: owner, project });
        return { success: true };
    },
    "actions:project-remove": ({ panelId, project }, ctx, action) => {
        const owner = ownNamespace(panelId, action, ctx);
        ownedElsewhere(actionsRegistry.removeProject(owner, project, ctx.ws), `Project "${project}" for panel "${owner}" is owned by another socket`);
        ctx.broadcastEvent("actions:registry-updated", { type: "project:removed", panelId: owner, project });
        return { success: true };
    },
    "actions:projects": ({ panelId }) => ({ projects: actionsRegistry.listProjects(panelId) }),
    "actions:call": call,
    "action:call": call,
    "actions:list": list,
    "action:list": list,
    "actions:emit": emit,
    "action:emit": emit,
    "event:emit": emit,
    "triggers:emit": trigger,
    "trigger:emit": trigger,
});
