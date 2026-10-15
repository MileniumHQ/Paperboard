// A Windows batch file (.cmd/.bat) cannot be started without a shell: the
// runtime refuses to spawn one directly, and a refusal that surfaces as
// "did not become ready" hides the cause. Name it instead. Running one is a
// shell decision for the caller (command "cmd.exe", args ["/c", file, ...]
// with static args); the daemon never builds that shell line from input.

// Windows ignores trailing dots and spaces in a name, so "a.cmd. " is a.cmd
const BATCH_NAME_RE = /\.(?:cmd|bat)[. ]*$/i;

export function batchFileRefusal(command: string, platform: NodeJS.Platform = process.platform): string | null {
    if (platform !== "win32" || !BATCH_NAME_RE.test(command)) return null;
    return `"${command}" is a batch file and cannot be started directly; batch files must be run via cmd.exe /c with static args (command "cmd.exe", args ["/c", "${command}", ...])`;
}
