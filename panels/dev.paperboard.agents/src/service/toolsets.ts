// The agent's tools come in toolsets: its computer, its shell, its messages, its
// memory, MCP servers and Paperboard actions. Each is its own module and
// says what it adds to the agent's instructions; the service's one MCP
// endpoint serves them all through a Toolbox.

import type { ToolSpec } from "./computerTools";
import type { ToolResult } from "./computerMcp";

/**
 * Who the running turn answers. A flow's message (the Send Message action) is answered for a flow, which reads
 * the reply as data: it can't sign in or show an app card, and files go with a text, not inside it.
 */
export interface TurnMode {
    fromFlow: boolean;
    /** a flow's own instructions for the turn, in place of the ones in settings */
    instructions?: string;
}

/** a turn that answers the user: the mode when none is given */
export const USER_TURN: TurnMode = { fromFlow: false };

export interface Toolset {
    /** short, for errors and logs */
    id: string;
    /** what it offers right now (a toolset backed by other servers may change between calls) */
    tools(mode: TurnMode): ToolSpec[] | Promise<ToolSpec[]>;
    /** only ever called with a name this toolset listed for the same mode */
    call(name: string, args: Record<string, unknown>, mode: TurnMode): Promise<ToolResult>;
    /** when to use its tools, and when not: a short part of the instructions' Tools, read at the start of every turn */
    instructions?(mode: TurnMode): string | Promise<string>;
    /** what's true right now (the memory, the routines, what's allowed): a part of the instructions' Now */
    context?(mode: TurnMode): string | Promise<string>;
}

/** Each toolset's parts of the agent's instructions, in toolset order. */
export interface Sections {
    tools: string[];
    now: string[];
}

export interface Toolbox {
    list(): Promise<ToolSpec[]>;
    call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
    instructions(): Promise<Sections>;
}

/**
 * One Toolbox over several toolsets, in the running turn's mode. Two toolsets offering one name is a bug: listing
 * fails rather than pick one. A tool the mode doesn't list can't be called either.
 */
export function toolbox(sets: Toolset[], mode: () => TurnMode = () => USER_TURN): Toolbox {
    const listAll = async (m: TurnMode) => {
        const owners = new Map<string, Toolset>();
        const tools: ToolSpec[] = [];
        for (const set of sets) {
            for (const t of await set.tools(m)) {
                const other = owners.get(t.name);
                if (other) throw new Error(`tool ${t.name} is offered by both ${other.id} and ${set.id}`);
                owners.set(t.name, set);
                tools.push(t);
            }
        }
        return { tools, owners };
    };
    return {
        list: async () => (await listAll(mode())).tools,
        call: async (name, args) => {
            const m = mode();
            const owner = (await listAll(m)).owners.get(name);
            if (!owner) throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
            return owner.call(name, args, m);
        },
        instructions: async () => {
            const m = mode();
            const out: Sections = { tools: [], now: [] };
            for (const set of sets) {
                const tools = await set.instructions?.(m);
                if (tools?.trim()) out.tools.push(tools.trim());
                const now = await set.context?.(m);
                if (now?.trim()) out.now.push(now.trim());
            }
            return out;
        },
    };
}
