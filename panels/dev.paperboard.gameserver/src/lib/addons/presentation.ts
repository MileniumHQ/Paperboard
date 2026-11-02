/** Presentation shared by the Modrinth add-on browsers. */
export function formatCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
}

/** Modrinth version numbers are free text, including both 4.4.4 and v4.4.4. */
export const versionLabel = (version: string) => (/^v\d/i.test(version) ? version : `v${version}`);

/** A size in bytes as people read it: "840 KB", "4.2 MB", "11.8 GB". */
export function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const mb = bytes / (1024 * 1024);
    return mb < 1024 ? `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}
