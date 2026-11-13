// How one tool server is doing, in the user's words: for its row on the Tools
// page and for the sign-in card in the chat. Read from the service's view.

import { OAUTH_SECRET, type ServerSpec, type ServerStatus, type SignIn, type ToolsView } from "../toolsContract";

export type ServerState =
    | { kind: "off" }
    | { kind: "signing-in"; signIn: SignIn }
    | { kind: "needs-sign-in" }
    /** secrets its config names that the vault doesn't hold yet */
    | { kind: "needs-secrets"; names: string[] }
    | { kind: "starting" }
    | { kind: "running"; tools: number }
    | { kind: "failed"; error: string }
    /** on, and not started yet: it starts when the agent next needs its tools */
    | { kind: "waiting" };

export function stateOf(view: ToolsView, spec: ServerSpec): ServerState {
    if (!spec.enabled) return { kind: "off" };
    const signIn = view.signIns[spec.name];
    if (signIn) return { kind: "signing-in", signIn };
    const status: ServerStatus | undefined = view.status.find((s) => s.name === spec.name);
    const signedIn = (view.secrets[spec.name] ?? []).includes(OAUTH_SECRET);
    if (status?.needsSignIn || (spec.transport === "http" && spec.oauth && !signedIn)) return { kind: "needs-sign-in" };
    const values = Object.values(spec.transport === "stdio" ? spec.env : spec.headers);
    const missing = values.flatMap((v) => (typeof v !== "string" && !(view.secrets[spec.name] ?? []).includes(v.secret) ? [v.secret] : []));
    if (missing.length) return { kind: "needs-secrets", names: [...new Set(missing)] };
    switch (status?.phase) {
        case "starting":
            return { kind: "starting" };
        case "running":
            return { kind: "running", tools: status.tools };
        case "failed":
            return { kind: "failed", error: status.error ?? "It stopped." };
        default:
            return { kind: "waiting" };
    }
}

export function stateText(s: ServerState): string {
    switch (s.kind) {
        case "off":
            return "Off";
        case "signing-in":
            return s.signIn.error ? `Not signed in: ${s.signIn.error}` : "Signing in…";
        case "needs-sign-in":
            return "Needs you to sign in";
        case "needs-secrets":
            return `Needs ${s.names.length === 1 ? "its secret" : "its secrets"}: ${s.names.join(", ")}`;
        case "starting":
            return "Starting…";
        case "running":
            return `Running · ${s.tools === 1 ? "1 tool" : `${s.tools} tools`}`;
        case "failed":
            return `Failed: ${s.error}`;
        case "waiting":
            return "Starts when it's needed";
    }
}

/** where a server is: a web address's host, or the program it runs */
export function whereText(spec: ServerSpec): string {
    if (spec.transport === "stdio") return [spec.command, ...spec.args].join(" ");
    try {
        return new URL(spec.url).host;
    } catch (e) {
        console.warn("[agents] a tool server's address isn't a URL:", spec.url, e);
        return spec.url;
    }
}
