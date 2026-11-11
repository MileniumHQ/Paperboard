// Run Shell Command, as the block and the v1 action both run it: one command
// in a shell of its own, through the daemon, waited for.
import { processApi, resolveOneShotShell } from "@mileniumhq/paperapi";
import { errorMessage } from "./failure";

const SHELL_TIMEOUT_MS = 30_000;
const SHELL_TAIL_LINES = 10;
const SHELL_TAIL_CHARS = 1000;

/** The command as an error names it: one line, cut short when it's long. */
function commandLabel(cmd: string): string {
    const line = cmd.replace(/\s+/g, " ");
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** The last lines a failed command printed, for its error. */
function outputTail(text: string): string {
    const tail = text.split(/\r?\n/).slice(-SHELL_TAIL_LINES).join("\n");
    return tail.length > SHELL_TAIL_CHARS ? `…${tail.slice(-SHELL_TAIL_CHARS)}` : tail;
}

/**
 * Runs a command in a shell of its own and gives back its standard output.
 * Standard error is never passed off as output: a command that exits 0 gives
 * back only what it printed to stdout (`2>&1` folds stderr in). A non-zero
 * exit fails with the code and the tail of stderr (stdout when stderr is
 * empty); a command still running after the timeout is stopped and fails.
 */
export async function runShellCommand(command: string | undefined, timeoutMs = SHELL_TIMEOUT_MS): Promise<string> {
    const cmd = (command || "").trim();
    if (!cmd) throw new Error("Command is required");
    const shell = resolveOneShotShell();
    let res: { stdout: string; stderr: string; exitCode: number };
    try {
        res = await processApi.exec(shell.command, [...shell.baseArgs, cmd], { timeoutMs });
    } catch (err) {
        const message = errorMessage(err);
        if (message.startsWith("RUN_TIMEOUT")) {
            throw new Error(`"${commandLabel(cmd)}" was still running after ${timeoutMs / 1000} seconds, so it was stopped`);
        }
        throw new Error(`"${commandLabel(cmd)}" couldn't run: ${message}`);
    }
    if (res.exitCode !== 0) {
        const printed = res.stderr || res.stdout;
        throw new Error(
            printed
                ? `"${commandLabel(cmd)}" failed with exit code ${res.exitCode}:\n${outputTail(printed)}`
                : `"${commandLabel(cmd)}" failed with exit code ${res.exitCode} and printed nothing`,
        );
    }
    return res.stdout;
}
