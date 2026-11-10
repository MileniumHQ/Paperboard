import { PANEL_ID } from "../service/types";
import { createSignal, createEffect, For, onCleanup, onMount, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperCopyButton,
    PaperEmptyState,
    PaperFlex,
    PaperGrid,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperPageHeader,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSelector,
    PaperSelectorItem,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperStatTile,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    loadPlayerStats,
    onlinePlayerNames,
    playerStats,
    playerStatSummaries,
    queryOnlinePlayers,
    queryPlayerStats,
    seenPlayerNames,
    serverBridge,
    serverStatus,
} from "../lib/server";
import { ACTION_IDS, type ActionId } from "../service/contract";
import { JAVA_NAME_PATTERN, PLAYER_NAME_PATTERN } from "../core/players";
import { bedrockPlayerName, gamertagOf, isFloodgateUuid, type BedrockNaming } from "../core/bedrock";
import PlayerHead from "./PlayerHead";
import PlayerRoster, { statusColor } from "./PlayerRoster";
import { errorMessage, type Outcome } from "../lib/failure";

const LIST_POLL_MS = 15000;
const STATS_POLL_MS = 30000;

interface PlayerInfo {
    name: string;
    uuid?: string;
    whitelisted: boolean;
    op: boolean;
}

/** service/playerLists.ts RosterEntry */
interface RosterEntry extends PlayerInfo {
    uuid: string;
    banned: boolean;
}

function isOnline(): boolean {
    return serverStatus() === "online";
}

// a running server takes op and whitelist through its console, a stopped
// one has its files edited; only a server between the two must wait
function canEditLists(): boolean {
    const status = serverStatus();
    return status === "online" || status === "starting" || status === "offline";
}

/** a Bedrock player: a Floodgate uuid, or a name with Floodgate's prefix */
function isBedrockPlayer(player: PlayerInfo, naming: BedrockNaming | null): boolean {
    return (player.uuid !== undefined && isFloodgateUuid(player.uuid)) || gamertagOf(player.name, naming) !== null;
}

function formatPlaytime(seconds: number | undefined): string {
    if (seconds === undefined) return "unknown";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDistance(cm: number): string {
    const meters = cm / 100;
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
}

type SortKey =
    | "name"
    | "playtime"
    | "deaths"
    | "mobKills"
    | "playerKills"
    | "blocksMined"
    | "distance";

const SORT_LABELS: Record<SortKey, string> = {
    name: "Name",
    playtime: "Playtime",
    deaths: "Deaths",
    mobKills: "Mob kills",
    playerKills: "Player kills",
    blocksMined: "Blocks mined",
    distance: "Distance",
};

export default function Players() {
    const [players, setPlayers] = createSignal<PlayerInfo[]>([]);
    const [bannedNames, setBannedNames] = createSignal<Set<string>>(new Set());
    // the names players have now, by uuid: a renamed player is shown by
    // their new name even before they rejoin
    const [currentNames, setCurrentNames] = createSignal<Map<string, string>>(new Map());
    const requestedNames = new Set<string>();
    const [showOnline, setShowOnline] = createSignal(true);
    const [showWhitelisted, setShowWhitelisted] = createSignal(true);
    const [showOp, setShowOp] = createSignal(true);
    const [searchQuery, setSearchQuery] = createSignal("");
    const [openPlayerName, setOpenPlayerName] = createSignal<string | undefined>();

    const [actionModal, setActionModal] = createSignal<"kick" | "ban" | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
    const [whitelistOpen, setWhitelistOpen] = createSignal(false);
    const [whitelistName, setWhitelistName] = createSignal("");
    const [whitelistError, setWhitelistError] = createSignal("");
    const [whitelistEdition, setWhitelistEdition] = createSignal<"java" | "bedrock">("java");
    const [feedback, setFeedback] = createSignal<Outcome | undefined>();
    const [sortBy, setSortBy] = createSignal<SortKey>("playtime");
    // how Floodgate names Bedrock players; null without crossplay
    const [bedrock, setBedrock] = createSignal<BedrockNaming | null>(null);

    // re-verify ban state after a written command; tracked so unmount clears it
    let banRecheckTimer: ReturnType<typeof setTimeout> | null = null;

    const nameOf = (player: PlayerInfo) =>
        (player.uuid && currentNames().get(player.uuid.toLowerCase())) || player.name;

    // rows keep their objects (PlayerRoster rebuilds a row whose object
    // changes), so a new name replaces only the renamed player's entry
    const withCurrentNames = (list: PlayerInfo[]) =>
        list.map((p) => (nameOf(p) === p.name ? p : { ...p, name: nameOf(p) }));

    // asks Mojang (through the service) once per uuid per visit; the
    // service caches answers for an hour
    const refreshNames = (uuids: string[]) => {
        const wanted = uuids.map((u) => u.toLowerCase()).filter((u) => !requestedNames.has(u));
        if (wanted.length === 0) return;
        for (const uuid of wanted) requestedNames.add(uuid);
        serverBridge
            .call<Record<string, string>>(ACTION_IDS.currentPlayerNames, { uuids: wanted })
            .then((names) => {
                const entries = Object.entries(names ?? {});
                if (entries.length === 0) return;
                // keep the open player open under their new name
                const open = openPlayer();
                setCurrentNames((prev) => {
                    const next = new Map(prev);
                    for (const [uuid, name] of entries) next.set(uuid.toLowerCase(), name);
                    return next;
                });
                // a ban is shown by name: carry it over to the new one
                const renamed = players().filter((p) => p.uuid && names[p.uuid.toLowerCase()]);
                setBannedNames((prev) => {
                    const next = new Set(prev);
                    for (const p of renamed) {
                        if (!next.delete(p.name.toLowerCase())) continue;
                        next.add(names[p.uuid!.toLowerCase()].toLowerCase());
                    }
                    return next;
                });
                setPlayers(withCurrentNames);
                if (open?.uuid && names[open.uuid.toLowerCase()]) {
                    setOpenPlayerName(names[open.uuid.toLowerCase()]);
                }
            })
            .catch((err) => {
                console.error("[Players] current-player-names failed:", err);
                setFeedback({ title: "Player names not updated", message: errorMessage(err) });
            });
    };

    // whitelist, operators and bans, by uuid, from the service; the files
    // are the truth, so this runs again after anything that changes them
    const loadRoster = async (): Promise<void> => {
        try {
            const roster = (await serverBridge.call<RosterEntry[]>(ACTION_IDS.listRoster)) ?? [];
            const listed = withCurrentNames(roster.map(({ banned: _banned, ...player }) => player));
            setPlayers(listed);
            setBannedNames(new Set(listed.filter((_, i) => roster[i].banned).map((p) => p.name.toLowerCase())));
            refreshNames(roster.map((p) => p.uuid));
        } catch (err) {
            console.error("[Players] list-roster failed:", err);
            setFeedback({ title: "Players not loaded", message: errorMessage(err) });
        }
    };

    // offline stats from the world's files; a failed read says why instead
    // of leaving the last numbers (or none) looking current
    const reloadStats = () =>
        loadPlayerStats().catch((err) => {
            console.error("[Players] list-player-stats failed:", err);
            setFeedback({ title: "Player stats not loaded", message: errorMessage(err) });
        });

    onMount(() => {
        queryOnlinePlayers();
        void reloadStats();
        const poll = setInterval(queryOnlinePlayers, LIST_POLL_MS);
        const statsPoll = setInterval(() => void reloadStats(), STATS_POLL_MS);
        onCleanup(() => {
            clearInterval(poll);
            clearInterval(statsPoll);
            if (banRecheckTimer) clearTimeout(banRecheckTimer);
        });
        void loadRoster();
        serverBridge
            .call<BedrockNaming | null>(ACTION_IDS.readBedrockNaming)
            .then((naming) => setBedrock(naming ?? null))
            .catch((err) => {
                console.error("[Players] read-bedrock-naming failed:", err);
                setFeedback({ title: "Bedrock names not read", message: errorMessage(err) });
            });
    });

    // players known only from their stats files get current names too
    createEffect(() => refreshNames([...playerStatSummaries().keys()]));

    // the roster is the server's lists plus everyone with data in this
    // world, one row per uuid; usercache.json is only a name book (the
    // server keeps writing it back), so a player whose data was deleted
    // and who is on no list is gone for good
    const allPlayers = () => {
        const byUuid = new Map<string, PlayerInfo>();
        const known: PlayerInfo[] = [];
        for (const player of players()) {
            known.push(player);
            if (player.uuid) byUuid.set(player.uuid.toLowerCase(), player);
        }
        for (const summary of playerStatSummaries().values()) {
            const uuid = summary.uuid.toLowerCase();
            if (byUuid.has(uuid)) continue;
            const entry = { name: summary.name, uuid, whitelisted: false, op: false };
            entry.name = nameOf(entry);
            byUuid.set(uuid, entry);
            known.push(entry);
        }
        // online and recently seen players not on file yet (their first
        // session has not been saved)
        const listed = new Set(known.map((p) => p.name.toLowerCase()));
        for (const name of [...seenPlayerNames(), ...onlinePlayerNames()]) {
            if (listed.has(name)) continue;
            listed.add(name);
            known.push({ name, whitelisted: false, op: false });
        }
        return known;
    };

    // Unflagged players are always shown so offline ones don't vanish
    const visiblePlayers = () => {
        const online = onlinePlayerNames();
        const query = searchQuery().trim().toLowerCase();
        return allPlayers().filter((player) => {
            if (query && !player.name.toLowerCase().includes(query)) return false;
            const key = player.name.toLowerCase();
            const isOn = online.has(key);
            if (isOn && showOnline()) return true;
            if (player.whitelisted && showWhitelisted()) return true;
            if (player.op && showOp()) return true;
            return !isOn && !player.whitelisted && !player.op;
        });
    };

    // offline stats come from the world's stats/<uuid>.json (loaded on mount
    // and by a slow poll); a missing entry is just "no data", never a zero
    const offlineStats = (player: PlayerInfo) =>
        player.uuid ? playerStatSummaries().get(player.uuid.toLowerCase()) : undefined;

    const statNumber = (player: PlayerInfo, key: SortKey): number => {
        const stats = offlineStats(player);
        switch (key) {
            case "playtime":
                return stats
                    ? stats.playTimeTicks
                    : (getPlayerPlaytimeSeconds(player.name) ?? 0) * 20;
            case "deaths":
                return stats?.deaths ?? 0;
            case "mobKills":
                return stats?.mobKills ?? 0;
            case "playerKills":
                return stats?.playerKills ?? 0;
            case "blocksMined":
                return stats?.blocksMined ?? 0;
            case "distance":
                return stats?.distanceCm ?? 0;
            default:
                return 0;
        }
    };

    const statText = (player: PlayerInfo, key: SortKey): string => {
        const stats = offlineStats(player);
        switch (key) {
            case "playtime":
                return formatPlaytime(
                    stats
                        ? Math.floor(stats.playTimeTicks / 20)
                        : getPlayerPlaytimeSeconds(player.name),
                );
            case "deaths":
                return `${stats?.deaths ?? 0}`;
            case "mobKills":
                return `${stats?.mobKills ?? 0}`;
            case "playerKills":
                return `${stats?.playerKills ?? 0}`;
            case "blocksMined":
                return `${stats?.blocksMined ?? 0}`;
            case "distance":
                return formatDistance(stats?.distanceCm ?? 0);
            default:
                return "";
        }
    };

    // leaderboard: highest first for stats, alphabetical for names
    const sortedPlayers = () => {
        const key = sortBy();
        const list = visiblePlayers().slice();
        if (key === "name") {
            list.sort((a, b) => a.name.localeCompare(b.name));
            return list;
        }
        list.sort((a, b) => statNumber(b, key) - statNumber(a, key));
        return list;
    };

    const isPlayerOn = (name: string) => onlinePlayerNames().has(name.toLowerCase());
    const onlineSorted = () => sortedPlayers().filter((p) => isPlayerOn(p.name));
    const offlineSorted = () => sortedPlayers().filter((p) => !isPlayerOn(p.name));

    const openPlayer = () => allPlayers().find((p) => p.name === openPlayerName());
    const openIsBanned = () =>
        bannedNames().has((openPlayer()?.name ?? "").toLowerCase());

    const onlineCount = () => allPlayers().filter((p) => isPlayerOn(p.name)).length;
    const whitelistedCount = () => players().filter((p) => p.whitelisted).length;
    const opCount = () => players().filter((p) => p.op).length;

    // Player name validation is UI feedback only — the real boundary is the
    // service (assertPlayerName on every player action). The UI never
    // composes console commands from raw values anymore; every player
    // mutation is a named, validated service action.
    const callPlayerAction = async (
        actionId: ActionId,
        playerName: string,
        failure: string,
        extra?: Record<string, unknown>,
    ): Promise<boolean> => {
        try {
            await serverBridge.call(actionId, { player: playerName, ...extra });
            setFeedback(undefined);
            return true;
        } catch (err) {
            console.error(`[Players] ${actionId} failed for "${playerName}":`, err);
            setFeedback({ title: `${playerName} was not ${failure}`, message: errorMessage(err) });
            return false;
        }
    };

    const togglePlayerFlag = async (
        playerName: string,
        field: "op" | "whitelisted",
        value: boolean,
    ) => {
        const actionId: ActionId =
            field === "op"
                ? value ? ACTION_IDS.opPlayer : ACTION_IDS.deopPlayer
                : value ? ACTION_IDS.whitelistPlayer : ACTION_IDS.unwhitelistPlayer;
        const failure = field === "op" ? (value ? "made an operator" : "removed as an operator") : value ? "whitelisted" : "removed from the whitelist";
        const uuid = allPlayers().find((p) => p.name === playerName)?.uuid;
        const ok = await callPlayerAction(actionId, playerName, failure, { uuid });
        if (!ok) return; // state stays as the server reports it
        // a stopped server's files were edited in place: read them back.
        // A running one writes them a moment after the command, so the
        // change is echoed instead
        if (serverStatus() === "offline") {
            await loadRoster();
            return;
        }
        setPlayers((prev) =>
            prev.map((p) =>
                p.name.toLowerCase() === playerName.toLowerCase()
                    ? { ...p, [field]: value }
                    : p,
            ),
        );
    };

    const setPlayerBanned = (playerName: string, banned: boolean, reason?: string): Promise<boolean> => {
        const result = banned
            ? callPlayerAction(ACTION_IDS.banPlayer, playerName, "banned", { reason })
            : callPlayerAction(ACTION_IDS.pardonPlayer, playerName, "pardoned");
        // a written console command is not ban-truth: re-verify from the
        // ban file after a delay so the UI's ban state converges on what
        // the server actually recorded
        if (banRecheckTimer) clearTimeout(banRecheckTimer);
        banRecheckTimer = setTimeout(() => void loadRoster(), 1500);
        return result;
    };

    const kickPlayer = (playerName: string, reason?: string): Promise<boolean> =>
        callPlayerAction(ACTION_IDS.kickPlayer, playerName, "kicked", { reason });

    const killPlayer = (playerName: string): Promise<boolean> =>
        callPlayerAction(ACTION_IDS.killPlayer, playerName, "killed");

    // whitelist a name that may not be on the roster yet (a player who has
    // not joined). A gamertag becomes the name Floodgate gives it here. The
    // service validates the name again; these checks are only so the field
    // can explain itself before the round trip.
    const whitelistNewPlayer = async () => {
        const typed = whitelistName().trim();
        if (!typed) return;
        const naming = bedrock();
        let name = typed;
        if (naming && whitelistEdition() === "bedrock") {
            // a pasted Floodgate name already carries the prefix
            const gamertag = typed.startsWith(naming.prefix) ? typed.slice(naming.prefix.length) : typed;
            name = bedrockPlayerName(gamertag, naming);
            if (!gamertag || !PLAYER_NAME_PATTERN.test(name)) {
                setWhitelistError("Gamertags are letters, numbers and spaces.");
                return;
            }
        } else if (!JAVA_NAME_PATTERN.test(name)) {
            setWhitelistError("Usernames are 1–16 letters, numbers or underscores.");
            return;
        }
        try {
            await serverBridge.call(ACTION_IDS.whitelistPlayer, { player: name });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Players] whitelist failed for "${name}":`, message);
            setWhitelistError(message);
            return;
        }
        if (serverStatus() === "offline") {
            // the file now holds the account's own casing
            await loadRoster();
            const added = players().find((p) => p.name.toLowerCase() === name.toLowerCase());
            setWhitelistName("");
            setWhitelistError("");
            setWhitelistOpen(false);
            setOpenPlayerName(added ? nameOf(added) : name);
            return;
        }
        setPlayers((prev) => {
            const key = name.toLowerCase();
            if (prev.some((p) => p.name.toLowerCase() === key)) {
                return prev.map((p) =>
                    p.name.toLowerCase() === key ? { ...p, whitelisted: true } : p,
                );
            }
            return [...prev, { name, whitelisted: true, op: false }];
        });
        setWhitelistName("");
        setWhitelistError("");
        setWhitelistOpen(false);
        setOpenPlayerName(name);
    };

    const pardonOpenPlayer = async () => {
        const player = openPlayer();
        if (!player) return;
        if (await setPlayerBanned(player.name, false)) {
            setBannedNames((prev) => {
                const next = new Set(prev);
                next.delete(player.name.toLowerCase());
                return next;
            });
        }
    };

    const killOpenPlayer = () => {
        const player = openPlayer();
        if (player) void killPlayer(player.name);
    };

    const deleteOpenPlayer = async () => {
        const player = openPlayer();
        setDeleteConfirmOpen(false);
        if (!player) return;

        // service-owned: an online player is kicked and their files saved
        // out first, then trash-first delete under the actual level-name.
        // Without a uuid the service resolves one from the server's files
        try {
            await serverBridge.call(ACTION_IDS.deletePlayerData, {
                player: player.name,
                uuid: player.uuid,
            });
        } catch (err) {
            console.error("[Players] Failed to delete player data:", err);
            setFeedback({ title: `${player.name}'s data was not deleted`, message: errorMessage(err) });
            return;
        }
        setFeedback(undefined);

        forgetPlayerData(player.name, player.uuid);
        // a player on the whitelist, an operator or banned stays listed,
        // now without data; anyone else leaves the roster
        await loadRoster();
        await reloadStats();
        if (!allPlayers().some((p) => p.name === player.name)) setOpenPlayerName(undefined);
    };

    return (
        <>
            <PaperPageHeader
                icon="group"
                title="Players"
            >
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperFlex minWidth="field">
                        <PaperSelectMenu
                            name="playersSort"
                            value={sortBy()}
                            onValueChange={(val) => setSortBy(String(val) as SortKey)}
                        >
                            <For each={Object.keys(SORT_LABELS) as SortKey[]}>
                                {(key) => (
                                    <PaperSelectMenuItem value={key}>
                                        {SORT_LABELS[key]}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>
                    </PaperFlex>
                    <PaperButton
                        variant="primary"
                        disabled={!canEditLists()}
                        onClick={() => {
                            setWhitelistName("");
                            setWhitelistError("");
                            setWhitelistEdition("java");
                            setWhitelistOpen(true);
                        }}
                    >
                        <PaperIcon>how_to_reg</PaperIcon>Whitelist
                    </PaperButton>
                </PaperFlex>
            </PaperPageHeader>

            <PlayerRoster
                search={searchQuery()}
                onSearch={setSearchQuery}
                filters={[
                    { label: "Online", count: onlineCount(), selected: showOnline(), onToggle: () => setShowOnline((v) => !v) },
                    { label: "Whitelisted", count: whitelistedCount(), selected: showWhitelisted(), onToggle: () => setShowWhitelisted((v) => !v) },
                    { label: "OP", count: opCount(), selected: showOp(), onToggle: () => setShowOp((v) => !v) },
                ]}
                feedback={feedback()}
                onDismissFeedback={() => setFeedback(undefined)}
                sections={[
                    { label: "Online", players: onlineSorted() },
                    { label: "Offline", players: offlineSorted() },
                ]}
                icon={(player) => <PlayerHead name={player.name} uuid={player.uuid} size="medium" />}
                description={(player) =>
                    isPlayerOn(player.name) ? `Playing · ${statText(player, "playtime")}` : `Played ${statText(player, "playtime")}`
                }
                badges={(player) => (
                    <>
                        <Show when={player.op}>
                            <PaperBadge variant="primary">OP</PaperBadge>
                        </Show>
                        <Show when={player.whitelisted}>
                            <PaperBadge>WL</PaperBadge>
                        </Show>
                        <Show when={bannedNames().has(player.name.toLowerCase())}>
                            <PaperBadge variant="danger">Banned</PaperBadge>
                        </Show>
                    </>
                )}
                status={(player) => statusColor(isPlayerOn(player.name), bannedNames().has(player.name.toLowerCase()))}
                open={openPlayer()?.name}
                onOpen={setOpenPlayerName}
            >
                <PlayerInspector
                    player={openPlayer()}
                    bedrock={openPlayer() ? isBedrockPlayer(openPlayer()!, bedrock()) : false}
                    banned={openIsBanned()}
                    onToggleFlag={togglePlayerFlag}
                    onAction={(action) => setActionModal(action)}
                    onDeleteRequest={() => setDeleteConfirmOpen(true)}
                    onPardon={pardonOpenPlayer}
                    onKill={killOpenPlayer}
                />
            </PlayerRoster>

            <ReasonActionModal
                open={actionModal() !== null}
                title={actionModal() === "ban" ? "Ban Player" : "Kick Player"}
                confirmLabel={actionModal() === "ban" ? "Ban" : "Kick"}
                onClose={() => setActionModal(null)}
                onSubmit={async (reason) => {
                    const player = openPlayer();
                    if (!player) return;
                    if (actionModal() === "ban") {
                        const ok = await setPlayerBanned(player.name, true, reason);
                        if (ok) {
                            setBannedNames((prev) => {
                                const next = new Set(prev);
                                next.add(player.name.toLowerCase());
                                return next;
                            });
                        }
                    } else {
                        await kickPlayer(player.name, reason);
                    }
                    setActionModal(null);
                }}
            />

            <PaperModal
                open={deleteConfirmOpen()}
                onClose={() => setDeleteConfirmOpen(false)}
                title={`Delete ${openPlayer()?.name ?? "player"}'s data`}
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setDeleteConfirmOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton variant="danger" onClick={deleteOpenPlayer}>
                            Delete Data
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    This moves this player's inventory, position, and progress to a
                    .trash folder inside the server folder. They will join as a fresh
                    player. If they are online, they are kicked first. Whitelist,
                    operator and ban settings stay.
                </PaperText>
            </PaperModal>

            <PaperModal
                open={whitelistOpen()}
                onClose={() => setWhitelistOpen(false)}
                title="Add to whitelist"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setWhitelistOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="primary"
                            disabled={!canEditLists() || !whitelistName().trim()}
                            onClick={() => void whitelistNewPlayer()}
                        >
                            Add
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="full" fullWidth>
                    <Show when={bedrock()}>
                        <PaperSelector
                            name="whitelistEdition"
                            value={whitelistEdition()}
                            onValueChange={(value) => {
                                setWhitelistEdition(value === "bedrock" ? "bedrock" : "java");
                                setWhitelistError("");
                            }}
                            horizontal
                        >
                            <PaperSelectorItem value="java" icon="computer">Java</PaperSelectorItem>
                            <PaperSelectorItem value="bedrock" icon="sports_esports">Bedrock</PaperSelectorItem>
                        </PaperSelector>
                    </Show>
                    <PaperFlex direction="column" gap="half" fullWidth>
                        <PaperInput
                            fullWidth
                            autofocus
                            icon="person"
                            label={whitelistEdition() === "bedrock" ? "Gamertag" : "Username"}
                            invalid={!!whitelistError()}
                            value={whitelistName()}
                            onInput={(e) => {
                                setWhitelistName(e.currentTarget.value);
                                setWhitelistError("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void whitelistNewPlayer();
                            }}
                        />
                        <Show
                            when={whitelistError()}
                            fallback={
                                <PaperText size={2} color="text-subtle">
                                    {whitelistEdition() === "bedrock"
                                        ? "Works once they have joined any Geyser server."
                                        : "They don't need to have joined before."}
                                </PaperText>
                            }
                        >
                            <PaperText size={2} color="danger">
                                {whitelistError()}
                            </PaperText>
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperModal>
        </>
    );
}

function PlayerInspector(props: {
    player?: PlayerInfo;
    bedrock: boolean;
    banned: boolean;
    onToggleFlag: (name: string, field: "op" | "whitelisted", value: boolean) => void;
    onAction: (action: "kick" | "ban") => void;
    onDeleteRequest: () => void;
    onPardon: () => void | Promise<void>;
    onKill: () => void;
}) {
    const name = () => props.player?.name ?? "";
    const key = () => name().toLowerCase();
    const isPlayerOnline = () => onlinePlayerNames().has(key());
    const stats = () => playerStats().get(key());
    const summary = () =>
        props.player?.uuid
            ? playerStatSummaries().get(props.player.uuid.toLowerCase())
            : undefined;

    // refresh live stats while the inspector shows an online player
    createEffect(() => {
        if (props.player && isPlayerOnline()) {
            queryPlayerStats(name());
        }
    });

    const playtimeText = () => {
        const s = summary();
        return formatPlaytime(
            s ? Math.floor(s.playTimeTicks / 20) : getPlayerPlaytimeSeconds(name()),
        );
    };
    const distanceText = () => {
        const s = summary();
        return s ? formatDistance(s.distanceCm) : "–";
    };
    // health is fractional (19.62 after a scratch); the hearts bar rounds
    // it up to the next half heart, so the number does too
    const health = () => {
        const value = stats()?.health;
        return value === undefined ? undefined : Math.ceil(value);
    };
    const food = () => {
        const value = stats()?.food;
        return value === undefined ? undefined : Math.round(value);
    };
    const healthMeter = () => {
        const value = health();
        return value === undefined ? undefined : { value, max: 20, variant: "danger" as const };
    };
    const foodMeter = () => {
        const value = food();
        return value === undefined ? undefined : { value, max: 20, variant: "warning" as const };
    };

    return (
        <Show
            when={props.player}
            fallback={
                <PaperCard fullHeight>
                    <PaperFlex fullHeight fullWidth center padding="full">
                        <PaperEmptyState
                            icon="group"
                            title="Select a player"
                            description="Pick someone from the roster to see their status, stats, and controls."
                        />
                    </PaperFlex>
                </PaperCard>
            }
        >
            <PaperCard fullHeight scrollable>
                <PaperFlex direction="column" gap="full" padding="full">
                    {/* identity */}
                    <PaperFlex direction="row" gap="full" align="center" wrap>
                        <PlayerHead
                            name={name()}
                            uuid={props.player?.uuid}
                            size="xlarge"
                        />
                        <PaperFlex
                            direction="column"
                            gap="onefourth"
                            grow
                            minWidth={0}
                        >
                            <PaperText size={7} weight={700}>
                                {name()}
                            </PaperText>
                            <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                                <PaperBadge
                                    variant={props.banned ? "danger" : isPlayerOnline() ? "success" : "monochrome"}
                                >
                                    {props.banned
                                        ? "Banned"
                                        : isPlayerOnline()
                                            ? "Online"
                                            : "Offline"}
                                </PaperBadge>
                                <Show when={props.player?.op}>
                                    <PaperBadge variant="primary">OP</PaperBadge>
                                </Show>
                                <Show when={props.player?.whitelisted}>
                                    <PaperBadge>Whitelisted</PaperBadge>
                                </Show>
                                <Show when={props.bedrock}>
                                    <PaperBadge variant="monochrome">Bedrock</PaperBadge>
                                </Show>
                            </PaperFlex>
                            <Show when={props.player?.uuid}>
                                <PaperFlex direction="row" gap="half" align="center">
                                    <PaperText
                                        family="code"
                                        size={1}
                                        color="text-faint"
                                        truncate
                                    >
                                        {props.player!.uuid}
                                    </PaperText>
                                    <PaperCopyButton text={props.player!.uuid!} />
                                </PaperFlex>
                            </Show>
                        </PaperFlex>
                    </PaperFlex>

                    <PaperSeparator />

                    {/* moderation */}
                    <PaperFlex direction="row" gap="half" wrap>
                        <PaperButton
                            disabled={!isOnline() || !isPlayerOnline()}
                            onClick={() => props.onAction("kick")}
                        >
                            Kick
                        </PaperButton>
                        <Show
                            when={!props.banned}
                            fallback={
                                <PaperButton
                                    variant="primary"
                                    disabled={!isOnline()}
                                    onClick={() => void props.onPardon()}
                                >
                                    Pardon
                                </PaperButton>
                            }
                        >
                            <PaperButton
                                variant="danger"
                                disabled={!isOnline()}
                                onClick={() => props.onAction("ban")}
                            >
                                <PaperIcon>block</PaperIcon>Ban
                            </PaperButton>
                        </Show>
                        <PaperButton
                            variant="warning"
                            disabled={!isOnline() || !isPlayerOnline()}
                            onClick={() => props.onKill()}
                        >
                            <PaperIcon>bolt</PaperIcon>Kill
                        </PaperButton>
                    </PaperFlex>

                    <PaperSeparator />

                    {/* stats */}
                    <PaperText size={2} weight={700} color="text-subtle">
                        Status
                    </PaperText>
                    <PaperGrid min="field">
                        <PaperStatTile
                            icon="favorite"
                            label="Health"
                            value={health() ?? "–"}
                            tone="danger"
                            meter={healthMeter()}
                        />
                        <PaperStatTile
                            icon="restaurant"
                            label="Food"
                            value={food() ?? "–"}
                            tone="warning"
                            meter={foodMeter()}
                        />
                        <PaperStatTile
                            icon="bolt"
                            label="Experience"
                            value={
                                stats()?.xpLevel !== undefined
                                    ? `Level ${stats()!.xpLevel}`
                                    : "–"
                            }
                            tone="success"
                            meter={
                                stats()?.xpProgress !== undefined
                                    ? { value: Math.round(stats()!.xpProgress! * 100), max: 100 }
                                    : undefined
                            }
                        />
                        <PaperStatTile
                            icon="skull"
                            label="Deaths"
                            value={summary()?.deaths ?? "–"}
                        />
                        <PaperStatTile
                            icon="swords"
                            label="Mob kills"
                            value={summary()?.mobKills ?? "–"}
                        />
                        <PaperStatTile
                            icon="military_tech"
                            label="Player kills"
                            value={summary()?.playerKills ?? "–"}
                        />
                        <PaperStatTile
                            icon="route"
                            label="Distance"
                            value={distanceText()}
                        />
                        <PaperStatTile
                            icon="diamond"
                            label="Blocks mined"
                            value={
                                summary() ? summary()!.blocksMined.toLocaleString() : "–"
                            }
                        />
                        <PaperStatTile
                            icon="schedule"
                            label="Total playtime"
                            value={playtimeText()}
                        />
                    </PaperGrid>

                    <PaperSeparator />

                    {/* permissions */}
                    <PaperText size={2} weight={700} color="text-subtle">
                        Permissions
                    </PaperText>
                    <PaperSettingList autoHeight>
                        <PaperSettingItem
                            title="Operator"
                            description={
                                props.bedrock
                                    ? "Full command and administration access. While the server runs, only a Bedrock player who has joined once can be made an operator."
                                    : "Full command and administration access."
                            }
                        >
                            <PaperToggle
                                checked={props.player?.op ?? false}
                                disabled={!canEditLists()}
                                onChange={(checked) => props.onToggleFlag(name(), "op", checked)}
                            />
                        </PaperSettingItem>
                        <PaperSettingItem
                            title="Whitelisted"
                            description="May join while the whitelist is enabled."
                        >
                            <PaperToggle
                                checked={props.player?.whitelisted ?? false}
                                disabled={!canEditLists()}
                                onChange={(checked) =>
                                    props.onToggleFlag(name(), "whitelisted", checked)
                                }
                            />
                        </PaperSettingItem>
                    </PaperSettingList>

                    <PaperSeparator />

                    {/* danger */}
                    <PaperText size={2} weight={700} color="danger">
                        Danger
                    </PaperText>
                    <PaperCard accent="danger" padding="full">
                        <PaperFlex direction="row" justify="space-between" align="center" gap="full">
                            <PaperFlex direction="column" gap="onefourth" minWidth={0}>
                                <PaperText size={3} weight={600}>
                                    Delete player data
                                </PaperText>
                                <PaperText size={2} color="text-subtle">
                                    Inventory, position and progress, moved to trash.
                                </PaperText>
                            </PaperFlex>
                            <PaperButton variant="danger" onClick={props.onDeleteRequest}>
                                <PaperIcon>delete</PaperIcon>Delete
                            </PaperButton>
                        </PaperFlex>
                    </PaperCard>
                </PaperFlex>
            </PaperCard>
        </Show>
    );
}

function ReasonActionModal(props: {
    open: boolean;
    title: string;
    confirmLabel: string;
    onClose: () => void;
    onSubmit: (reason: string) => void | Promise<void>;
}) {
    const [reason, setReason] = createSignal("");

    const submit = () => {
        if (!props.open) return;
        void props.onSubmit(reason().trim());
        setReason("");
    };

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title={props.title}
            size="small"
            footer={
                <>
                    <PaperButton onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="danger" onClick={submit}>
                        {props.confirmLabel}
                    </PaperButton>
                </>
            }
        >
            <PaperInput
                fullWidth
                label="Reason (optional)"
                value={reason()}
                onInput={(e) => setReason(e.currentTarget.value)}
            />
        </PaperModal>
    );
}
