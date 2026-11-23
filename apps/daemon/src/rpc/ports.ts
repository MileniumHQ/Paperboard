import type { PaperCraneEngine } from "../engine/index";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../security/principal";
import { PortRegistry } from "../system/ports";

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

const claimsOf = (panelId: string, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), panelId)!;
const ports = (ctx: RpcContext) => portRegistryFor(ctx.engine);

// The policy and the list of every claim are host-only (PaperAPI's protocol/rpc.ts).
// A failure's message is the user's answer ("port 25565: Game Server has it"), unprefixed.
export const portsRpc = rpcModule({
    "ports:claim": (params, ctx) => ports(ctx).claim(claimsOf(params.panelId, ctx), params),
    "ports:prepare": ({ panelId, name }, ctx) => ports(ctx).prepare(claimsOf(panelId, ctx), name),
    "ports:release": async ({ panelId, name }, ctx) => {
        await ports(ctx).release(claimsOf(panelId, ctx), name);
        return { success: true };
    },
    "ports:list": ({ panelId }, ctx) => ({ claims: ports(ctx).list(claimsOf(panelId, ctx)) }),
    "ports:all": (_, ctx) => ({ claims: ports(ctx).all(), policy: ports(ctx).policy() }),
    "ports:policy-set": async ({ policy }, ctx) => ({ policy: await ports(ctx).setPolicy(policy) }),
}, "Port operation failed");
