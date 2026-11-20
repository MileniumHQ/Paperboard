// The part every suite runner shares (withChrome.ts, withPanelUi.ts): run
// what the runner needs and then the suite's command, each a child process,
// pass a signal meant for the suite on to the child running then, and answer
// with the suite's exit code. A runner catches the signals from the moment it
// loads, so it always gets to clean up after itself: a signal before any
// child runs, or between two, means no further child starts.
import { spawn, type ChildProcess } from "node:child_process";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
let running: ChildProcess | null = null;
let stopped: NodeJS.Signals | null = null;
for (const signal of SIGNALS) {
    process.on(signal, () => {
        stopped ??= signal;
        running?.kill(signal);
    });
}

/** the command starts at the first word; a runner that takes no switches refuses any */
export function splitCommand(argv: string[], usage: string, takesSwitches: boolean): { switches: string[]; command: string[] } {
    const split = argv.findIndex((word) => !word.startsWith("-"));
    const command = split === -1 ? [] : argv.slice(split);
    const switches = split === -1 ? argv : argv.slice(0, split);
    if (command.length === 0 || (!takesSwitches && switches.length > 0)) {
        console.error(`usage: ${usage}`);
        process.exit(2);
    }
    return { switches, command };
}

/** the signal the runner was stopped with, or null while it runs on */
export const stoppedBy = (): NodeJS.Signals | null => stopped;

export interface Ran {
    /** its exit code: 1 when it was ended by a signal, or never started because the runner was stopped */
    code: number;
    /** everything it printed, when `capture` was asked for; else it printed straight to this process's output */
    output: string;
}

/** runs `command` as a child, with `env` added to this process's environment; a runner stopped already starts nothing */
export function runChild(runner: string, command: string[], options: { env?: Record<string, string>; capture?: boolean } = {}): Promise<Ran> {
    if (stopped) return Promise.resolve({ code: 1, output: "" });
    const child = spawn(command[0]!, command.slice(1), {
        stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
        env: { ...process.env, ...options.env },
    });
    running = child;
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    return new Promise<Ran>((resolve) => {
        child.once("error", (err) => {
            running = null;
            resolve({ code: 127, output: `${runner}: could not run ${command[0]}: ${err.message}` });
        });
        child.once("close", (status, signal) => {
            running = null;
            resolve({ code: status ?? (signal ? 1 : 0), output });
        });
    });
}

/** runs the suite's command with `env` added; resolves with its exit code */
export async function runSuite(runner: string, command: string[], env: Record<string, string>): Promise<number> {
    const { code, output } = await runChild(runner, command, { env });
    if (output) console.error(output);
    return code;
}
