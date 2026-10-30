// Shared by Forge and NeoForge: both ship the same installer lineage.

/** `java -jar <installer> --installServer <dir>`: installs a server into dir. */
export function forgeInstallerArgs(installerJar: string, outputDir: string): string[] {
    return ["-jar", installerJar, "--installServer", outputDir];
}

export function compareNumeric(a: readonly number[], b: readonly number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/** "1.21.1" -> [1, 21, 1]; null for anything that is not a dotted release id. */
export function releaseParts(version: string): number[] | null {
    if (!/^\d+(\.\d+){1,2}$/.test(version)) return null;
    return version.split(".").map(Number);
}
