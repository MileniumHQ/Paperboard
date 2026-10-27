// The agent's shell: bash over its home folder, run by just-bash, a bash
// interpreter written in TypeScript. Its commands (ls, cat, grep, sed, awk,
// find, jq, tar…) are JavaScript working on the home folder through
// ReadWriteFs. No program on this computer runs and nothing reaches the
// network; links are refused, so nothing outside the folder is read or
// written. ~ is /home/user; the rest of its file system (/tmp) is scratch
// in memory, gone when the command ends.

import { Bash, type CommandName, type DefenseInDepthConfig, getCommandNames, InMemoryFs, MountableFs, ReadWriteFs } from "just-bash";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { type HomeFolder, SHELL_HOME } from "./homeFolder";
import type { Toolset } from "./toolsets";

/** what one command may print before the rest is cut, so a big `cat` can't flood the conversation */
export const OUTPUT_CHARS = 30_000;
/** how long one command may run */
export const COMMAND_MS = 60_000;

// sqlite3 runs in a worker over sql.js's WebAssembly, which the panel's
// one-file service doesn't carry: it's left out rather than failing
const COMMANDS = getCommandNames().filter((c) => c !== "sqlite3") as CommandName[];

// just-bash guards the process while a command runs, in one guard every
// shell shares: its settings are this one object
const DEFENSE: DefenseInDepthConfig = {
    enabled: true,
    // Bun's file handles register themselves for cleanup: blocked, every write under Bun fails
    excludeViolationTypes: ["finalization_registry"],
    // a blocked call reaches the agent only as an EIO: the service's log says what it was
    onViolation: (v) => console.error(`[ai] the shell blocked ${v.path}: ${v.message}`),
};

export const SHELL_INSTRUCTIONS = `How to use your shell: \`bash\` runs a bash command in your home folder (~, which is ${SHELL_HOME}). It's the same folder the browser downloads to and \`upload\`, \`share_file\` and \`put_file_on_computer\` use.
- Read, search, write and sort out files there with the usual tools: ls, cat, head, tail, grep, rg, sed, awk, find, sort, diff, jq, yq, xan (CSV), tar, gzip and more. Any command takes --help.
- It's a shell for files, not a whole computer: no network, nothing to install, and no other programs (no node, python, git or sqlite3).
- Each call starts in ~ with a fresh shell: cd and variables don't carry over to the next call, files do. Chain the steps of one job with && in one call.
- Only ~ is kept. Anything written elsewhere, like /tmp, is gone when the command ends.`;

export const SHELL_TOOLS: ToolSpec[] = [
    {
        name: "bash",
        description: `Run a bash command in your home folder (~ is ${SHELL_HOME}) and get what it printed and its exit code. For files: no network, no programs beyond the shell's own.`,
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
                commands: COMMANDS,
                executionLimitProfile: "hardened",
                executionLimits: { maxExecutionTimeMs: COMMAND_MS },
                defenseInDepth: DEFENSE,
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
