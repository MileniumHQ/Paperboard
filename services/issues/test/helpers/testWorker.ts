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
                "INSERT INTO issues (id, received_at, text, context, details) VALUES (?, ?, ?, ?, '')",
                crypto.randomUUID(),
                receivedAt,
                `seeded ${i}`,
                context,
            );
        }
    }

    /** Puts the store back to the first release's table, which had no details, with one issue in it. */
    legacy(): void {
        const sql = this.ctx.storage.sql;
        sql.exec("DROP TABLE issues");
        sql.exec("CREATE TABLE issues (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL)");
        sql.exec(
            "INSERT INTO issues (id, received_at, text, context) VALUES (?, ?, ?, ?)",
            "00000000-0000-4000-8000-000000000001",
            1_795_000_000_000,
            "kept from the first release",
            JSON.stringify({ appVersion: "0.4.0", os: "Linux", osVersion: "6.12", arch: "x64", shell: "window" }),
        );
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === "/__test/legacy") {
            const stub = env.ISSUES.get(env.ISSUES.idFromName(STORE_NAME)) as unknown as DurableObjectStub<IssueStore>;
            await stub.legacy();
            return new Response("ok");
        }
        if (url.pathname === "/__test/seed") {
            const { count, receivedAt } = (await request.json()) as { count: number; receivedAt: number };
            const stub = env.ISSUES.get(env.ISSUES.idFromName(STORE_NAME)) as unknown as DurableObjectStub<IssueStore>;
            await stub.seed(count, receivedAt);
            return new Response("ok");
        }
        return worker.fetch(request, env);
    },
} satisfies ExportedHandler<Env>;
