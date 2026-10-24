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
    enabled: boolean;
}

let keys = 0;
export const newRow = (o: Partial<Row> = {}): Row => ({ key: ++keys, name: "", kind: "value", value: "", typed: "", ...o });

export const blankForm = (): Form => ({ editing: false, name: "", transport: "stdio", command: "", args: "", url: "", rows: [], enabled: true });

/** the vault name the service keeps a row's secret under: the row's own name, made plain */
export const secretNameOf = (rowName: string) => rowName.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

export function formFromSpec(s: ServerSpec): Form {
    const values = s.transport === "stdio" ? s.env : s.headers;
    const rows = Object.entries(values).map(([name, v]) => (typeof v === "string" ? newRow({ name, value: v }) : newRow({ name, kind: "secret" })));
    return {
        editing: true,
        name: s.name,
        transport: s.transport,
        command: s.transport === "stdio" ? s.command : "",
        args: s.transport === "stdio" ? s.args.join("\n") : "",
        url: s.transport === "http" ? s.url : "",
        rows,
        enabled: s.enabled,
    };
}

export function specFromForm(f: Form): ServerSpec {
    const values: Record<string, ServerValue> = {};
    for (const r of f.rows) {
        const name = r.name.trim();
        if (!name) continue;
        values[name] = r.kind === "secret" ? { secret: secretNameOf(name) } : r.value;
    }
    if (f.transport === "http") return { name: f.name.trim(), where: "host", transport: "http", url: f.url.trim(), headers: values, enabled: f.enabled };
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
    return f.rows.filter((r) => r.kind === "secret" && r.name.trim() && r.typed).map((r) => ({ name: secretNameOf(r.name.trim()), value: r.typed }));
}
