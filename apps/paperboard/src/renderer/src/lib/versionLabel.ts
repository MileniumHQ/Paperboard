// Top-left version label. 0.x releases are betas numbered by their minor:
// 0.4.0 -> "Beta 4", 0.4.4 -> "Beta 4.4". From 1.0 on the version shows as
// itself with a zero patch dropped: 1.2.0 -> "1.2", 1.2.2 -> "1.2.2".
// Prerelease tags are not part of the scheme and are ignored.
export function versionLabel(raw: string): string {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
    if (!match) return raw;
    const [major, minor, patch] = match.slice(1).map(Number);
    if (major === 0) return patch ? `Beta ${minor}.${patch}` : `Beta ${minor}`;
    return patch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
}
