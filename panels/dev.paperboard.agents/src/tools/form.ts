// The server editor's form, and its conversion to and from a ServerSpec.
// The form never holds a saved secret's value, only what was just typed.

import type { ServerSpec, ServerValue } from "../toolsContract";

export interface Row {
    /** stable for the list's rendering */
    key: number;
    name: string;
    kind: "value" | "secret";
    value: string;
    /** a secret's value, typed now; empty keeps the saved one */
    typed: string;
    /** the vault name of the secret the server already had here: kept, so a row renamed still finds its value */
    secret?: string;
}

export interface Form {
    editing: boolean;
    name: string;
    transport: "stdio" | "http";
    command: string;
    /** one argument per line */
    args: string;
    url: string;
    rows: Row[];
    /** kept as the server had them; the editor doesn't change how it signs in or streams */
    oauth: boolean;
    sse: boolean;
    enabled: boolean;
}

let keys = 0;
export const newRow = (o: Partial<Row> = {}): Row => ({ key: ++keys, name: "", kind: "value", value: "", typed: "", ...o });

export const blankForm = (): Form => ({ editing: false, name: "", transport: "stdio", command: "", args: "", url: "", rows: [], oauth: false, sse: false, enabled: true });

/** the vault name a new secret row is saved under: the row's own name, made plain (the service checks it, mcpConfig.ts) */
const secretNameOf = (rowName: string) => rowName.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/** the vault name a secret row keeps its value under: the one it had, or a new row's from its name */
export const secretOf = (r: Row) => r.secret ?? secretNameOf(r.name.trim());

export function formFromSpec(s: ServerSpec): Form {
    const values = s.transport === "stdio" ? s.env : s.headers;
    const rows = Object.entries(values).map(([name, v]) => (typeof v === "string" ? newRow({ name, value: v }) : newRow({ name, kind: "secret", secret: v.secret })));
    return {
        editing: true,
        name: s.name,
        transport: s.transport,
        command: s.transport === "stdio" ? s.command : "",
        args: s.transport === "stdio" ? s.args.join("\n") : "",
        url: s.transport === "http" ? s.url : "",
        rows,
        oauth: s.transport === "http" && s.oauth,
        sse: s.transport === "http" && s.sse,
        enabled: s.enabled,
    };
}

export function specFromForm(f: Form): ServerSpec {
    const values: Record<string, ServerValue> = {};
    const named = f.rows.filter((r) => r.name.trim());
    for (const r of named) {
        const name = r.name.trim();
        if (r.kind !== "secret") {
            values[name] = r.value;
            continue;
        }
        // two rows sharing one vault entry would save one's value over the other's
        const other = r.secret === undefined && named.find((o) => o !== r && o.kind === "secret" && secretOf(o) === secretOf(r));
        if (other) throw new Error(`${name} and ${other.name.trim()} would keep their secrets under one name; rename one.`);
        values[name] = { secret: secretOf(r) };
    }
    if (f.transport === "http") return { name: f.name.trim(), where: "host", transport: "http", url: f.url.trim(), headers: values, oauth: f.oauth, sse: f.sse, enabled: f.enabled };
    return {
        name: f.name.trim(),
        where: "host",
        transport: "stdio",
        command: f.command.trim(),
        // an argument per line; a blank line is not an argument
        args: f.args.split("\n").map((a) => a.replace(/\r$/, "")).filter((a) => a !== ""),
        env: values,
        enabled: f.enabled,
    };
}

/** secrets whose values were typed in this form, to send to the vault after the server is saved */
export function typedSecrets(f: Form): { name: string; value: string }[] {
    return f.rows.filter((r) => r.kind === "secret" && r.name.trim() && r.typed).map((r) => ({ name: secretOf(r), value: r.typed }));
}
