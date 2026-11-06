// Signing in is the harness's own login command, run as a child of the
// daemon. It prints what the user needs (a page to open, sometimes a code) on
// its output, and the panel shows exactly that. Nothing here keeps a token:
// the harness writes its own credentials, in its own folder.
//
// The wording of that output is the harness's, not an API, so it's read in
// one place, and a login whose page never shows up is a loud failure that
// carries what the harness did print.

import type { Harness, LoginPrompt } from "../contract";

/** Sign-in methods the UI can ask for: the browser (default) or, away from the computer's own screen, a code. */
export type LoginMethod = "browser" | "code";

export interface LoginCommand {
    args: string[];
    /** Claude Code's login reads the code its page shows, from its input */
    needsInput: boolean;
}

/** The command that signs a harness in; OpenCode signs in through its server (opencodeProviders.ts), not a command. */
export function loginCommand(harness: Exclude<Harness, "opencode">, method: LoginMethod): LoginCommand {
    if (harness === "codex") return { args: method === "code" ? ["login", "--device-auth"] : ["login"], needsInput: false };
    return { args: ["auth", "login", "--claudeai"], needsInput: true };
}

/** the commands that tell whether a harness is signed in, and that sign it out */
export const STATUS_COMMAND: Record<Exclude<Harness, "opencode">, string[]> = {
    codex: ["login", "status"],
    "claude-code": ["auth", "status"],
};
export const LOGOUT_COMMAND: Record<Exclude<Harness, "opencode">, string[]> = {
    codex: ["logout"],
    "claude-code": ["auth", "logout"],
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

/** The last few lines of a harness's output, for an error message. */
export function outputTail(text: string, lines = 4): string {
    return stripAnsi(text)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-lines)
        .join(" | ")
        .slice(-400);
}

const URL_RE = /https:\/\/[^\s"'<>)]+/;
// Codex's one-time code: groups of letters and digits around a dash ("RJEL-90J2I")
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A loopback http address with its own port, or null. */
function loopback(text: string): URL | null {
    const url = URL.parse(text);
    if (!url) return null;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && url.port !== "" ? url : null;
}

/** Where a sign-in page sends the browser back to, when that's a loopback address the harness listens on. */
export function loopbackCallback(page: string): string | null {
    const redirect = URL.parse(page)?.searchParams.get("redirect_uri");
    const url = redirect ? loopback(redirect) : null;
    return url ? `${url.origin}${url.pathname}` : null;
}

/**
 * The address a browser ended on, checked against the callback the harness
 * waits on: the same loopback port and path, carrying the page's answer. The
 * harness checks the answer itself (its state, its code); this only makes sure
 * the address goes nowhere else.
 */
export function callbackAddress(callback: string, address: unknown): URL {
    if (typeof address !== "string" || address.length > 8_000) throw new Error("That isn't the address your browser ended on.");
    const want = loopback(callback);
    if (!want) throw new Error("This sign-in doesn't come back to an address.");
    const got = loopback(address.trim());
    if (!got || got.port !== want.port || got.pathname !== want.pathname) {
        throw new Error(`That isn't the address your browser ended on. It starts with ${want.origin}${want.pathname}.`);
    }
    if (!got.search) throw new Error("That address has no sign-in answer in it. Copy the whole address from your browser.");
    return got;
}

/**
 * What the output so far asks of the user. Codex prints the page (and, with a device code, the code after
 * it); Claude Code prints the page it falls back to when a browser doesn't open, whose last step is a code
 * to paste back. Returns null until there's a page to show.
 */
export function readLoginOutput(harness: Exclude<Harness, "opencode">, method: LoginMethod, output: string): LoginPrompt | null {
    const text = stripAnsi(output);
    const url = URL_RE.exec(text)?.[0]?.replace(/[.,;]+$/, "") ?? null;
    if (!url) return null;
    const callback = loopbackCallback(url);
    if (harness === "claude-code") return { url, code: null, expectsCode: true, callback };
    if (method === "code") {
        // the code comes after the page; showing the page alone would send the user there with nothing to type
        const code = CODE_RE.exec(text.slice(text.indexOf(url) + url.length))?.[1] ?? null;
        return code ? { url, code, expectsCode: false, callback } : null;
    }
    return { url, code: null, expectsCode: false, callback };
}

/** What the status commands say: signed in or not, and as whom. A reply that's neither is an error, never "signed out". */
export function readStatus(harness: Exclude<Harness, "opencode">, out: { stdout: string; stderr: string; exitCode: number }): { signedIn: boolean; account: string | null } {
    if (harness === "claude-code") {
        let json: { loggedIn?: unknown; email?: unknown; authMethod?: unknown };
        try {
            json = JSON.parse(out.stdout);
        } catch {
            throw new Error(`Claude's sign-in status couldn't be read: ${outputTail(out.stderr || out.stdout) || `exit ${out.exitCode}`}`);
        }
        if (typeof json.loggedIn !== "boolean") throw new Error("Claude's sign-in status didn't say whether it's signed in");
        if (!json.loggedIn) return { signedIn: false, account: null };
        const account = typeof json.email === "string" && json.email ? json.email : typeof json.authMethod === "string" ? json.authMethod : null;
        return { signedIn: true, account };
    }
    // "Logged in using ChatGPT": the way it's signed in is the account
    const first = outputTail(out.stdout || out.stderr, 1).replace(/^logged in (?:using|with)\s+/i, "");
    if (out.exitCode === 0) return { signedIn: true, account: first || null };
    // "Not logged in" with exit 1 is the answer; any other failure is not
    if (/not logged in/i.test(out.stdout + out.stderr)) return { signedIn: false, account: null };
    throw new Error(`Codex's sign-in status couldn't be read: ${outputTail(out.stderr || out.stdout) || `exit ${out.exitCode}`}`);
}
