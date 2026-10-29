/** Presentation shared by the Modrinth add-on browsers. */
export function formatCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
}

/** Modrinth version numbers are free text, including both 4.4.4 and v4.4.4. */
export const versionLabel = (version: string) => (/^v\d/i.test(version) ? version : `v${version}`);
