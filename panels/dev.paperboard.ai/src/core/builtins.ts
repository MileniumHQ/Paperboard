// The panel's own tool: shell commands. It is offered ahead of other panels'
// actions, renders as its own step in the thread, and asks every time: it
// can never be allowed always. `web_search` is no longer offered; it stays a
// recorded kind so chats that searched still render their steps.

import type { OllamaTool } from "./tools";
import type { BuiltinTool, OfferedBuiltin } from "./types";

export const BUILTIN_LABELS: Record<BuiltinTool, string> = {
    web_search: "Searched the web",
    run_shell_command: "Ran shell command",
};

/** Whether a built-in call waits for the user, and whether it may be remembered. */
export const BUILTIN_APPROVAL: Record<OfferedBuiltin, { ask: boolean; remember: boolean }> = {
    run_shell_command: { ask: true, remember: false },
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
export function builtinArguments(_tool: OfferedBuiltin, raw: unknown): Record<string, string> {
    let args = raw;
    if (typeof args === "string") {
        try {
            args = JSON.parse(args);
        } catch {
            throw new BuiltinArgumentError("arguments must be a JSON object");
        }
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
