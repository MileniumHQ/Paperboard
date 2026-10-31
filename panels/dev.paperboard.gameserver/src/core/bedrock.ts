// Bedrock players on a crossplay server. Floodgate logs them in without a
// Java account: the uuid is the Xbox account's XUID in the low 64 bits
// (Utils.getJavaUuid: new UUID(0, xuid)), and the name is the gamertag behind
// Floodgate's username prefix, cut to 16 with spaces turned into underscores
// when replace-spaces is on (HandshakeDataImpl). Read from Floodgate 2.2.5.

export interface BedrockNaming {
    /** Floodgate's username-prefix, "." unless changed */
    prefix: string;
    /** Floodgate's replace-spaces */
    replaceSpaces: boolean;
}

const FLOODGATE_UUID_RE = /^00000000-0000-0000-[0-9a-f]{4}-[0-9a-f]{12}$/;
const XUID_RE = /^[1-9][0-9]{0,19}$/;
const MAX_XUID = (1n << 63n) - 1n;

export function isFloodgateUuid(uuid: string): boolean {
    return FLOODGATE_UUID_RE.test(uuid.toLowerCase());
}

/** the uuid Floodgate gives the Xbox account with this XUID */
export function floodgateUuid(xuid: string): string {
    if (!XUID_RE.test(xuid) || BigInt(xuid) > MAX_XUID) throw new Error(`Not an Xbox account id: ${JSON.stringify(xuid)}`);
    const hex = BigInt(xuid).toString(16).padStart(16, "0");
    return `00000000-0000-0000-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** the XUID inside a Floodgate uuid, or null for any other uuid */
export function xuidOfFloodgateUuid(uuid: string): string | null {
    const lower = uuid.toLowerCase();
    if (!FLOODGATE_UUID_RE.test(lower)) return null;
    const xuid = BigInt(`0x${lower.slice(19).replace("-", "")}`);
    return xuid > 0n ? xuid.toString() : null;
}

/**
 * The gamertag a player name stands for, or null when the name is not a
 * Bedrock name (no prefix, or Floodgate is not installed). Underscores are
 * spaces again when Floodgate replaces spaces: gamertags have no underscores.
 */
export function gamertagOf(name: string, naming: BedrockNaming | null): string | null {
    if (!naming || !naming.prefix || !name.startsWith(naming.prefix)) return null;
    const tag = name.slice(naming.prefix.length);
    if (!tag) return null;
    return naming.replaceSpaces ? tag.replace(/_/g, " ") : tag;
}

/** the name Floodgate gives a gamertag on this server */
export function bedrockPlayerName(gamertag: string, naming: BedrockNaming): string {
    const name = naming.prefix + gamertag.slice(0, Math.max(0, 16 - naming.prefix.length));
    return naming.replaceSpaces ? name.replace(/ /g, "_") : name;
}
