// The roster, for this computer's own app (owner-only in PaperAPI's
// protocol/rpc.ts): every answer is the whole roster as it stands after the
// change, so the app never has to ask again to see what it did.
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";

// a member named by its id or by an id an older Paperboard gave it
function memberOf(id: string, ctx: RpcContext): string {
    const member = ctx.roster.resolve(id);
    if (!member) throw new Error("Paperboard doesn't know this computer anymore.");
    return member;
}

export const computersRpc = rpcModule({
    "computers:list": (_params, ctx) => ctx.roster.view(),
    "computers:pair": async ({ cert, pairToken, name, dial, facts }, ctx) => {
        const id = await ctx.roster.pair({ cert, token: pairToken, name, dial, facts });
        return { ...ctx.roster.view(), id };
    },
    "computers:update": async ({ id, name, dial, facts }, ctx) => {
        await ctx.roster.update(memberOf(id, ctx), { name, dial, facts });
        return ctx.roster.view();
    },
    "computers:reorder": async ({ ids }, ctx) => {
        await ctx.roster.reorder(ids.map((id) => memberOf(id, ctx)));
        return ctx.roster.view();
    },
    "computers:remove": async ({ id }, ctx) => {
        await ctx.roster.remove(memberOf(id, ctx));
        return ctx.roster.view();
    },
}, "The computer list couldn't be changed");
