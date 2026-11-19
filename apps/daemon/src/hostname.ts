import * as os from "os";

/** the machine's name as people see it ("pxl-desktop", not "pxl-desktop.local") */
export function computerHostname(): string {
    return os.hostname().replace(/\.local$/i, "");
}
