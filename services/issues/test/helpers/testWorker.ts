// The worker under test, as workerd runs it, plus a test door into the
// store: seed many old issues at once, which the daily and storage caps
// need and the rate limit would refuse over HTTP. Bundled by worker.ts;
// never deployed.
import worker, { IssueStore as RealIssueStore, STORE_NAME, type Env } from "../../src/worker/index";

export class IssueStore extends RealIssueStore {
    seed(count: number, receivedAt: number): void {
        const context = JSON.stringify({ appVersion: "0.4.0", os: "Linux", osVersion: "6.12", arch: "x64", shell: "window" });
        for (let i = 0; i < count; i++) {
            this.ctx.storage.sql.exec(
                "INSERT INTO issues (id, received_at, text, context) VALUES (?, ?, ?, ?)",
                crypto.randomUUID(),
                receivedAt,
                `seeded ${i}`,
                context,
            );
        }
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === "/__test/seed") {
            const { count, receivedAt } = (await request.json()) as { count: number; receivedAt: number };
            const stub = env.ISSUES.get(env.ISSUES.idFromName(STORE_NAME)) as unknown as DurableObjectStub<IssueStore>;
            await stub.seed(count, receivedAt);
            return new Response("ok");
        }
        return worker.fetch(request, env);
    },
} satisfies ExportedHandler<Env>;
