// The panel's own tools: shell commands, which ask every time and can never
// be allowed always, and the app-action search, which only reads action
// descriptions and runs without asking. Each renders as its own step. `web_search` is no longer offered; it stays a
// recorded kind so chats that searched still render their steps.

import { APP_ACTION_TOOLS, FIND_APP_ACTIONS, MAX_ACTION_QUERY_CHARS } from "./appActions";
import type { OllamaTool } from "./tools";
import type { BuiltinTool, OfferedBuiltin } from "./types";

export const BUILTIN_LABELS: Record<BuiltinTool, string> = {
    web_search: "Searched the web",
    run_shell_command: "Ran shell command",
    find_app_actions: "Looked up app actions",
};

/** Whether a built-in call waits for the user, and whether it may be remembered. */
export const BUILTIN_APPROVAL: Record<OfferedBuiltin, { ask: boolean; remember: boolean }> = {
    run_shell_command: { ask: true, remember: false },
    find_app_actions: { ask: false, remember: false },
};

export const MAX_COMMAND_CHARS = 4000;

const DEFINITIONS: Record<OfferedBuiltin, OllamaTool> = {
    run_shell_command: {
        type: "function",
        function: {
            name: "run_shell_command",
            description:
                "Run a shell command on the user's computer and read its output. The user approves every command before it runs. Keep commands short, non-interactive, and quick to finish.",
            parameters: {
                type: "object",
                properties: { command: { type: "string", description: "The exact command line to run" } },
                required: ["command"],
            },
        },
    },
    find_app_actions: APP_ACTION_TOOLS[0]!,
};

export function isBuiltinTool(name: string): name is OfferedBuiltin {
    return Object.hasOwn(DEFINITIONS, name);
}

/** Enabled built-ins, in priority order. */
export function builtinTools(enabled: { shellCommands: boolean }): OllamaTool[] {
    return enabled.shellCommands ? [DEFINITIONS.run_shell_command] : [];
}

export class BuiltinArgumentError extends Error {}

/** The single string argument a built-in takes, checked. */
export function builtinArguments(tool: OfferedBuiltin, raw: unknown): Record<string, string> {
    let args = raw;
    if (typeof args === "string") {
        try {
            args = JSON.parse(args);
        } catch {
            throw new BuiltinArgumentError("arguments must be a JSON object");
        }
    }
    if (tool === FIND_APP_ACTIONS) {
        // an empty query is allowed: it lists actions in id order
        const query = args && typeof args === "object" ? (args as Record<string, unknown>).query : undefined;
        if (typeof query !== "string") throw new BuiltinArgumentError('missing required argument "query"');
        if (query.length > MAX_ACTION_QUERY_CHARS) throw new BuiltinArgumentError(`"query" is limited to ${MAX_ACTION_QUERY_CHARS} characters`);
        return { query: query.trim() };
    }
    const value = args && typeof args === "object" ? (args as Record<string, unknown>).command : undefined;
    if (typeof value !== "string" || !value.trim()) throw new BuiltinArgumentError('missing required argument "command"');
    if (value.length > MAX_COMMAND_CHARS) throw new BuiltinArgumentError(`"command" is limited to ${MAX_COMMAND_CHARS} characters`);
    return { command: value.trim() };
}

// ─── shell ──────────────────────────────────────────────────────────────────

export const SHELL_TIMEOUT_MS = 60_000;
export const SHELL_OUTPUT_CAP_BYTES = 64 * 1024;

export function shellArgv(command: string, platform: string): { command: string; args: string[] } {
    return platform === "win32"
        ? { command: "cmd.exe", args: ["/d", "/s", "/c", command] }
        : { command: "/bin/sh", args: ["-c", command] };
}

export function formatShellResult(res: { stdout: string; stderr: string; exitCode: number }): string {
    const parts = [`Exit code: ${res.exitCode}`];
    if (res.stdout) parts.push(`stdout:\n${res.stdout}`);
    if (res.stderr) parts.push(`stderr:\n${res.stderr}`);
    if (!res.stdout && !res.stderr) parts.push("(no output)");
    return parts.join("\n");
}
