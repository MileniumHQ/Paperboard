#!/usr/bin/env bun
// Builds the workload supervisor (apps/paperboard/supervisor, Go) into
// apps/paperboard/resources/supervisor/<platform>-<arch>/, where the desktop
// app reads it and the server compile embeds it.
//
//   bun scripts/supervisor.ts                 this computer's target
//   bun scripts/supervisor.ts linux-arm64 …   the named release targets
//   bun scripts/supervisor.ts --all           every release target
//   bun scripts/supervisor.ts --only …        the same, removing every other
//                                             target's build first (packaging)
//   bun scripts/supervisor.ts --path …        builds, and prints only the path
//                                             (to hand to `bun build --compile`)
//
// Go cross-compiles every target from any host, so one machine builds all.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "apps", "paperboard");
const SOURCE_DIR = join(APP_DIR, "supervisor");
export const SUPERVISOR_OUT_DIR = join(APP_DIR, "resources", "supervisor");

// release target -> how Go and Node each name it
export const SUPERVISOR_TARGETS = {
    "linux-x64": { goos: "linux", goarch: "amd64", platform: "linux", arch: "x64" },
    "linux-arm64": { goos: "linux", goarch: "arm64", platform: "linux", arch: "arm64" },
    "macos-x64": { goos: "darwin", goarch: "amd64", platform: "darwin", arch: "x64" },
    "macos-arm64": { goos: "darwin", goarch: "arm64", platform: "darwin", arch: "arm64" },
    "windows-x64": { goos: "windows", goarch: "amd64", platform: "win32", arch: "x64" },
} as const;
export type SupervisorTarget = keyof typeof SUPERVISOR_TARGETS;

export function hostSupervisorTarget(): SupervisorTarget {
    const found = (Object.keys(SUPERVISOR_TARGETS) as SupervisorTarget[]).find((name) => {
        const target = SUPERVISOR_TARGETS[name];
        return target.platform === process.platform && target.arch === process.arch;
    });
    if (!found) throw new Error(`Paperboard has no workload supervisor for ${process.platform}-${process.arch}`);
    return found;
}

/** Where a target's built supervisor is. */
export function supervisorBinaryPath(target: SupervisorTarget): string {
    const { platform, arch } = SUPERVISOR_TARGETS[target];
    return join(SUPERVISOR_OUT_DIR, `${platform}-${arch}`, platform === "win32" ? "paperboard-supervisor.exe" : "paperboard-supervisor");
}

/** Builds one target's supervisor and returns where it is. */
export function buildSupervisor(target: SupervisorTarget = hostSupervisorTarget()): string {
    const { goos, goarch } = SUPERVISOR_TARGETS[target];
    const out = supervisorBinaryPath(target);
    mkdirSync(dirname(out), { recursive: true });
    const result = spawnSync("go", ["build", "-trimpath", "-ldflags", "-s -w", "-o", out, "."], {
        cwd: SOURCE_DIR,
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" },
    });
    if (result.error) {
        if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error("Building the workload supervisor needs Go, and `go` is not on PATH. Install it from https://go.dev/dl/ (or your package manager) and run this again.");
        }
        throw result.error;
    }
    if (result.status !== 0) throw new Error(`go build of the workload supervisor for ${target} failed (exit ${result.status ?? "signal"})`);
    return out;
}

/**
 * Leaves exactly these targets' supervisors in the output folder, so a
 * packaged app carries the ones its platform runs and no others.
 */
export function buildSupervisorsOnly(targets: SupervisorTarget[]): string[] {
    rmSync(SUPERVISOR_OUT_DIR, { recursive: true, force: true });
    return targets.map((target) => buildSupervisor(target));
}

if (import.meta.main) {
    const flags = ["--all", "--only", "--path"];
    const args = process.argv.slice(2);
    const names = Object.keys(SUPERVISOR_TARGETS) as SupervisorTarget[];
    const unknown = args.filter((arg) => !flags.includes(arg) && !names.includes(arg as SupervisorTarget));
    if (unknown.length > 0) {
        console.error(`Unknown target ${unknown.join(", ")}. Targets: ${names.join(", ")}; flags: ${flags.join(", ")}.`);
        process.exit(2);
    }
    const named = args.filter((arg) => !flags.includes(arg)) as SupervisorTarget[];
    const targets = args.includes("--all") ? names : named.length > 0 ? named : [hostSupervisorTarget()];
    try {
        const built = args.includes("--only") ? buildSupervisorsOnly(targets) : targets.map((target) => buildSupervisor(target));
        targets.forEach((target, i) => console.log(args.includes("--path") ? built[i] : `${target}: ${built[i]}`));
    } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
    }
}
