import type { PaperCraneEngine } from "../engine";
import type { RpcContext } from "./context";
import { assertPanelId, rpcErrorCode } from "./params";
import { requireHost, resourcePanelId } from "../principal";
import { PortRegistry } from "../ports";

// one registry per engine, living as long as the engine; a panel's claims
// go when its data does
const registries = new WeakMap<PaperCraneEngine, PortRegistry>();

export function portRegistryFor(engine: PaperCraneEngine): PortRegistry {
    let registry = registries.get(engine);
    if (!registry) {
        const created = new PortRegistry(engine.getAppDataDir());
        engine.onPanelDataDeleted((panelId) => created.forgetPanel(panelId));
        registries.set(engine, created);
        registry = created;
    }
    return registry;
}

// a panel reaches only its own claims: the token claim names the panel
function panelFor(params: any, action: string, ctx: RpcContext): string {
    return resourcePanelId(ctx.callerPanelId(), assertPanelId(params?.panelId), action)!;
}

// Claims are panel-scoped. The policy and the list of every claim are the
// user's, shown in the shell: those need host authority.
export async function handlePorts(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    if (!action.startsWith("ports:")) return false;
    const { engine, reply } = ctx;
    const ports = portRegistryFor(engine);
    try {
        return await dispatch(action, id, params, ctx, ports);
    } catch (err: any) {
        // the message is the user's answer ("port 25565: Game Server has it"), unprefixed
        reply(id, null, err?.message || "Port operation failed", rpcErrorCode(err));
        return true;
    }
}

async function dispatch(action: string, id: unknown, params: any, ctx: RpcContext, ports: PortRegistry): Promise<boolean> {
    const { reply } = ctx;
    switch (action) {
        case "ports:claim":
            reply(id, await ports.claim(panelFor(params, action, ctx), params ?? {}));
            return true;
        case "ports:prepare":
            reply(id, await ports.prepare(panelFor(params, action, ctx), params?.name));
            return true;
        case "ports:release":
            await ports.release(panelFor(params, action, ctx), params?.name);
            reply(id, { success: true });
            return true;
        case "ports:list":
            reply(id, { claims: ports.list(panelFor(params, action, ctx)) });
            return true;
        case "ports:all":
            requireHost(ctx.callerPanelId(), action);
            reply(id, { claims: ports.all(), policy: ports.policy() });
            return true;
        case "ports:policy-set":
            requireHost(ctx.callerPanelId(), action);
            reply(id, { policy: await ports.setPolicy(params?.policy) });
            return true;
        default:
            return false;
    }
}
