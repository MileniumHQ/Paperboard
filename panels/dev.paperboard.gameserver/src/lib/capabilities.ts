import { createMemo } from "solid-js";
import semver from "semver";
import { serverVersion } from "./server";

// Version-dependent facts keyed by capability name; "since"/"until" bound each
export const CAPABILITIES = {
    // Network & status
    enableStatus: { since: "1.16" },
    hideOnlinePlayers: { since: "1.18" },
    rateLimit: { since: "1.16.2" },
    acceptsTransfers: { since: "1.20.5" },

    // Gameplay
    simulationDistance: { since: "1.18" },
    pauseWhenEmpty: { since: "1.21.2" },
    propertyPvp: { until: "1.21.9" },
    propertyAllowNether: { until: "1.21.9" },
    propertySpawnMonsters: { until: "1.21.9" },
    propertyEnableCommandBlock: { until: "1.21.9" },

    // World generation
    legacyLevelTypePresets: { until: "1.19" },
    worldPresetLevelType: { since: "1.19" },

    // Resource pack
    requireResourcePack: { since: "1.17" },
    resourcePackPrompt: { since: "1.17" },
    resourcePackId: { since: "1.20.3" },

    // Admin & misc
    functionPermissionLevel: { since: "1.14.4" },
    syncChunkWrites: { since: "1.16" },
    enforceSecureProfile: { since: "1.19" },
    logIps: { since: "1.20.2" },
    bugReportLink: { since: "1.21" },
    entityBroadcastRange: { since: "1.16" },
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;

const mcVersion = createMemo(() => {
    const v = serverVersion();
    return v ? semver.coerce(v) : null;
});

function satisfiesConstraint(
    constraint: { since?: string; until?: string } | undefined,
    version: semver.SemVer | null,
): boolean {
    if (!constraint || (!constraint.since && !constraint.until)) return true;
    if (!version) return false;

    // Normalize shorthand like "1.18" before semver comparison
    const since = constraint.since ? semver.coerce(constraint.since) : null;
    const until = constraint.until ? semver.coerce(constraint.until) : null;

    if (since && !semver.gte(version, since)) return false;
    if (until && !semver.lt(version, until)) return false;
    return true;
}

export function supports(capability: CapabilityName): boolean {
    return satisfiesConstraint(CAPABILITIES[capability], mcVersion());
}

// Gate for schemas whose version requirements come from outside the registry
export function mcVersionAtLeast(since: string): boolean {
    const version = mcVersion();
    if (!version) return false;
    const target = semver.coerce(since);
    return target ? semver.gte(version, target) : false;
}

export function hasKnownMcVersion(): boolean {
    return mcVersion() !== null;
}
