// A brain already on this computer: the program the user installed themselves,
// found on PATH and in the folders each harness's own installer uses (a
// desktop app's PATH is shorter than a terminal's, so ~/.local/bin and the
// like are looked in too). Only a real program counts. On Windows that's an
// .exe: npm's .cmd shims need arguments of their own, which a brain's program
// can't carry.

import os from "node:os";
import path from "node:path";
import type { Harness } from "../contract";
import { findProgram } from "./which";

export const PROGRAMS: Record<Harness, string> = { codex: "codex", "claude-code": "claude", opencode: "opencode" };

export interface FindEnv {
    platform: NodeJS.Platform;
    pathEnv: string;
    home: string;
}

export const currentFindEnv = (): FindEnv => ({ platform: process.platform, pathEnv: process.env.PATH ?? "", home: os.homedir() });

/** where a harness's own installer puts it, besides PATH */
function installerDirs(harness: Harness, { platform, home }: FindEnv): string[] {
    const own = harness === "claude-code" ? [path.join(home, ".claude", "local")] : harness === "opencode" ? [path.join(home, ".opencode", "bin")] : [];
    const common = [path.join(home, ".local", "bin")];
    return platform === "win32" ? [...own, ...common] : [...own, ...common, "/opt/homebrew/bin", "/usr/local/bin"];
}

/** The harness's program already on this computer, or null. */
export function findExistingBrain(harness: Harness, env: FindEnv = currentFindEnv()): string | null {
    const sep = env.platform === "win32" ? ";" : ":";
    const pathEnv = [env.pathEnv, ...installerDirs(harness, env)].filter(Boolean).join(sep);
    const program = PROGRAMS[harness] + (env.platform === "win32" ? ".exe" : "");
    return findProgram(program, [], { platform: env.platform, pathEnv })?.command ?? null;
}

/** The version a program says for `--version`: the first thing in its output that looks like one. */
export function versionFrom(output: string): string | null {
    return /\d+\.\d+\.\d+[\w.+-]*/.exec(output)?.[0] ?? null;
}
