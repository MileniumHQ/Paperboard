// What the service asks of a failure: its code, its words, and whether a
// missing file is all it was. The words are the error's own; the page's
// readable form is lib/failure.ts's errorMessage.
import * as nodeFs from "node:fs/promises";
export { errorCode, errorText } from "../lib/failure";
import { errorCode } from "../lib/failure";

/** Whether anything is at this path (a link counts, wherever it points); any error but a missing file throws. */
export async function exists(path: string, fs: { lstat(path: string): Promise<unknown> } = nodeFs): Promise<boolean> {
    try {
        await fs.lstat(path);
        return true;
    } catch (err) {
        if (errorCode(err) === "ENOENT") return false;
        throw err;
    }
}
