import type { GameDefinition } from "./types";

const OS_NAMES: Readonly<Record<string, string>> = { linux: "Linux", win32: "Windows", darwin: "macOS" };
export const osName = (os: string) => OS_NAMES[os] ?? os;

/** "Linux and Windows", "Linux, Windows and macOS". */
function list(names: readonly string[]): string {
    return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A dedicated server's tested computers: the systems and CPUs it runs on natively. */
export function hostRoutes(server: string, routes: { os: readonly string[]; arch: readonly string[] }): GameDefinition["hostSupport"] {
    return ({ os, arch }) => {
        if (!routes.arch.includes(arch)) return { supported: false, reason: `The ${server} only runs on ${list(routes.arch)} computers.` };
        if (!routes.os.includes(os)) return { supported: false, reason: `The ${server} runs on ${list(routes.os.map(osName))}, not ${osName(os)}.` };
        return { supported: true };
    };
}
