import {
    errorMessage,
    type fileApi as FileApi,
    type processApi as ProcessApi,
    type system as SystemApi,
} from "@mileniumhq/paperapi";
import { PANEL_ID } from "../service/types";
import { isWindowsTarget } from "../lib/platform";
import { isValidEntryName, isListableDirArg, windowsDirArgs } from "../core/dirs";

// entry-name + directory-arg validation lives in core/dirs.ts (pure, tested)
export { isValidEntryName, isListableDirArg } from "../core/dirs";

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

export function createDirectoryLister({
    fileApi,
    processApi,
    system,
}: {
    fileApi: typeof FileApi;
    processApi: typeof ProcessApi;
    system: typeof SystemApi;
}) {
    async function tryListDirectory(dir: string): Promise<DirectoryListing> {
        try {
            // boundary: "" is the panel root, anything else must be one safe
            // segment — never rely on the caller remembering
            if (!isListableDirArg(dir)) {
                throw new Error(`Unsafe directory name: ${JSON.stringify(dir)}`);
            }
            const serverDir = await fileApi.getPath("", PANEL_ID);
            const targetOs = (await system.getInfo()).os;
            const isWin = isWindowsTarget(serverDir, targetOs);
            const separator = isWin ? "\\" : "/";
            const base = serverDir.replace(/[\\/]+$/, "");
            const relative = dir === "" ? "" : dir.split("/").join(separator);
            const absoluteDir =
                relative === "" ? base || serverDir : `${base}${separator}${relative}`;

            let output = "";
            let errors = "";
            const collect = (chunk: string) => {
                output += chunk;
            };
            const collectErrors = (chunk: string) => {
                errors += chunk;
            };

            // run resolves on exit, do not also subscribe via onExit
            let result: { exitCode?: number };
            if (isWin) {
                result = await processApi.run({
                    command: "cmd",
                    args: windowsDirArgs(absoluteDir),
                    cwd: serverDir,
                    onStdout: collect,
                    onStderr: collectErrors,
                });
            } else {
                result = await processApi.run({
                    command: "ls",
                    args: ["-1", absoluteDir],
                    cwd: serverDir,
                    onStdout: collect,
                    onStderr: collectErrors,
                });
            }

            // only an explicit non-zero exit code counts as failure
            const exitCode = (result as any).exitCode;
            // the lister's own words say why (no such folder, no permission)
            if (typeof exitCode === "number" && exitCode !== 0) {
                return {
                    entries: [],
                    error: `Could not list "${dir}/": ${errors.trim() || `the lister exited with code ${exitCode} and said nothing`}`,
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
            return {
                entries: [],
                error: `Could not list "${dir}/": ${errorMessage(err)}`,
            };
        }
    }

    /** the folder's entries; a folder that can't be listed is a failure, never an empty one */
    async function listDirectory(dir: string): Promise<string[]> {
        const listing = await tryListDirectory(dir);
        if (listing.error) throw new Error(listing.error);
        return listing.entries;
    }

    return { tryListDirectory, listDirectory };
}
