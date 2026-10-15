// One streamed request body written to a file atomically: the bytes land
// in a sibling temp file and replace the target only once the whole body
// arrived under the cap. A failed, aborted or oversized upload leaves the
// previous file untouched and no temp file behind.
import type * as http from "http";
import * as fs from "fs";
import { logger } from "./logger";

export class UploadTooLargeError extends Error {
    constructor(readonly cap: number) {
        super(`upload exceeds ${cap} byte cap`);
    }
}

export async function receiveFileAtomic(req: http.IncomingMessage, target: string, cap: number): Promise<void> {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > cap) {
        req.resume();
        throw new UploadTooLargeError(cap);
    }
    const tmp = `${target}.davpart-${process.pid}-${Date.now()}`;
    try {
        await new Promise<void>((resolve, reject) => {
            let written = 0;
            const out = fs.createWriteStream(tmp);
            req.on("data", (chunk: Buffer) => {
                written += chunk.length;
                if (written > cap) {
                    req.unpipe(out);
                    out.destroy();
                    reject(new UploadTooLargeError(cap));
                }
            });
            req.pipe(out);
            req.on("aborted", () => reject(new Error("aborted")));
            out.on("finish", () => resolve());
            out.on("error", reject);
            req.on("error", reject);
        });
        fs.renameSync(tmp, target);
    } catch (err) {
        req.resume();
        try {
            fs.unlinkSync(tmp);
        } catch (cleanupErr) {
            logger.debug("[upload] tmp cleanup failed:", cleanupErr);
        }
        throw err;
    }
}
