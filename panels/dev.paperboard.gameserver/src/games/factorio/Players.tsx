import { createMemo, Show } from "solid-js";
import { PaperBadge, PaperSeparator, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
import GameRoster, { createRosterState, type RosterPlayer } from "../../components/GameRoster";
import { byName } from "../rosterNames";
import PlayerAvatar from "../../components/PlayerAvatar";
import { useServer } from "../../lib/server";

interface Player extends RosterPlayer {
    admin: boolean;
    whitelisted: boolean;
    /** why they were banned, when the ban says */
    reason: string;
}

// Factorio matches names without case, and writes its lists in lower case
const key = (name: string) => name.toLowerCase();

export default function FactorioPlayers() {
    const { calls } = useServer();
    const state = createRosterState(() => calls.factorioPlayers());
    const roster = () => state.roster();

    // players Paperboard saw on, and everyone on a list; a name as a player last
    // showed it wins over the lower case of the lists
    const players = createMemo(() => {
        const r = roster();
        if (!r) return [];
        const byKey = new Map<string, Player>();
        const add = (name: string) => {
            const found = byKey.get(key(name));
            if (found) return found;
            const player: Player = {
                name, online: false, banned: false, admin: false, whitelisted: false, reason: "",
            };
            byKey.set(key(name), player);
            return player;
        };
        for (const p of r.seen) add(p.name).lastSeen = p.lastSeen;
        for (const name of r.online) Object.assign(add(name), { name, online: true });
        for (const name of r.admins) add(name).admin = true;
        for (const name of r.whitelist) add(name).whitelisted = true;
        for (const ban of r.bans) Object.assign(add(ban.name), { banned: true, reason: ban.reason });
        return [...byKey.values()].sort(byName);
    });

    return (
        <GameRoster
            state={state}
            players={players()}
            playerId={(player) => key(player.name)}
            avatar={(player, size) => <PlayerAvatar name={player.name} size={size} />}
            playing={() => "Playing"}
            pickHint="Players appear here once they join, with everyone on the server's admin list, ban list and whitelist. Pick one to kick or ban them, or make them an admin."
            rowBadges={(player) => (
                <Show when={player.admin}>
                    <PaperBadge>Admin</PaperBadge>
                </Show>
            )}
            moderation={{
                kick: (player) => calls.factorioKick({ name: player.name }),
                ban: (player) => calls.factorioBan({ name: player.name }),
                unban: (player) => calls.factorioUnban({ name: player.name }),
                banNote: "Factorio bans the player's username, wherever they join from.",
            }}
            sections={(player) => {
                const admin = state.setting(
                    `admin:${key(player().name)}`,
                    (value) => `${player().name} was not ${value ? "made" : "removed as"} an admin`,
                    () => player().admin,
                    (value) => calls.factorioList({ list: "admins", name: player().name, on: value }),
                );
                const whitelisted = state.setting(
                    `whitelist:${key(player().name)}`,
                    (value) => `${player().name} was not ${value ? "whitelisted" : "taken off the whitelist"}`,
                    () => player().whitelisted,
                    (value) => calls.factorioList({ list: "whitelist", name: player().name, on: value }),
                );
                return (
                    <>
                        <PaperSeparator />
                        <PaperText size={2} weight={700} color="text-subtle">Permissions</PaperText>
                        <PaperSettingList autoHeight>
                            <PaperSettingItem title="Admin" description="Kicks, bans, pauses and runs the server's commands in the game.">
                                <PaperToggle checked={admin.value()} onChange={admin.set} />
                            </PaperSettingItem>
                            <PaperSettingItem
                                title="Whitelisted"
                                description={roster()?.whitelistOn ? "Only whitelisted players can join." : "Whitelist is off in Options, so anyone can join."}
                            >
                                <PaperToggle checked={whitelisted.value()} onChange={whitelisted.set} />
                            </PaperSettingItem>
                        </PaperSettingList>
                    </>
                );
            }}
            details={(player) => (
                <Show when={player().banned && player().reason}>
                    <tr>
                        <th>Ban reason</th>
                        <td>{player().reason}</td>
                    </tr>
                </Show>
            )}
        />
    );
}
