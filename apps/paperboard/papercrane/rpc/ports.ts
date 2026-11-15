import type { PaperCraneEngine } from "../engine";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../principal";
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
const claimsOf = (panelId: string, action: string, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), panelId, action)!;
const ports = (ctx: RpcContext) => portRegistryFor(ctx.engine);

// Claims are panel-scoped. The policy and the list of every claim are the
// user's, shown in the shell: those need host authority (rpc/contract.ts).
// A failure's message is the user's answer ("port 25565: Game Server has it"), unprefixed.
export const portsRpc = rpcModule({
    "ports:claim": (params, ctx, action) => ports(ctx).claim(claimsOf(params.panelId, action, ctx), params),
    "ports:prepare": ({ panelId, name }, ctx, action) => ports(ctx).prepare(claimsOf(panelId, action, ctx), name),
    "ports:release": async ({ panelId, name }, ctx, action) => {
        await ports(ctx).release(claimsOf(panelId, action, ctx), name);
        return { success: true };
    },
    "ports:list": ({ panelId }, ctx, action) => ({ claims: ports(ctx).list(claimsOf(panelId, action, ctx)) }),
    "ports:all": (_, ctx) => ({ claims: ports(ctx).all(), policy: ports(ctx).policy() }),
    "ports:policy-set": async ({ policy }, ctx) => ({ policy: await ports(ctx).setPolicy(policy) }),
}, "Port operation failed");
