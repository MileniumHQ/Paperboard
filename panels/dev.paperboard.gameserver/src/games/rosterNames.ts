/** Two players with one name are told apart by their id, except where `keep` says the name stands. */
export function withUniqueNames<T extends { name: string }>(players: readonly T[], id: (player: T) => string, keep?: (player: T) => boolean): T[] {
    const counts = new Map<string, number>();
    for (const player of players) counts.set(player.name, (counts.get(player.name) ?? 0) + 1);
    return players.map((player) => ((counts.get(player.name) ?? 0) > 1 && player.name !== id(player) && !keep?.(player) ? { ...player, name: `${player.name} (${id(player)})` } : player));
}

export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
