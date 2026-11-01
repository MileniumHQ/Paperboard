// Windows console relay (supervisor.ts, consoleInput). Some programs read
// their input from a console and quit on a pipe (a Source dedicated server
// in -console mode). The supervisor has no console to give them: it runs
// detached. This process, which the supervisor starts hidden, has a console
// with no window. It hands that console's input to the program and passes
// the program's output and exit code straight through.
import * as cp from "child_process";
import * as fs from "fs";

export const CONSOLE_RELAY_FLAG = "--console-relay";

/** How a supervisor runs `command` behind the relay: its own runtime again, in relay mode. */
export function consoleRelayLaunch(command: string, args: readonly string[]): { command: string; args: string[]; env: Record<string, string> } {
    // the desktop app's supervisor is Electron in node mode, running its entry file
    if (process.versions.electron) {
        return { command: process.execPath, args: [process.argv[1]!, CONSOLE_RELAY_FLAG, command, ...args], env: { ELECTRON_RUN_AS_NODE: "1" } };
    }
    return { command: process.execPath, args: [CONSOLE_RELAY_FLAG, command, ...args], env: {} };
}

/** The relay's command and arguments in this process's argv; null when it isn't one. */
export function consoleRelayArgs(argv: readonly string[]): { command: string; args: string[] } | null {
    const at = argv.indexOf(CONSOLE_RELAY_FLAG);
    if (at === -1) return null;
    const command = argv[at + 1];
    if (!command) throw new Error(`${CONSOLE_RELAY_FLAG} needs the program to run`);
    return { command, args: argv.slice(at + 2) };
}

export function runConsoleRelay(command: string, args: readonly string[]): void {
    // node mode is how the relay started, not something the program inherits
    delete process.env.ELECTRON_RUN_AS_NODE;
    let input: number;
    try {
        input = fs.openSync("CONIN$", "r+");
    } catch (err) {
        console.error(`Could not give ${command} a console to read: ${(err as Error).message}`);
        process.exit(1);
    }
    const child = cp.spawn(command, args, { stdio: [input, "inherit", "inherit"] });
    fs.closeSync(input);
    child.on("error", (err) => {
        console.error(`Could not start ${command}: ${err.message}`);
        process.exit(1);
    });
    child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
