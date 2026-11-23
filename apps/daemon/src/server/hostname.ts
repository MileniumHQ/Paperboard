import * as os from "os";
import { spawnSync } from "child_process";

/** the machine's name as people see it ("pxl-desktop", not "pxl-desktop.local") */
export function computerHostname(): string {
    return os.hostname().replace(/\.local$/i, "");
}

// a DNS label: letters, digits and hyphens, at most 63 characters, no
// hyphen at either end ("Pxl's Mac" becomes "Pxl-s-Mac")
function dnsLabel(name: string): string {
    return name.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/, "");
}

let mdnsName: string | null | undefined;

/**
 * The name other computers on the network reach this one by, with its
 * `.local`: macOS's LocalHostName (what Bonjour answers for, which is not
 * always the hostname), else the first label of the hostname. Null when the
 * hostname has nothing a DNS label can carry, so the computer is reached by
 * its address alone. Read once: it is advertised for as long as the daemon runs.
 */
export function mdnsHostName(): string | null {
    if (mdnsName !== undefined) return mdnsName;
    let base = "";
    if (process.platform === "darwin") {
        const res = spawnSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8", timeout: 2000 });
        if (res.status === 0) base = res.stdout.trim();
    }
    if (!base) base = computerHostname().split(".")[0] ?? "";
    const label = dnsLabel(base);
    mdnsName = label ? `${label}.local` : null;
    return mdnsName;
}
