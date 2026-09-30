// Top-left version label. 0.x releases are betas numbered by their minor:
// 0.4.0 -> "Beta 4", 0.4.4 -> "Beta 4.4". From 1.0 on the version shows as
// itself with a zero patch dropped: 1.2.0 -> "1.2", 1.2.2 -> "1.2.2".
// A prerelease tag is appended title-cased: 1.3-alpha -> "1.3 Alpha",
// 0.2.0-x2 -> "Beta 2 x2" (words containing digits are left as written).
export function versionLabel(raw: string): string {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?$/.exec(raw.trim());
    if (!match) return raw;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3] ?? 0);
    const base =
        major === 0
            ? patch
                ? `Beta ${minor}.${patch}`
                : `Beta ${minor}`
            : patch
              ? `${major}.${minor}.${patch}`
              : `${major}.${minor}`;
    const tag = (match[4] ?? "")
        .split(/[-.\s]+/)
        .filter(Boolean)
        .map((word) => (/\d/.test(word) ? word : word[0].toUpperCase() + word.slice(1).toLowerCase()))
        .join(" ");
    return tag ? `${base} ${tag}` : base;
}
