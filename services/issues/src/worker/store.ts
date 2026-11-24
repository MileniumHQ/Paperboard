// Every issue lives in one SQLite-backed Durable Object: a single writer, so
// the daily cap and the storage cap hold exactly across every Cloudflare
// location, and the dashboard reads what was written without a second store.
import { DurableObject } from "cloudflare:workers";
import { LIST_PAGE, type Issue, type IssueContext, type IssueSubmission, type IssueSummary } from "../shared";
import { DAILY_LIMIT, STORE_LIMIT } from "./limits";

const DAY = 86_400_000;

export type AddResult = { ok: true; issue: Issue } | { ok: false; reason: "daily_limit" | "store_full" };

interface Row extends Record<string, SqlStorageValue> {
    id: string;
    received_at: number;
    text: string;
    context: string;
    details: string;
}

interface SummaryRow extends Record<string, SqlStorageValue> {
    id: string;
    received_at: number;
    head: string;
    context: string;
    has_details: number;
}

// the list shows an issue by its first line, cut here so one long line stays small
const TITLE_LENGTH = 200;

const issueOf = (row: Row): Issue => ({
    id: row.id,
    receivedAt: row.received_at,
    text: row.text,
    context: JSON.parse(row.context) as IssueContext,
    details: row.details,
});

export class IssueStore extends DurableObject<unknown> {
    constructor(ctx: DurableObjectState, env: unknown) {
        super(ctx, env);
        ctx.storage.sql.exec(
            "CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL)",
        );
        ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS issues_received ON issues (received_at)");
        // issues kept before diagnostics existed have none
        const columns = ctx.storage.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('issues')").toArray();
        if (!columns.some((column) => column.name === "details")) {
            ctx.storage.sql.exec("ALTER TABLE issues ADD COLUMN details TEXT NOT NULL DEFAULT ''");
        }
    }

    // synchronous from the count to the insert, so two submissions can't both take the last slot
    add({ text, context, details }: IssueSubmission): AddResult {
        const sql = this.ctx.storage.sql;
        const now = Date.now();
        const recent = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM issues WHERE received_at > ?", now - DAY).one().n;
        if (recent >= DAILY_LIMIT) return { ok: false, reason: "daily_limit" };
        const kept = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM issues").one().n;
        if (kept >= STORE_LIMIT) return { ok: false, reason: "store_full" };
        const issue: Issue = { id: crypto.randomUUID(), receivedAt: now, text, context, details };
        sql.exec(
            "INSERT INTO issues (id, received_at, text, context, details) VALUES (?, ?, ?, ?, ?)",
            issue.id,
            now,
            text,
            JSON.stringify(context),
            details,
        );
        return { ok: true, issue };
    }

    /** newest first, one page of summaries older than `before`; the full text and diagnostics come from get() */
    list(before: number): { issues: IssueSummary[]; more: boolean } {
        const rows = this.ctx.storage.sql
            .exec<SummaryRow>(
                "SELECT id, received_at, substr(text, 1, ?) AS head, context, details != '' AS has_details FROM issues WHERE received_at < ? ORDER BY received_at DESC LIMIT ?",
                TITLE_LENGTH,
                before,
                LIST_PAGE + 1,
            )
            .toArray();
        return {
            issues: rows.slice(0, LIST_PAGE).map((row) => ({
                id: row.id,
                receivedAt: row.received_at,
                title: row.head.split("\n", 1)[0]!,
                context: JSON.parse(row.context) as IssueContext,
                hasDetails: row.has_details === 1,
            })),
            more: rows.length > LIST_PAGE,
        };
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
