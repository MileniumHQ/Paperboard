// Every issue lives in one SQLite-backed Durable Object: a single writer, so
// the daily cap and the storage cap hold exactly across every Cloudflare
// location, and the dashboard reads what was written without a second store.
import { DurableObject } from "cloudflare:workers";
import type { Issue, IssueContext } from "../shared";
import { DAILY_LIMIT, STORE_LIMIT } from "./limits";

const DAY = 86_400_000;

export type AddResult = { ok: true; issue: Issue } | { ok: false; reason: "daily_limit" | "store_full" };

interface Row extends Record<string, SqlStorageValue> {
    id: string;
    received_at: number;
    text: string;
    context: string;
}

const issueOf = (row: Row): Issue => ({ id: row.id, receivedAt: row.received_at, text: row.text, context: JSON.parse(row.context) as IssueContext });

export class IssueStore extends DurableObject<unknown> {
    constructor(ctx: DurableObjectState, env: unknown) {
        super(ctx, env);
        ctx.storage.sql.exec(
            "CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL)",
        );
        ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS issues_received ON issues (received_at)");
    }

    // synchronous from the count to the insert, so two submissions can't both take the last slot
    add(text: string, context: IssueContext): AddResult {
        const sql = this.ctx.storage.sql;
        const now = Date.now();
        const recent = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM issues WHERE received_at > ?", now - DAY).one().n;
        if (recent >= DAILY_LIMIT) return { ok: false, reason: "daily_limit" };
        const kept = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM issues").one().n;
        if (kept >= STORE_LIMIT) return { ok: false, reason: "store_full" };
        const issue: Issue = { id: crypto.randomUUID(), receivedAt: now, text, context };
        sql.exec("INSERT INTO issues (id, received_at, text, context) VALUES (?, ?, ?, ?)", issue.id, now, text, JSON.stringify(context));
        return { ok: true, issue };
    }

    /** newest first */
    list(): Issue[] {
        return this.ctx.storage.sql.exec<Row>("SELECT * FROM issues ORDER BY received_at DESC").toArray().map(issueOf);
    }

    get(id: string): Issue | null {
        const [row] = this.ctx.storage.sql.exec<Row>("SELECT * FROM issues WHERE id = ?", id).toArray();
        return row ? issueOf(row) : null;
    }

    /** false when there was no such issue */
    remove(id: string): boolean {
        return this.ctx.storage.sql.exec("DELETE FROM issues WHERE id = ?", id).rowsWritten > 0;
    }
}
