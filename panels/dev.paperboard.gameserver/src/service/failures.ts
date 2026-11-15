// What the service asks of a failure: its code, its words, and whether a
// missing file is all it was. The words are the error's own; the page's
// readable form is lib/failure.ts's errorMessage.
import * as nodeFs from "node:fs/promises";
export { errorCode, errorText } from "../lib/failure";
import { errorCode } from "../lib/failure";

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
