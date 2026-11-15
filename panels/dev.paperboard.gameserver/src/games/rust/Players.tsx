import { createMemo, Show } from "solid-js";
import GameRoster, { CopyRow, createRosterState, type RosterPlayer } from "../../components/GameRoster";
import { byName, withUniqueNames } from "../rosterNames";
import PlayerAvatar from "../../components/PlayerAvatar";
import { durationLabel } from "../../core/format";
import type { RustBan, RustSeen } from "./roster";
import type { RustPlayer } from "./webrcon";
import { useServer } from "../../lib/server";

interface Player extends RosterPlayer {
    steamId: string;
    ping?: number;
    /** seconds since they connected */
    connected?: number;
    /** why they were banned, as the ban says */
    reason?: string;
}

export default function RustPlayers() {
    const { calls } = useServer();
    const state = createRosterState(() => calls.rustPlayers());
    const seen = () => state.roster()?.seen ?? [];
    const bans = () => state.roster()?.bans ?? [];
    const online = () => state.roster()?.online ?? [];

    // Rust names need not be unique, so a clash gets the Steam id
    const players = createMemo(() => {
        const byId = new Map<string, Player>();
        const banned = new Map(bans().map((ban) => [ban.steamId, ban]));
        for (const p of seen()) byId.set(p.steamId, { name: p.name, steamId: p.steamId, lastSeen: p.lastSeen, online: false, banned: banned.has(p.steamId), reason: banned.get(p.steamId)?.reason });
        for (const p of online()) byId.set(p.steamId, { name: p.name, steamId: p.steamId, ping: p.ping, connected: p.connected, lastSeen: byId.get(p.steamId)?.lastSeen, online: true, banned: banned.has(p.steamId), reason: banned.get(p.steamId)?.reason });
        for (const ban of bans()) if (!byId.has(ban.steamId)) byId.set(ban.steamId, { name: ban.name || ban.steamId, steamId: ban.steamId, online: false, banned: true, reason: ban.reason });
        return withUniqueNames([...byId.values()], (p) => p.steamId).sort(byName);
    });

    return (
        <GameRoster
            state={state}
            players={players()}
            playerId={(player) => player.steamId}
            searchTerms={(player) => [player.steamId]}
            avatar={(player, size) => <PlayerAvatar name={player.name} size={size} />}
            playing={(player) => (player.connected !== undefined ? `Playing · on for ${durationLabel(player.connected)}` : "Playing")}
            pickHint="Players appear here once they join. Pick one to see their Steam id and to kick or ban them."
            moderation={{
                kick: (player) => calls.rustKick({ steamId: player.steamId }),
                ban: (player) => calls.rustBan({ steamId: player.steamId }),
                unban: (player) => calls.rustUnban({ steamId: player.steamId }),
                banNote: "Rust bans the player's Steam account, wherever they join from.",
                needsServer: "Start the server to ban or unban. Rust keeps its own ban list.",
            }}
            details={(player) => (
                <>
                    <Show when={player().online && player().ping !== undefined}>
                        <tr><th>Ping</th><td>{Math.round(player().ping!)} ms</td></tr>
                    </Show>
                    <Show when={player().banned && player().reason}>
                        <tr><th>Ban reason</th><td>{player().reason}</td></tr>
                    </Show>
                    <CopyRow label="Steam id" value={player().steamId} />
                </>
            )}
        />
    );
}
