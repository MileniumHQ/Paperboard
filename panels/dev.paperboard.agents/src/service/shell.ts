// The agent's shell: bash over its home folder, run by just-bash, a bash
// interpreter written in TypeScript. Its commands (ls, cat, grep, sed, awk,
// find, jq, tar…) are JavaScript working on the home folder through
// ReadWriteFs, and js-exec runs JavaScript in QuickJS, compiled to
// WebAssembly. No program on this computer runs; links are refused, so
// nothing outside the folder is read or written. curl and fetch reach the
// internet, never this computer or its local network: every name is
// resolved, checked and pinned before it's dialled. ~ is /home/user; the
// rest of its file system (/tmp) is scratch in memory, gone when the
// command ends.

import type { CommandName, DefenseInDepthConfig, NetworkConfig } from "just-bash";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { type HomeFolder, SHELL_HOME } from "./homeFolder";
import type { Toolset } from "./toolsets";

/** what one command may print before the rest is cut, so a big `cat` can't flood the conversation */
export const OUTPUT_CHARS = 30_000;
/** how long one command may run */
export const COMMAND_MS = 60_000;

type JustBash = typeof import("just-bash");

// just-bash and its commands are most of what this service would hold in
// memory, and only a bash call needs them: they're loaded with the first one.
// A load that fails is that call's error, and the next call tries again.
let loading: Promise<{ lib: JustBash; commands: CommandName[] }> | undefined;
function loadShell(): Promise<{ lib: JustBash; commands: CommandName[] }> {
    loading ??= import("just-bash").then(
        (lib) => ({
            lib,
            // sqlite3 runs in a worker over sql.js's WebAssembly, which the panel's
            // built service doesn't carry: it's left out rather than failing
            commands: lib.getCommandNames().filter((c) => c !== "sqlite3") as CommandName[],
        }),
        (e) => {
            loading = undefined;
            throw e;
        },
    );
    return loading;
}

// just-bash guards the process while a command runs, in one guard every
// shell shares: its settings are this one object
const DEFENSE: DefenseInDepthConfig = {
    enabled: true,
    // Bun's file handles register themselves for cleanup, and its HTTP client
    // reads performance: blocked, every write and every fetch under Bun fails.
    // Neither reaches js-exec's code, which runs in QuickJS with its own globals.
    excludeViolationTypes: ["finalization_registry", "performance_timing"],
    // a blocked call reaches the agent only as an EIO: the service's log says what it was
    onViolation: (v) => console.error(`[ai] the shell blocked ${v.path}: ${v.message}`),
};

// any site and method, as the agent's browser can; denyPrivateRanges keeps
// loopback and the local network out even with full internet access
const NETWORK: NetworkConfig = { dangerouslyAllowFullInternetAccess: true, denyPrivateRanges: true };

export const SHELL_INSTRUCTIONS = `**Your shell:** \`bash\` runs in your home folder (~, which is ${SHELL_HOME}), the folder the browser downloads to and the file tools use.
- **Tools:** ls, cat, grep, rg, sed, awk, find, jq, yq, xan (CSV), tar and more; any command takes --help.
- **JavaScript:** \`js-exec -c '...'\` or \`js-exec script.mjs\` for math, data and web APIs. It has fetch, top-level await, fs and path; imports go by file path, not package.
- **Internet only:** fetch and curl never reach this computer or its local network.
- **Not a whole computer:** no installing, and no node, npm, python, git or sqlite3.
- **Fresh each call:** cd and variables don't carry over, files do. Chain one job's steps with &&.
- **Only ~ is kept:** anything written elsewhere, like /tmp, is gone when the command ends.`;

export const SHELL_TOOLS: ToolSpec[] = [
    {
        name: "bash",
        description: `Run a bash command in your home folder (~ is ${SHELL_HOME}) and get what it printed and its exit code. For files, JavaScript (js-exec) and the web (curl); no programs beyond the shell's own.`,
        inputSchema: {
            type: "object",
            properties: { command: { type: "string", description: "The command, e.g. `ls -la ~/Downloads` or `grep -rn invoice ~ | head`." } },
            required: ["command"],
        },
    },
];

/** What a command printed, as the agent reads it: output, then errors, then a failing exit code, cut to OUTPUT_CHARS. */
export function shellOutput(r: { stdout: string; stderr: string; exitCode: number }): string {
    let text = r.stdout;
    if (r.stderr) text += `${text && !text.endsWith("\n") ? "\n" : ""}${r.stderr}`;
    if (r.exitCode !== 0) text += `${text && !text.endsWith("\n") ? "\n" : ""}[exit code ${r.exitCode}]`;
    if (!text) return "(no output)";
    if (text.length <= OUTPUT_CHARS) return text;
    return `${text.slice(0, OUTPUT_CHARS)}\n[… ${text.length - OUTPUT_CHARS} more characters cut: narrow it down with head, tail or grep]`;
}

export function shellToolset(home: HomeFolder): Toolset {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
        id: "shell",
        tools: () => SHELL_TOOLS,
        instructions: () => SHELL_INSTRUCTIONS,
        call: async (name, args): Promise<ToolResult> => {
            if (name !== "bash") return { text: `unknown tool ${name}`, isError: true };
            if (typeof args.command !== "string" || !args.command.trim()) return { text: "give the command to run", isError: true };
            // erasing the computer empties the folder; it's there again for the next command
            home.ensure();
            const { lib, commands } = await loadShell();
            const { Bash, InMemoryFs, MountableFs, ReadWriteFs } = lib;
            const scratch = new InMemoryFs();
            scratch.mkdirSync("/tmp");
            const fs = new MountableFs({
                base: scratch,
                mounts: [{ mountPoint: SHELL_HOME, filesystem: new ReadWriteFs({ root: home.root }) }],
            });
            const bash = new Bash({
                fs,
                cwd: SHELL_HOME,
                env: { HOME: SHELL_HOME, TZ: timeZone },
                commands,
                executionLimitProfile: "hardened",
                executionLimits: { maxExecutionTimeMs: COMMAND_MS },
                defenseInDepth: DEFENSE,
                javascript: true,
                network: NETWORK,
            });
            try {
                return { text: shellOutput(await bash.exec(args.command)) };
            } catch (e) {
                // a command the shell couldn't run at all (a limit hit, a script it can't parse) is the agent's to fix
                return { text: e instanceof Error ? e.message : String(e), isError: true };
            }
        },
    };
}
