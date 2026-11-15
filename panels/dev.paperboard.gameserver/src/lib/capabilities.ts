import semver from "semver";

/** a version the version facts can place, so its version-gated fields can be offered */
export function hasKnownMcVersion(version: string): boolean {
    return Boolean(version) && semver.coerce(version) !== null;
}
