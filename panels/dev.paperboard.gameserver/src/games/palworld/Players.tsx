import { createMemo, Show } from "solid-js";
import GameRoster, { CopyRow, createRosterState, type RosterPlayer } from "../../components/GameRoster";
import { byName, withUniqueNames } from "../rosterNames";
import PlayerAvatar from "../../components/PlayerAvatar";
import { serverBridge } from "../../lib/server";
import type { PalworldSeen } from "./roster";
import type { PalworldPlayer } from "./rest";

interface Player extends RosterPlayer {
    userId: string;
    level?: number;
    ping?: number;
}

export default function PalworldPlayers() {
    const state = createRosterState(() => serverBridge.call<{ seen: PalworldSeen[]; bans: string[]; online: PalworldPlayer[] }>("palworld-players"));
    const seen = () => state.roster()?.seen ?? [];
    const bans = () => state.roster()?.bans ?? [];
    const online = () => state.roster()?.online ?? [];
    const act = (action: string) => (player: Player) => serverBridge.call(action, { userId: player.userId });

    // Palworld names need not be unique, so a clash gets the user id
    const players = createMemo(() => {
        const byId = new Map<string, Player>();
        const banned = new Set(bans());
        for (const p of seen()) byId.set(p.userId, { name: p.name, userId: p.userId, level: p.level, lastSeen: p.lastSeen, online: false, banned: banned.has(p.userId) });
        for (const p of online()) byId.set(p.userId, { name: p.name, userId: p.userId, level: p.level, ping: p.ping, lastSeen: byId.get(p.userId)?.lastSeen, online: true, banned: banned.has(p.userId) });
        for (const id of bans()) if (!byId.has(id)) byId.set(id, { name: id, userId: id, online: false, banned: true });
        return withUniqueNames([...byId.values()], (p) => p.userId).sort(byName);
    });

    return (
        <GameRoster
            state={state}
            players={players()}
            playerId={(player) => player.userId}
            searchTerms={(player) => [player.userId]}
            avatar={(player, size) => <PlayerAvatar name={player.name} size={size} />}
            playing={(player) => `Playing · level ${player.level ?? 0}`}
            pickHint="Players appear here once they join. Pick one to see their level and to kick or ban them."
            moderation={{
                kick: act("palworld-kick"),
                ban: act("palworld-ban"),
                unban: act("palworld-unban"),
                banNote: "Palworld bans the player's account, wherever they join from.",
                needsServer: "Start the server to ban or unban. Palworld keeps its own ban list.",
            }}
            details={(player) => (
                <>
                    <Show when={player().level !== undefined}>
                        <tr><th>Level</th><td>{player().level}</td></tr>
                    </Show>
                    <Show when={player().online && player().ping !== undefined}>
                        <tr><th>Ping</th><td>{Math.round(player().ping!)} ms</td></tr>
                    </Show>
                    <CopyRow label="User id" value={player().userId} />
                </>
            )}
        />
    );
}
