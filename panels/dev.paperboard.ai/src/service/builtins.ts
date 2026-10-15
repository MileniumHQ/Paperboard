// Effects of the built-in tools. The shell runs through the daemon's process
// API so the child is owned, time-limited and output-capped.

import os from "node:os";
import { processApi } from "@mileniumhq/paperapi";
import { SHELL_OUTPUT_CAP_BYTES, SHELL_TIMEOUT_MS, shellArgv } from "../core/builtins";

export async function runShell(command: string, signal: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    const argv = shellArgv(command, process.platform);
    // bounded by timeout and output cap; the daemon owns and kills the child
    return processApi.exec(argv.command, argv.args, {
        cwd: os.homedir(),
        timeoutMs: SHELL_TIMEOUT_MS,
        execBufferCapBytes: SHELL_OUTPUT_CAP_BYTES,
    });
}
