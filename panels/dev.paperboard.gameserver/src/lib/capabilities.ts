import semver from "semver";
import { serverVersion } from "./server";
import {
    CAPABILITIES,
    mcSatisfies,
    versionSupports,
    type CapabilityName,
} from "./versionProfile";

// Re-exported so existing UI imports stay put; the table itself lives in
// versionProfile.ts (the single source for version facts).
export { CAPABILITIES };
export type { CapabilityName };

export function supports(capability: CapabilityName): boolean {
    return versionSupports(serverVersion(), capability);
}

// gate for schemas with version requirements outside the registry
export function mcVersionAtLeast(since: string): boolean {
    return mcSatisfies(serverVersion(), { since });
}

export function hasKnownMcVersion(): boolean {
    const version = serverVersion();
    return Boolean(version) && semver.coerce(version) !== null;
}
