// "No sandbox": a chat mode that accepts every tool call without asking.
// Claude Code has it built in (its bypassPermissions mode); for an ACP agent
// and for a local model's own tool calls, the panel's service answers each
// request itself while the chat is in this mode (service/chat.ts).

import type { AgentMode, AgentPermissionOption } from "./types";

/** the panel's own id for the mode: ACP agents and local chats */
export const NO_SANDBOX_MODE_ID = "no-sandbox";
/** Claude Code's id for the same mode */
export const CLAUDE_NO_SANDBOX_MODE_ID = "bypassPermissions";

const NO_SANDBOX_NAME = "No sandbox";
const NO_SANDBOX_DESCRIPTION = "Edits files and runs commands without asking.";

export const NO_SANDBOX_MODE: AgentMode = { id: NO_SANDBOX_MODE_ID, name: NO_SANDBOX_NAME, description: NO_SANDBOX_DESCRIPTION };
export const CLAUDE_NO_SANDBOX_MODE: AgentMode = { id: CLAUDE_NO_SANDBOX_MODE_ID, name: NO_SANDBOX_NAME, description: NO_SANDBOX_DESCRIPTION };

export function isNoSandboxMode(id: unknown): boolean {
    return id === NO_SANDBOX_MODE_ID || id === CLAUDE_NO_SANDBOX_MODE_ID;
}

/** An ACP agent's own modes, with No sandbox offered after them unless it has its own. */
export function withNoSandbox(modes: readonly AgentMode[]): AgentMode[] {
    return modes.some((m) => isNoSandboxMode(m.id)) ? [...modes] : [...modes, NO_SANDBOX_MODE];
}

/** The option a No sandbox chat answers a permission request with: allow this once, else allow always. */
export function autoAllowOption(options: readonly AgentPermissionOption[]): string | null {
    return (options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind === "allow_always"))?.id ?? null;
}
