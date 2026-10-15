import * as os from "os";

/**
 * The exit code a workload's observers see. A child ended by a signal has no
 * exit code (Node reports null); reporting 0 would read as clean success, so
 * it is the shell convention 128 + signal number instead.
 */
export function workloadExitCode(code: number | null, signal: NodeJS.Signals | null): number {
    if (code !== null) return code;
    const number = signal ? os.constants.signals[signal] : undefined;
    return number ? 128 + number : 1;
}
