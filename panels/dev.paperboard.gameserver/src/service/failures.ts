// Whether a missing file is all a failure was. Its code and words are
// PaperAPI's errorCode and errorMessage; the page's readable form is
// lib/failure.ts's errorMessage.
import * as nodeFs from "node:fs/promises";
import { errorCode } from "@mileniumhq/paperapi";

/** What `work` gives, or `missing` when what it reads isn't there; any other failure throws. */
export async function unlessMissing<T, M>(work: Promise<T>, missing: M): Promise<T | M> {
    try {
        return await work;
    } catch (err) {
        if (errorCode(err) === "ENOENT") return missing;
        throw err;
    }
}

/** Whether anything is at this path (a link counts, wherever it points); any error but a missing file throws. */
export const exists = (path: string, fs: { lstat(path: string): Promise<unknown> } = nodeFs): Promise<boolean> =>
    unlessMissing(fs.lstat(path).then(() => true), false);
