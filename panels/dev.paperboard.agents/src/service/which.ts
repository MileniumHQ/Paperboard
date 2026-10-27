import fs from "node:fs";
import path from "node:path";

/** An executable on PATH, without a shell. */
export function which(command: string): string | null {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (!dir) continue;
        const p = path.join(dir, command);
        try {
            fs.accessSync(p, fs.constants.X_OK);
            return p;
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "EACCES" && code !== "ENOTDIR") throw e;
        }
    }
    return null;
}
