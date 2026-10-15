// The panel's own tools: shell commands and, in a project, file tools. They
// are offered ahead of other panels' actions and render as their own steps
// in the thread. A shell command asks every time and can never be allowed
// always; file changes ask unless the chat's mode accepts edits; reads
// never ask. `web_search` is no longer offered; it stays a recorded kind so
// chats that searched still render their steps.

import {
    isProjectTool,
    PROJECT_TOOL_DEFINITIONS,
    PROJECT_TOOL_LABELS,
    PROJECT_TOOLS,
    ProjectArgumentError,
    projectToolArguments,
    projectToolAsks,
} from "./projectTools";
import type { OllamaTool } from "./tools";
import type { BuiltinTool, OfferedBuiltin } from "./types";

export const BUILTIN_LABELS: Record<BuiltinTool, string> = {
    web_search: "Searched the web",
    run_shell_command: "Ran shell command",
    ...PROJECT_TOOL_LABELS,
};

/** Whether a built-in call waits for the user, in a chat's mode. None can be allowed always. */
export function builtinAsks(tool: OfferedBuiltin, mode: string | undefined): boolean {
    return isProjectTool(tool) ? projectToolAsks(tool, mode) : true;
}

export const MAX_COMMAND_CHARS = 4000;

const SHELL: OllamaTool = {
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
};

const PROJECT_SHELL: OllamaTool = {
    type: "function",
    function: {
        ...SHELL.function,
        description:
            "Run a shell command in the project folder and read its output. The user approves every command before it runs. Keep commands short, non-interactive, and quick to finish.",
    },
};

export function isBuiltinTool(name: string): name is OfferedBuiltin {
    return name === "run_shell_command" || isProjectTool(name);
}

/** Enabled built-ins, in priority order; file tools only for a chat working in a project. */
export function builtinTools(enabled: { shellCommands: boolean }, project = false): OllamaTool[] {
    const tools = project ? PROJECT_TOOLS.map((t) => PROJECT_TOOL_DEFINITIONS[t]) : [];
    if (enabled.shellCommands) tools.push(project ? PROJECT_SHELL : SHELL);
    return tools;
}

export class BuiltinArgumentError extends Error {}

/** A built-in's arguments, checked. */
export function builtinArguments(tool: OfferedBuiltin, raw: unknown): Record<string, unknown> {
    if (isProjectTool(tool)) {
        try {
            return projectToolArguments(tool, raw);
        } catch (err) {
            if (err instanceof ProjectArgumentError) throw new BuiltinArgumentError(err.message);
            throw err;
        }
    }
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
