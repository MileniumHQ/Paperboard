import { fileApi, processApi, system } from "@paperboard-dev/paperapi";
import { PANEL_ID } from "../service/types";
import { isWindowsTarget } from "./platform";

// only these characters may reach a path or shell command
const ENTRY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ ()-]*$/;

export function isValidEntryName(name: string): boolean {
    return ENTRY_NAME_PATTERN.test(name) && !name.includes("..");
}

export function sanitizeFileName(name: string): string | null {
    const trimmed = name.trim();
    if (!isValidEntryName(trimmed)) return null;
    return trimmed;
}

export interface DirectoryListing {
    entries: string[];
    /** Human-readable failure reason. Set only when enumeration failed. */
    error?: string;
}

export async function tryListDirectory(dir: string): Promise<DirectoryListing> {
    try {
        // boundary: dir must itself be a safe segment before it reaches a
        // shell-adjacent command — never rely on the caller remembering
        if (typeof dir !== "string" || !isValidEntryName(dir) || dir.includes("/")) {
            throw new Error(`Unsafe directory name: ${JSON.stringify(dir)}`);
        }
        const serverDir = await fileApi.getPath("", PANEL_ID);
        const targetOs = (await system.getInfo()).os;
        const isWin = isWindowsTarget(serverDir, targetOs);
        const separator = isWin ? "\\" : "/";
        const absoluteDir = `${serverDir.replace(/[\\/]+$/, "")}${separator}${dir}`;

        let output = "";
        const collect = (chunk: string) => {
            output += chunk;
        };

        // run resolves on exit, do not also subscribe via onExit
        let result: { exitCode?: number };
        if (isWin) {
            result = await processApi.run({
                command: "cmd",
                args: ["/c", "dir", "/b", "/a:d-l-h", absoluteDir],
                cwd: serverDir,
                onStdout: collect,
            });
        } else {
            result = await processApi.run({
                command: "ls",
                args: ["-1", absoluteDir],
                cwd: serverDir,
                onStdout: collect,
            });
        }

        // only an explicit non-zero exit code counts as failure
        const exitCode = (result as any).exitCode;
        if (typeof exitCode === "number" && exitCode !== 0) {
            console.error(
                `[FileSystem] Listing "${dir}" exited with code ${exitCode}. Raw output:\n${
                    output.trim() || "(no output)"
                }`,
            );
            return {
                entries: [],
                error: `Could not list "${dir}/" (exit code ${exitCode}).`,
            };
        }

        const entries = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        if (entries.length === 0 && typeof exitCode !== "number") {
            // unreliable listing without an exit code
            console.warn(`[FileSystem] Listing "${dir}" produced no output and no exit code.`);
        }

        return { entries };
    } catch (err) {
        console.error(`[FileSystem] Failed to list directory "${dir}":`, err);
        return {
            entries: [],
            error: `Could not list "${dir}/". Check the console for details.`,
        };
    }
}

export async function listDirectory(dir: string): Promise<string[]> {
    return (await tryListDirectory(dir)).entries;
}
