import { createMemo, Show } from "solid-js";
import { PaperBadge, PaperSeparator, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
import GameRoster, { CopyRow, createRosterState, type RosterPlayer } from "../../components/GameRoster";
import { byName, withUniqueNames } from "../rosterNames";
import PlayerAvatar from "../../components/PlayerAvatar";
import PlayerPicturesFailure from "../../components/PlayerPicturesFailure";
import { createSteamPictures } from "../../lib/steamAvatars";
import { useServer } from "../../lib/server";
import { entryIs, isPlatformId } from "./ids";

interface Player extends RosterPlayer {
    /** the platform id ("Steam_7656…"); null for a name only the ban list holds */
    id: string | null;
    admin: boolean;
    permitted: boolean;
}

const asPlatformId = (entry: string) => (/^\d{17}$/.test(entry) ? `Steam_${entry}` : isPlatformId(entry) ? entry : null);

export default function ValheimPlayers() {
    const { calls } = useServer();
    const state = createRosterState(() => calls.valheimPlayers());
    const pictures = createSteamPictures();
    const roster = () => state.roster();

    // players Paperboard saw join, and every entry on a list that is someone else
    const players = createMemo(() => {
        const r = roster();
        if (!r) return [];
        const byId = new Map<string, Player>();
        const status = (p: { name: string; id: string | null }) => ({
            banned: r.banned.some((e) => entryIs(e, p, true)),
            admin: r.admin.some((e) => entryIs(e, p, false)),
            permitted: r.permitted.some((e) => entryIs(e, p, false)),
        });
        for (const p of r.seen) byId.set(p.id, { name: p.name, id: p.id, lastSeen: p.lastSeen, online: false, ...status({ name: p.name, id: p.id }) });
        for (const p of r.online) byId.set(p.id, { name: p.name, id: p.id, lastSeen: byId.get(p.id)?.lastSeen, online: true, ...status({ name: p.name, id: p.id }) });
        const known = [...byId.values()];
        for (const entry of [...r.admin, ...r.permitted, ...r.banned]) {
            if (known.some((p) => entryIs(entry, p, r.banned.includes(entry)))) continue;
            const id = asPlatformId(entry);
            const key = id ?? `name:${entry}`;
            if (byId.has(key)) continue;
            const player = { name: entry, id };
            byId.set(key, { ...player, online: false, ...status(player) });
        }
        return withUniqueNames([...byId.values()], (p) => p.id ?? p.name).sort(byName);
    });

    const list = (player: Player) => ({ id: player.id, name: player.id === null ? player.name : null });

    return (
        <GameRoster
            state={state}
            players={players()}
            playerId={(player) => player.id ?? `name:${player.name}`}
            searchTerms={(player) => (player.id ? [player.id] : [])}
            avatar={(player, size) => <PlayerAvatar name={player.name} size={size} picture={player.id ? pictures.of(player.id, size) : undefined} />}
            notice={<PlayerPicturesFailure pictures={pictures} />}
            playing={() => "Playing"}
            pickHint="Players appear here once they join, with everyone on the server's admin, banned and permitted lists. Pick one to ban them or make them an admin."
            rowBadges={(player) => (
                <Show when={player.admin}>
                    <PaperBadge>Admin</PaperBadge>
                </Show>
            )}
            moderation={{
                ban: (player) => calls.valheimList({ list: "banned", ...list(player), on: true }),
                unban: (player) => calls.valheimList({ list: "banned", ...list(player), on: false }),
                banNote: "Valheim bans the player's account, wherever they join from.",
                // the server reads its lists again within ten seconds, and checks for banned players every five
                removal: "An online player is removed within about 15 seconds.",
            }}
            sections={(player) => (
                <>
                    <PaperSeparator />
                    <PaperText size={2} weight={700} color="text-subtle">Permissions</PaperText>
                    <Show
                        when={player().id}
                        fallback={<PaperText size={2} color="text-subtle">Valheim lists admins and permitted players by their platform id, which this ban holds only the name of.</PaperText>}
                    >
                        {(id) => {
                            const admin = state.setting(
                                `admin:${id()}`,
                                (value) => `${player().name} was not ${value ? "made" : "removed as"} an admin`,
                                () => player().admin,
                                (value) => calls.valheimList({ list: "admin", id: id(), name: null, on: value }),
                            );
                            const permitted = state.setting(
                                `permitted:${id()}`,
                                (value) => `${player().name} was not ${value ? "permitted" : "taken off the permitted list"}`,
                                () => player().permitted,
                                (value) => calls.valheimList({ list: "permitted", id: id(), name: null, on: value }),
                            );
                            return (
                                <PaperSettingList autoHeight>
                                    <PaperSettingItem title="Admin" description="Valheim's admin console in the game: kick, ban, and the rest of its commands.">
                                        <PaperToggle checked={admin.value()} onChange={admin.set} />
                                    </PaperSettingItem>
                                    <PaperSettingItem title="Permitted" description="Once anyone is permitted, only permitted players can join.">
                                        <PaperToggle checked={permitted.value()} onChange={permitted.set} />
                                    </PaperSettingItem>
                                </PaperSettingList>
                            );
                        }}
                    </Show>
                </>
            )}
            hasDetails={(player) => player.id !== null}
            details={(player) => <CopyRow label="Platform id" value={player().id!} />}
        />
    );
}
