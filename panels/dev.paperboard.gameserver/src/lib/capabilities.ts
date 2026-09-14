import { createMemo } from "solid-js";
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

const mcVersion = createMemo(() => {
    const v = serverVersion();
    return v ? semver.coerce(v) : null;
});

export function supports(capability: CapabilityName): boolean {
    return versionSupports(serverVersion(), capability);
}

// gate for schemas with version requirements outside the registry
export function mcVersionAtLeast(since: string): boolean {
    return mcSatisfies(serverVersion(), { since });
}

export function hasKnownMcVersion(): boolean {
    return mcVersion() !== null;
}
