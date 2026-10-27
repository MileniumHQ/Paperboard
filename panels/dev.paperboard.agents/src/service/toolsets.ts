// The agent's tools come in toolsets: its computer, its messages, its
// memory, MCP servers and Paperboard actions. Each is its own module and
// says what it adds to the agent's instructions; the service's one MCP
// endpoint serves them all through a Toolbox.

import type { ToolSpec } from "./computerTools";
import type { ToolResult } from "./computerMcp";

export interface Toolset {
    /** short, for errors and logs */
    id: string;
    /** what it offers right now (a toolset backed by other servers may change between calls) */
    tools(): ToolSpec[] | Promise<ToolSpec[]>;
    /** only ever called with a name this toolset listed */
    call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
    /** a section of the agent's instructions, read at the start of every turn */
    instructions?(): string | Promise<string>;
}

export interface Toolbox {
    list(): Promise<ToolSpec[]>;
    call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
    instructions(): Promise<string[]>;
}

/** One Toolbox over several toolsets. Two toolsets offering one name is a bug: listing fails rather than pick one. */
export function toolbox(sets: Toolset[]): Toolbox {
    const listAll = async () => {
        const owners = new Map<string, Toolset>();
        const tools: ToolSpec[] = [];
        for (const set of sets) {
            for (const t of await set.tools()) {
                const other = owners.get(t.name);
                if (other) throw new Error(`tool ${t.name} is offered by both ${other.id} and ${set.id}`);
                owners.set(t.name, set);
                tools.push(t);
            }
        }
        return { tools, owners };
    };
    return {
        list: async () => (await listAll()).tools,
        call: async (name, args) => {
            const owner = (await listAll()).owners.get(name);
            if (!owner) throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
            return owner.call(name, args);
        },
        instructions: async () => {
            const out: string[] = [];
            for (const set of sets) {
                const s = await set.instructions?.();
                if (s?.trim()) out.push(s.trim());
            }
            return out;
        },
    };
}
