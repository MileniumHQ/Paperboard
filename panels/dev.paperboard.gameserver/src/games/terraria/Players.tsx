import { createMemo, createSignal } from "solid-js";
import GameRoster, { CopyRow, createRosterState, type RosterPlayer } from "../../components/GameRoster";
import { byName } from "../rosterNames";
import PlayerAvatar from "../../components/PlayerAvatar";
import { onlinePlayerNames, serverBridge } from "../../lib/server";
import type { BanEntry, SeenPlayer } from "./roster";

interface Player extends RosterPlayer {
    address?: string;
}

const key = (name: string) => name.toLowerCase();

export default function TerrariaPlayers() {
    const [seen, setSeen] = createSignal<SeenPlayer[]>([]);
    const [bans, setBans] = createSignal<BanEntry[]>([]);
    const state = createRosterState(async () => {
        const roster = await serverBridge.call<{ seen: SeenPlayer[]; bans: BanEntry[] }>("terraria-players");
        setSeen(roster.seen);
        setBans(roster.bans);
    });
    const act = (action: string) => (player: Player) => serverBridge.call(action, { name: player.name });

    // everyone who has joined, who is online now, or who is banned by name
    const players = createMemo(() => {
        const online = new Set([...onlinePlayerNames()].map(key));
        const banned = new Set(bans().map((ban) => key(ban.name)).filter(Boolean));
        const byKey = new Map<string, Player>();
        for (const p of seen()) byKey.set(key(p.name), { name: p.name, lastSeen: p.lastSeen, address: p.address, online: online.has(key(p.name)), banned: banned.has(key(p.name)) });
        for (const name of onlinePlayerNames()) if (!byKey.has(key(name))) byKey.set(key(name), { name, online: true, banned: banned.has(key(name)) });
        for (const ban of bans()) if (ban.name && !byKey.has(key(ban.name))) byKey.set(key(ban.name), { name: ban.name, address: ban.address, online: online.has(key(ban.name)), banned: true });
        return [...byKey.values()].sort(byName);
    });

    return (
        <GameRoster
            state={state}
            players={players()}
            avatar={(player, size) => <PlayerAvatar name={player.name} size={size} />}
            playing={() => "Playing"}
            pickHint="Players appear here once they join. Pick one to see when they played and to kick or ban them."
            moderation={{
                kick: act("terraria-kick"),
                ban: act("terraria-ban"),
                unban: act("terraria-unban"),
                banNote: "Terraria bans the address a player joins from, so anyone else joining from it is turned away too.",
            }}
            details={(player) => player.address ? <CopyRow label="Address" value={player.address} /> : <tr><th>Address</th><td>Not seen yet</td></tr>}
        />
    );
}
