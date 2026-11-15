// Every file the service rewrites is written whole or not at all: to a temp
// file of its own beside it, flushed to disk, then renamed over the old one.
// A crash leaves the old file, never half of the new one, and a failed write
// takes its temp file with it.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Replace `file` with `data` in one step; its folder is made if it's missing. `mode` is a new file's permissions. */
export function writeAtomic(file: string, data: string | Uint8Array, mode = 0o666) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    try {
        const fd = fs.openSync(tmp, "w", mode);
        try {
            fs.writeFileSync(fd, data);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
    } catch (e) {
        // a failed cleanup throws instead of hiding the write's own failure
        fs.rmSync(tmp, { force: true });
        throw e;
    }
}
