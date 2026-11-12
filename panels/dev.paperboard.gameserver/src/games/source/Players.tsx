import { createMemo, createSignal, Show } from "solid-js";
import {
    PaperBadge,
    PaperGrid,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperStatTile,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import GameRoster, { CopyRow, createRosterState, type RosterPlayer } from "../../components/GameRoster";
import { byName, withUniqueNames } from "../rosterNames";
import PlayerAvatar from "../../components/PlayerAvatar";
import { serverBridge } from "../../lib/server";
import { sourceCalls, type SourceGameSpec } from "./index";
import { noStats, type SourceBan, type SourceSeen, type SourceStats } from "./roster";
import type { SourceOnline } from "./service";

interface Player extends RosterPlayer {
    /** what tells two players apart, even when they share a name */
    key: string;
    steamId: string;
    bot: boolean;
    userId?: number;
    /** "Red", "Blue", "Spectator"; empty before they pick one */
    team?: string;
    /** "Medic", once they have picked a class */
    role?: string;
    /** a person's totals across visits; a bot's since it joined */
    stats: SourceStats;
    since?: number;
}

export default function SourcePlayers(props: { spec: SourceGameSpec }) {
    const ids = sourceCalls(props.spec.id);
    const [seen, setSeen] = createSignal<SourceSeen[]>([]);
    const [bans, setBans] = createSignal<SourceBan[]>([]);
    const [online, setOnline] = createSignal<SourceOnline[]>([]);
    /** Steam ids SourceMod makes admins; null while SourceMod is off */
    const [admins, setAdmins] = createSignal<string[] | null>(null);
    const state = createRosterState(async () => {
        const roster = await serverBridge.call<{ seen: SourceSeen[]; bans: SourceBan[]; online: SourceOnline[]; admins: string[] | null }>(ids.players);
        setSeen(roster.seen);
        setBans(roster.bans);
        setOnline(roster.online);
        setAdmins(roster.admins);
    });

    // a clash between names gets the Steam id
    const players = createMemo(() => {
        const byKey = new Map<string, Player>();
        const banned = new Set(bans().map((b) => b.steamId));
        for (const p of seen()) byKey.set(p.steamId, { name: p.name, key: p.steamId, steamId: p.steamId, bot: false, stats: { ...noStats(), ...p }, lastSeen: p.lastSeen, online: false, banned: banned.has(p.steamId) });
        for (const p of online()) {
            const bot = p.steamId === "BOT";
            const key = bot ? `bot-${p.userId}` : p.steamId;
            const stats = bot ? p.stats : byKey.get(key)?.stats ?? noStats();
            byKey.set(key, { name: p.name, key, steamId: p.steamId, bot, userId: p.userId, team: p.team && p.team !== "Unassigned" ? p.team : undefined, role: roleName(props.spec, p.role), stats, since: p.since, lastSeen: Date.now(), online: true, banned: banned.has(p.steamId) });
        }
        for (const b of bans()) if (!byKey.has(b.steamId)) byKey.set(b.steamId, { name: b.name, key: b.steamId, steamId: b.steamId, bot: false, stats: noStats(), online: false, banned: true });
        return withUniqueNames([...byKey.values()], (p) => p.steamId, (p) => p.bot).sort(byName);
    });

    return (
        <GameRoster
            state={state}
            players={players()}
            playerId={(player) => player.key}
            searchTerms={(player) => [player.steamId]}
            avatar={(player, size) => <PlayerAvatar name={player.name} size={size} bot={player.bot} />}
            playing={(player) => [player.team, player.role, player.bot ? "Bot" : `Playing for ${duration(player.since)}`].filter(Boolean).join(" · ")}
            pickHint="Players appear here once they join. Pick one to see their stats, or to kick or ban them."
            badges={(player) => (
                <>
                    <Show when={player.team}>
                        <PaperBadge>{player.team}</PaperBadge>
                    </Show>
                    <Show when={player.role}>
                        <PaperBadge>{player.role}</PaperBadge>
                    </Show>
                    <Show when={player.bot}>
                        <PaperBadge>Bot</PaperBadge>
                    </Show>
                </>
            )}
            moderation={{
                kick: (player) => serverBridge.call(ids.kick, { userId: player.userId }),
                ban: (player) => serverBridge.call(ids.ban, { steamId: player.steamId }),
                unban: (player) => serverBridge.call(ids.unban, { steamId: player.steamId }),
                banNote: "The ban is on their Steam account, wherever they join from.",
                canBan: (player) => !player.bot,
            }}
            sections={(player) => (
                <>
                    <PaperSeparator />

                    <PaperText size={2} weight={700} color="text-subtle">{player.bot ? "Since joining" : "Stats"}</PaperText>
                    <PaperGrid min="field">
                        <PaperStatTile icon="swords" label="Kills" value={player.stats.kills.toLocaleString()} tone="success" />
                        <PaperStatTile icon="skull" label="Deaths" value={player.stats.deaths.toLocaleString()} tone="danger" />
                        <PaperStatTile icon="handshake" label="Assists" value={player.stats.assists.toLocaleString()} />
                        <PaperStatTile icon="military_tech" label="Dominations" value={player.stats.dominations.toLocaleString()} tone="warning" />
                        <Show when={!player.bot}>
                            <PaperStatTile icon="schedule" label="Total playtime" value={playtime(player.stats.playtime)} />
                        </Show>
                    </PaperGrid>

                    <Show when={!player.bot && admins()}>
                        {(list) => (
                            <>
                                <PaperSeparator />

                                <PaperText size={2} weight={700} color="text-subtle">Permissions</PaperText>
                                <PaperSettingList autoHeight>
                                    <PaperSettingItem title="SourceMod admin" description="Every SourceMod admin command, in chat or the console, and immunity from other admins.">
                                        <PaperToggle
                                            checked={list().includes(player.steamId)}
                                            disabled={state.busy()}
                                            onChange={(checked) => void state.run(`${player.name} was not ${checked ? "made" : "removed as"} an admin`, () => serverBridge.call(ids.admin, { steamId: player.steamId, admin: checked }))}
                                        />
                                    </PaperSettingItem>
                                </PaperSettingList>
                            </>
                        )}
                    </Show>
                </>
            )}
            hasDetails={(player) => !player.bot}
            details={(player) => <CopyRow label="Steam id" value={player.steamId} />}
        />
    );
}

/** A class as the log names it ("heavyweapons") in the game's own words. */
function roleName(spec: SourceGameSpec, role: string | undefined): string | undefined {
    if (!role) return undefined;
    return spec.roleNames?.[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}
function playtime(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
function duration(since: number | undefined): string {
    const minutes = since ? Math.max(0, Math.floor((Date.now() - since) / 60_000)) : 0;
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
