// How Valheim names a player on its lists, shared by the service and the
// Players tab: a platform id, an underscore between the platform and the
// account ("Steam_76561198000000001"), or for a Steam account the bare number.

const PLATFORM_ID = /^[A-Za-z]{2,16}_[A-Za-z0-9-]{1,64}$/;

/** Whether a value is a platform id as Valheim writes it. */
export const isPlatformId = (value: string): boolean => PLATFORM_ID.test(value);

/** A platform id, or the reason it isn't one. */
export function platformId(value: unknown): string {
    if (typeof value !== "string" || !isPlatformId(value)) throw new Error("Choose a player by their Valheim platform id, as Steam_76561198000000001");
    return value;
}

/** Whether a list entry is this player, as the server matches it: the id, a Steam account's bare number, and with `byName` (the banned list) the name. */
export function entryIs(entry: string, player: { name?: string; id?: string | null }, byName: boolean): boolean {
    if (player.id && (entry === player.id || (player.id.startsWith("Steam_") && entry === player.id.slice("Steam_".length)))) return true;
    return byName && !!player.name && entry === player.name;
}
