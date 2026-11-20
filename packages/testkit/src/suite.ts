// The part every suite runner shares (withChrome.ts, withPanelUi.ts): run
// the suite's command with what the runner set up named in its environment,
// pass a signal meant for the suite on to it, and answer with its exit code.
import { spawn } from "node:child_process";

/** the command starts at the first word that isn't a switch; the words before it are the runner's */
export function splitCommand(argv: string[], usage: string): { switches: string[]; command: string[] } {
    const split = argv.findIndex((word) => !word.startsWith("-"));
    const command = split === -1 ? [] : argv.slice(split);
    if (command.length === 0) {
        console.error(`usage: ${usage}`);
        process.exit(2);
    }
    return { switches: argv.slice(0, split), command };
}

/** runs `command` with `env` added to this process's environment; resolves with its exit code */
export async function runSuite(runner: string, command: string[], env: Record<string, string>): Promise<number> {
    const child = spawn(command[0]!, command.slice(1), { stdio: "inherit", env: { ...process.env, ...env } });
    // a signal to this process is meant for the suite: pass it on, and leave once the suite has
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
    return new Promise<number>((resolve) => {
        child.once("error", (err) => {
            console.error(`${runner}: could not run ${command[0]}: ${err.message}`);
            resolve(127);
        });
        child.once("exit", (status, signal) => resolve(status ?? (signal ? 1 : 0)));
    });
}
