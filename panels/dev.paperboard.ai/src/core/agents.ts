// Coding agents the panel can talk to: over ACP (agentclientprotocol.com),
// or Claude Code through its built-in bridge.
// The panel never downloads agent code: an agent is something the user
// installed, found on PATH (or at an absolute path for a custom one). The
// shipped snapshot of the ACP registry (src/data/acp-agents.json, refreshed
// by scripts/snapshot-acp-registry.ts) names each agent's command and how to
// install it.

import snapshot from "../data/acp-agents.json";
import { CLAUDE_CODE_ID } from "./claudeCode";
import type { Connection } from "./providers";
import type { AgentCommand } from "./types";

export interface RegistryAgent {
    id: string;
    name: string;
    description: string;
    website?: string;
    /** the executable an install puts on PATH */
    command: string;
    args: string[];
    install: { kind: "npm"; package: string } | { kind: "download"; url: string };
}

/**
 * Claude Code is bridged, not reached through ACP (service/claudeCode.ts):
 * the panel drives the installed `claude` itself. It takes the place of the
 * registry's Claude adapter, which ships a separate SDK.
 */
const CLAUDE_CODE: RegistryAgent = {
    id: CLAUDE_CODE_ID,
    name: "Claude Code",
    description: "Anthropic's coding agent",
    command: "claude",
    args: [],
    install: { kind: "npm", package: "@anthropic-ai/claude-code" },
};
const REPLACED_BY_BUILT_INS = new Set(["claude-acp"]);

export const AGENT_REGISTRY: readonly RegistryAgent[] = [CLAUDE_CODE, ...(snapshot.agents as RegistryAgent[]).filter((a) => !REPLACED_BY_BUILT_INS.has(a.id))];
export const AGENT_REGISTRY_DATE: string = snapshot.capturedAt;

/** A connection running a command the user typed rather than a registry agent. */
export const CUSTOM_AGENT_ID = "custom";
export const MAX_AGENT_ARGS = 32;
export const MAX_AGENT_ARG_CHARS = 1024;
export const MAX_AGENT_COMMAND_CHARS = 1024;

export function registryAgent(id: string | undefined): RegistryAgent | undefined {
    return AGENT_REGISTRY.find((a) => a.id === id);
}

/** The command line that installs a registry agent, or where to get it. */
export function installHint(agent: RegistryAgent): { command?: string; url?: string } {
    if (agent.install.kind === "npm") return { command: `npm install -g ${agent.install.package}` };
    return { url: agent.install.url };
}

/** What an agent connection runs: its command (a PATH name or absolute path) and arguments. */
export function agentLaunch(connection: Connection): { command: string; args: string[] } {
    if (connection.agent === CUSTOM_AGENT_ID) return { command: connection.command ?? "", args: connection.args ?? [] };
    const agent = registryAgent(connection.agent);
    if (!agent) throw new Error(`${connection.label} is no longer in the agent list. Remove it and add it again.`);
    return { command: agent.command, args: agent.args };
}

/**
 * The single "model" an agent connection lists: the agent itself. A chat
 * names it so the picker, the chat list and the composer read the same.
 */
export function agentModelName(connection: Connection): string {
    return connection.label;
}

/** POSIX, drive-letter and UNC absolute paths */
function isAbsoluteCommand(command: string): boolean {
    return command.startsWith("/") || /^[A-Za-z]:[\\/]/.test(command) || command.startsWith("\\\\");
}

/**
 * A command is a name searched on PATH or an absolute path, never a path
 * relative to wherever the daemon happens to run. Throws otherwise.
 */
export function checkCommandShape(command: string): "name" | "absolute" {
    if (isAbsoluteCommand(command)) return "absolute";
    if (/[\\/]/.test(command)) throw new Error(`"${command}" must be a command name or an absolute path.`);
    return "name";
}

/**
 * A custom agent's command and arguments, checked where they are saved.
 * Arguments are argv entries, never a shell string, so nothing is split
 * or unquoted.
 */
export function validateCustomAgent(command: unknown, args: unknown): { command: string; args: string[] } {
    if (typeof command !== "string" || !command.trim()) throw new Error("A command is required.");
    const cmd = command.trim();
    if (cmd.length > MAX_AGENT_COMMAND_CHARS) throw new Error(`The command is limited to ${MAX_AGENT_COMMAND_CHARS} characters.`);
    if (/[\0\n\r]/.test(cmd)) throw new Error("The command cannot contain line breaks.");
    checkCommandShape(cmd);
    const list = args === undefined ? [] : args;
    if (!Array.isArray(list) || list.some((a) => typeof a !== "string")) throw new Error("Arguments must be a list of strings.");
    if (list.length > MAX_AGENT_ARGS) throw new Error(`At most ${MAX_AGENT_ARGS} arguments.`);
    const clean = (list as string[]).map((a) => a.trim()).filter((a) => a !== "");
    for (const a of clean) {
        if (a.length > MAX_AGENT_ARG_CHARS) throw new Error(`Each argument is limited to ${MAX_AGENT_ARG_CHARS} characters.`);
        if (/[\0\n\r]/.test(a)) throw new Error("An argument cannot contain line breaks.");
    }
    return { command: cmd, args: clean };
}

export const MAX_SUGGESTIONS = 8;

/** The commands matching a message that is only "/" and a partial name. */
export function commandSuggestions(text: string, commands: readonly AgentCommand[]): AgentCommand[] {
    const typed = /^\/([\w:.-]*)$/.exec(text);
    if (!typed) return [];
    return commands.filter((c) => c.name.startsWith(typed[1]!)).slice(0, MAX_SUGGESTIONS);
}

/** Arguments as typed in the custom agent form: separated by spaces, nothing unquoted. */
export function splitArgs(text: string): string[] {
    return text.split(/\s+/).filter(Boolean);
}
