import { packages as packageApi, system } from "@mileniumhq/paperapi";
import { getRequiredJavaVersion } from "../lib/software";
import { isWindowsTarget } from "../lib/platform";

/** The java binary inside a runtime package on the server's computer. */
export function javaBinaryPath(home: string, windows: boolean): string {
    return `${home}/bin/${windows ? "java.exe" : "java"}`;
}

/** Installs the runtime a Minecraft version needs when missing; returns its java. */
export async function ensureJavaFor(mcVersion: string): Promise<{ bin: string; home: string }> {
    const javaPkg = getRequiredJavaVersion(mcVersion);
    if (!javaPkg) throw new Error(`Could not determine the Java runtime for ${mcVersion}`);
    if (!(await packageApi.isInstalled(javaPkg))) {
        await packageApi.download(javaPkg);
    }
    const home = await packageApi.getPath(javaPkg);
    const windows = isWindowsTarget(home, (await system.getInfo()).os);
    return { bin: javaBinaryPath(home, windows), home };
}
