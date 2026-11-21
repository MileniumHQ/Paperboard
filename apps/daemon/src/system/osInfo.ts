// What this computer is, as the shell names it: the OS facts the registry
// and sysctl hold are read here, then identity.ts names every layer.
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { identify, liveProbe, parseRegQuery, WINDOWS_BIOS, WINDOWS_CURRENT_VERSION, type ComputerIdentity } from "./identity";
import { logger } from "../core/logger";

const promisifiedExecFile = promisify(execFile);

// These run on the WS auth path, so each answer is cached: the board and
// the hypervisor never change while the daemon runs, and the Windows
// release is read again only when the NT build changes. ASYNC: the child
// never blocks the event loop; concurrent calls share one pending promise.
function cachedBy<T>(read: () => Promise<T>): (key: string) => Promise<T> {
    let held: { key: string; value: Promise<T> } | null = null;
    return (key) => {
        if (held?.key === key) return held.value;
        const value = read();
        held = { key, value };
        // a failed read is tried again next time
        value.catch(() => { if (held?.value === value) held = null; }); // quiet: the caller sees the failure
        return value;
    };
}

async function regQuery(key: string): Promise<Record<string, string>> {
    const out = await promisifiedExecFile("reg", ["query", key], { timeout: 5000, windowsHide: true });
    return parseRegQuery(out.stdout);
}

const windowsCurrentVersion = cachedBy(() => regQuery(WINDOWS_CURRENT_VERSION));
const windowsBios = cachedBy(() => regQuery(WINDOWS_BIOS));
const macVirtual = cachedBy(async () => {
    const out = await promisifiedExecFile("sysctl", ["-n", "kern.hv_vmm_present"], { timeout: 5000 });
    return out.stdout.trim() === "1";
});

// A registry key this computer won't answer leaves its layer out (and
// Windows shows its major only); the log keeps why.
async function readOr<T>(what: string, read: Promise<T>, otherwise: T): Promise<T> {
    try {
        return await read;
    } catch (err) {
        logger.warn(`[osInfo] ${what} is unreadable, so this computer is named without it:`, err);
        return otherwise;
    }
}

export async function getDetailedOsInfo(): Promise<ComputerIdentity> {
    const platform = process.platform;
    const extra: Parameters<typeof liveProbe>[0] = {};
    if (platform === "win32") {
        const build = os.release();
        const [currentVersion, bios] = await Promise.all([
            readOr("The Windows version", windowsCurrentVersion(build), {}),
            readOr("The motherboard", windowsBios("bios"), {}),
        ]);
        extra.registry = { [WINDOWS_CURRENT_VERSION]: currentVersion, [WINDOWS_BIOS]: bios };
    } else if (platform === "darwin") {
        extra.macVirtual = await readOr("Whether this Mac is virtual", macVirtual("vm"), false);
    }
    try {
        return identify(liveProbe(extra));
    } catch (err) {
        // the handshake still names the OS when a layer's facts can't be read
        logger.warn("[osInfo] this computer's identity could not be read, so it shows as its OS only:", err);
        return { os: platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform, osVersion: os.release() };
    }
}
