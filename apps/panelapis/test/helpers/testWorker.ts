// The worker under test, as workerd runs it, plus a test door into the
// budget Durable Object. Bundled by worker.ts; never deployed.
//
// SteamBudget here is the real class with three test operations in front
// of it: set the clock the budget reads, seed its stored hours, and read
// them back. Every other request goes to the real class unchanged, and the
// default export routes every other path to the real worker.
import worker, { SteamBudget as RealSteamBudget, type Env } from "../../src/index";

const realNow = Date.now;

export class SteamBudget extends RealSteamBudget {
    readonly #state: DurableObjectState;

    constructor(state: DurableObjectState) {
        super(state);
        this.#state = state;
    }

    override async fetch(request: Request): Promise<Response> {
        const { pathname } = new URL(request.url);
        if (pathname === "/__test/clock") {
            const at = Number(await request.text());
            if (!Number.isSafeInteger(at)) return new Response("clock must be an integer", { status: 400 });
            Date.now = () => at;
            return new Response("ok");
        }
        if (pathname === "/__test/real-clock") {
            Date.now = realNow;
            return new Response("ok");
        }
        if (pathname === "/__test/seed") {
            await this.#state.storage.put("hours", await request.json());
            return new Response("ok");
        }
        if (pathname === "/__test/hours") {
            return Response.json((await this.#state.storage.get("hours")) ?? null);
        }
        return super.fetch(request);
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        // /__test/budget/<op> reaches the one budget instance the worker uses:
        // "reserve" is the real operation, the others are this file's test door
        if (url.pathname.startsWith("/__test/budget/")) {
            const stub = env.BUDGET.get(env.BUDGET.idFromName("steam-key-budget-v1"));
            const op = url.pathname.slice("/__test/budget/".length);
            const target = op === "reserve" ? "/reserve" : `/__test/${op}`;
            return stub.fetch(`https://budget${target}`, { method: request.method, body: await request.text() });
        }
        return worker.fetch(request, env, ctx);
    },
} satisfies ExportedHandler<Env>;
