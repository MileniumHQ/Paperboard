import { GAMERULES, type GameruleEntry } from "../generated/gamerules.generated";
import {
    mcAtLeast,
    canonicalGameruleName,
    canonicalGameruleValue,
    type VersionProfile,
} from "../lib/versionProfile";

// gamerule names and values reach console commands raw (`gamerule ${name}
// ${value}`): validated at the service boundary against the static
// registry, never trusted from config files or UI state.
const GAMERULE_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;
const GAMERULE_VALUE_PATTERN = /^(?:true|false|-?\d{1,10})$/i;

const REGISTRY: ReadonlyMap<string, GameruleEntry> = new Map(GAMERULES.map((r) => [r.name, r]));
const REGISTRY_NAMES: ReadonlySet<string> = new Set(REGISTRY.keys());

/**
 * The rules a server of this version accepts: added at or before it, and
 * not gated behind an experiment (the server answers "Incorrect argument"
 * for those unless the world enabled the experiment). The one list the
 * Game Rules tab, the set-gamerule action and its dropdown all use.
 */
export function gamerulesFor(version: string | null | undefined): GameruleEntry[] {
    return GAMERULES.filter(
        (rule) => !rule.experiment && (!rule.addedIn || mcAtLeast(version, rule.addedIn)),
    );
}

export function isKnownGameruleName(name: unknown): boolean {
    const s = String(name ?? "");
    return GAMERULE_NAME_PATTERN.test(s) && REGISTRY_NAMES.has(s);
}

export function assertGameruleName(name: unknown): string {
    const s = String(name ?? "").trim();
    if (!GAMERULE_NAME_PATTERN.test(s) || !REGISTRY_NAMES.has(s)) {
        throw new Error(`Refusing unknown gamerule: ${JSON.stringify(name)}`);
    }
    return s;
}

const BOOLEAN_VALUE_PATTERN = /^(?:true|false)$/;
const NUMBER_VALUE_PATTERN = /^-?\d{1,10}$/;

/** `name` must already be a registry member (assertGameruleName); the value must fit the rule's type */
export function assertGameruleValue(name: string, value: unknown): string {
    const s = String(value ?? "").trim().toLowerCase();
    if (!GAMERULE_VALUE_PATTERN.test(s)) {
        throw new Error(`Refusing unsafe gamerule value for ${name}: ${JSON.stringify(value)}`);
    }
    const rule = REGISTRY.get(name);
    if (!rule) throw new Error(`Refusing unknown gamerule: ${JSON.stringify(name)}`);
    if (rule.valueType === "boolean" && !BOOLEAN_VALUE_PATTERN.test(s)) {
        throw new Error(`Refusing ${JSON.stringify(value)} for ${name}: it takes true or false`);
    }
    if (rule.valueType === "number" && !NUMBER_VALUE_PATTERN.test(s)) {
        throw new Error(`Refusing ${JSON.stringify(value)} for ${name}: it takes a whole number`);
    }
    return s;
}

// null when the line is not a gamerule readout. Both the query response
// and the write confirmation are accepted (the write confirmation is what
// makes an online edit converge on server truth), in both spellings:
//   up to 26.2  "Gamerule X is currently set to: V" / "... is now set to: V"
//   26.3+       "System chat: Game rule X is currently set to V" On pre-1.21.11
// servers the name and value are translated to the canonical id first, so
// readouts still land on the right rule. Names must be registry members so
// the stored record stays bounded by the registry.
export function parseGameruleValue(
    clean: string,
    profile?: VersionProfile,
): { name: string; value: string } | null {
    const match = clean.match(/Game ?rule ([A-Za-z0-9_]+) is (?:currently|now) set to:? (.+?)\s*$/i);
    if (!match) return null;
    const name = profile
        ? canonicalGameruleName(profile, match[1])
        : match[1];
    if (!isKnownGameruleName(name)) return null;
    const raw = match[2].trim();
    const value = profile ? canonicalGameruleValue(profile, name, raw) : raw;
    return { name, value };
}

// the values record only ever grows by registry-member names parsed from
// gamerule readouts; the cap is a hard bound against a spoofed log stream
export const GAMERULE_VALUES_CAP = 100;

export function mergeGameruleValue(
    prev: Record<string, string>,
    name: string,
    value: string,
): Record<string, string> {
    if (!isKnownGameruleName(name)) return prev;
    const next = { ...prev, [name]: value };
    const keys = Object.keys(next);
    if (keys.length <= GAMERULE_VALUES_CAP) return next;
    for (const stale of keys.slice(0, keys.length - GAMERULE_VALUES_CAP)) {
        delete next[stale];
    }
    return next;
}
