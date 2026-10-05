import { PANEL_ID } from "../service/types";
import { createSignal, createEffect, For, onCleanup, onMount, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperChip,
    PaperCopyButton,
    PaperEmptyState,
    PaperFlex,
    PaperGrid,
    PaperIcon,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperPageHeader,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperSplit,
    PaperStatTile,
    PaperSwatch,
    PaperText,
    PaperToggle,
    getVarCss,
} from "@mileniumhq/paperui";
import { fileApi } from "@mileniumhq/paperapi";
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
    PLAYER_NAME_PATTERN,
} from "../lib/server";
import { ACTION_IDS, type ActionId } from "../service/contract";
import PlayerHead from "./PlayerHead";

const LIST_POLL_MS = 15000;
const STATS_POLL_MS = 30000;

interface PlayerInfo {
    name: string;
    uuid?: string;
    whitelisted: boolean;
    op: boolean;
}

function isOnline(): boolean {
    return serverStatus() === "online";
}

async function loadJsonEntries(path: string): Promise<{ name: string; uuid?: string }[]> {
    try {
        const content = await fileApi.read(path, PANEL_ID);
        if (!content) return [];
        const parsed: unknown = JSON.parse(content);
        if (!Array.isArray(parsed)) return [];
        const entries: { name: string; uuid?: string }[] = [];
        for (const entry of parsed) {
            if (entry && typeof entry.name === "string") {
                entries.push({
                    name: entry.name,
                    uuid: typeof entry.uuid === "string" ? entry.uuid : undefined,
                });
            }
        }
        return entries;
    } catch (err) {
        console.error(`[Players] Failed to read ${path}:`, err);
        return [];
    }
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
    const [feedback, setFeedback] = createSignal("");
    const [sortBy, setSortBy] = createSignal<SortKey>("playtime");

    // re-verify ban state after a written command; tracked so unmount clears it
    let banRecheckTimer: ReturnType<typeof setTimeout> | null = null;

    onMount(async () => {
        queryOnlinePlayers();
        loadPlayerStats();
        const poll = setInterval(queryOnlinePlayers, LIST_POLL_MS);
        const statsPoll = setInterval(loadPlayerStats, STATS_POLL_MS);
        onCleanup(() => {
            clearInterval(poll);
            clearInterval(statsPoll);
            if (banRecheckTimer) clearTimeout(banRecheckTimer);
        });

        const [whitelisted, ops, cached, banned] = await Promise.all([
            loadJsonEntries("whitelist.json"),
            loadJsonEntries("ops.json"),
            loadJsonEntries("usercache.json"),
            loadJsonEntries("banned-players.json"),
        ]);

        const whitelistSet = new Set(whitelisted.map((e) => e.name.toLowerCase()));
        const opSet = new Set(ops.map((n) => n.name.toLowerCase()));
        setBannedNames(new Set(banned.map((n) => n.name.toLowerCase())));

        const byKey = new Map<string, PlayerInfo>();
        for (const entry of [...cached, ...whitelisted, ...ops]) {
            const key = entry.name.toLowerCase();
            const existing = byKey.get(key);
            if (existing) {
                existing.uuid = existing.uuid ?? entry.uuid;
            } else {
                byKey.set(key, {
                    name: entry.name,
                    uuid: entry.uuid,
                    whitelisted: whitelistSet.has(key),
                    op: opSet.has(key),
                });
            }
        }
        setPlayers([...byKey.values()]);
    });

    const allPlayers = () => {
        const known = players().slice();
        const listed = new Set(players().map((p) => p.name.toLowerCase()));
        for (const name of [...seenPlayerNames(), ...onlinePlayerNames()]) {
            if (listed.has(name)) continue;
            listed.add(name);
            known.push({ name, whitelisted: false, op: false });
        }
        // players discovered only from their stats files (e.g. an expired
        // usercache entry) still belong on the leaderboard
        for (const summary of playerStatSummaries().values()) {
            const key = summary.name.toLowerCase();
            if (listed.has(key)) continue;
            listed.add(key);
            known.push({
                name: summary.name,
                uuid: summary.uuid,
                whitelisted: false,
                op: false,
            });
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
        extra?: Record<string, unknown>,
    ): Promise<boolean> => {
        try {
            await serverBridge.call(actionId, { player: playerName, ...extra });
            setFeedback("");
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Players] ${actionId} failed for "${playerName}":`, message);
            setFeedback(message);
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
        const ok = await callPlayerAction(actionId, playerName);
        if (!ok) return; // state stays as the server reports it
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
            ? callPlayerAction(ACTION_IDS.banPlayer, playerName, { reason })
            : callPlayerAction(ACTION_IDS.pardonPlayer, playerName);
        // a written console command is not ban-truth: re-verify from the
        // ban file after a delay so the UI's ban state converges on what
        // the server actually recorded
        if (banRecheckTimer) clearTimeout(banRecheckTimer);
        banRecheckTimer = setTimeout(() => {
            void loadJsonEntries("banned-players.json").then((bannedEntries) => {
                setBannedNames(new Set(bannedEntries.map((n) => n.name.toLowerCase())));
            });
        }, 1500);
        return result;
    };

    const kickPlayer = (playerName: string, reason?: string): Promise<boolean> =>
        callPlayerAction(ACTION_IDS.kickPlayer, playerName, { reason });

    const killPlayer = (playerName: string): Promise<boolean> =>
        callPlayerAction(ACTION_IDS.killPlayer, playerName);

    // whitelist a name that may not be on the roster yet (a player who has
    // not joined). The service validates the name again; this pattern check
    // is only so the field can explain itself before the round trip.
    const whitelistNewPlayer = async () => {
        const name = whitelistName().trim();
        if (!PLAYER_NAME_PATTERN.test(name)) {
            setWhitelistError("Names are 1–16 letters, numbers, or underscores.");
            return;
        }
        const ok = await callPlayerAction(ACTION_IDS.whitelistPlayer, name);
        if (!ok) {
            setWhitelistError("The server refused the whitelist command.");
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
        if (!player?.uuid) return;

        if (onlinePlayerNames().has(player.name.toLowerCase())) {
            // best effort: an online player is kicked first; a kick failure
            // is logged, it must not block the (trash-first) data delete
            await kickPlayer(player.name, "Your data was deleted");
        }

        // service-owned: trash-first delete under the actual level-name,
        // never hardcoded "world/..." paths from the component
        try {
            await serverBridge.call(ACTION_IDS.deletePlayerData, {
                player: player.name,
                uuid: player.uuid,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Players] Failed to delete player data:", message);
            setFeedback(message);
            return;
        }

        forgetPlayerData(player.name);
        setPlayers((prev) =>
            prev.filter((p) => p.name.toLowerCase() !== player.name.toLowerCase()),
        );
        setOpenPlayerName(undefined);
    };

    return (
        <>
            <PaperFlex direction="column" gap="full" padding="full" fullHeight fullWidth>
                <PaperPageHeader icon="group" title="Players">
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperFlex minWidth={getVarCss("size-field")}>
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
                            disabled={!isOnline()}
                            onClick={() => {
                                setWhitelistError("");
                                setWhitelistOpen(true);
                            }}
                        >
                            <PaperIcon>how_to_reg</PaperIcon>Whitelist
                        </PaperButton>
                    </PaperFlex>
                </PaperPageHeader>

                <PaperFlex grow minHeight={0} fullWidth>
                    <PaperSplit
                        detailActive={openPlayer() !== undefined}
                        onDetailClose={() => setOpenPlayerName(undefined)}
                        detailTitle={openPlayer()?.name}
                        side={
                        <PaperCard fullHeight>
                            <PaperFlex direction="column" gap="half" padding="full" shrink={false}>
                                <PaperInput
                                    fullWidth
                                    icon="search"
                                    placeholder="Search players"
                                    value={searchQuery()}
                                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                                />
                                <PaperFlex direction="row" gap="half" wrap>
                                    <PaperChip
                                        selected={showOnline()}
                                        count={onlineCount()}
                                        onClick={() => setShowOnline((v) => !v)}
                                    >
                                        Online
                                    </PaperChip>
                                    <PaperChip
                                        selected={showWhitelisted()}
                                        count={whitelistedCount()}
                                        onClick={() => setShowWhitelisted((v) => !v)}
                                    >
                                        Whitelisted
                                    </PaperChip>
                                    <PaperChip
                                        selected={showOp()}
                                        count={opCount()}
                                        onClick={() => setShowOp((v) => !v)}
                                    >
                                        OP
                                    </PaperChip>
                                </PaperFlex>
                                <Show when={feedback()}>
                                    <PaperText size={2} color="danger">
                                        {feedback()}
                                    </PaperText>
                                </Show>
                            </PaperFlex>
                            <PaperSeparator />
                            <Show
                                when={sortedPlayers().length > 0}
                                fallback={
                                    <PaperFlex padding="full" center>
                                        <PaperText size={3}>
                                            No players match these filters.
                                        </PaperText>
                                    </PaperFlex>
                                }
                            >
                                <PaperList
                                    name="playersList"
                                    style={{ background: "var(--paper-surface-raised)" }}
                                    value={openPlayerName()}
                                    onValueChange={(val) => setOpenPlayerName(String(val))}
                                    borderless
                                    fullWidth
                                    flex={1}
                                    scrollable
                                >
                                    <Show when={onlineSorted().length > 0}>
                                        <PaperText preset="section" as="h3" color="text-subtle" style={{ padding: "var(--paper-uigap-threefourths)", margin: "0" }}>
                                            Online ({onlineSorted().length})
                                        </PaperText>
                                        <For each={onlineSorted()}>
                                            {(player) => (
                                                <PlayerRow
                                                    player={player}
                                                    banned={bannedNames().has(
                                                        player.name.toLowerCase(),
                                                    )}
                                                    statusText={`Playing · ${statText(player, "playtime")}`}
                                                />
                                            )}
                                        </For>
                                    </Show>
                                    <Show when={offlineSorted().length > 0}>
                                        <PaperText preset="section" as="h3" color="text-subtle" style={{ padding: "var(--paper-uigap-threefourths)", margin: "0" }}>
                                            Offline ({offlineSorted().length})
                                        </PaperText>
                                        <For each={offlineSorted()}>
                                            {(player) => (
                                                <PlayerRow
                                                    player={player}
                                                    banned={bannedNames().has(
                                                        player.name.toLowerCase(),
                                                    )}
                                                    statusText={`Played ${statText(player, "playtime")}`}
                                                />
                                            )}
                                        </For>
                                    </Show>
                                </PaperList>
                            </Show>
                        </PaperCard>
                    }
                >
                    <PlayerInspector
                        player={openPlayer()}
                        banned={openIsBanned()}
                        onToggleFlag={togglePlayerFlag}
                        onAction={(action) => setActionModal(action)}
                        onDeleteRequest={() => setDeleteConfirmOpen(true)}
                        onPardon={pardonOpenPlayer}
                        onKill={killOpenPlayer}
                    />
                </PaperSplit>
                </PaperFlex>
            </PaperFlex>

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
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setDeleteConfirmOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton variant="danger" onClick={deleteOpenPlayer}>
                            Delete Data
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    This moves this player's inventory, position, and progress to a
                    .trash folder inside the server folder. They will join as a fresh
                    player.
                </PaperText>
            </PaperModal>

            <PaperModal
                open={whitelistOpen()}
                onClose={() => setWhitelistOpen(false)}
                title="Whitelist Player"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setWhitelistOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="primary"
                            disabled={!isOnline()}
                            onClick={() => void whitelistNewPlayer()}
                        >
                            Whitelist
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperText preset="body">
                        Adds a player to the server whitelist. They do not need to
                        have joined before.
                    </PaperText>
                    <PaperInput
                        fullWidth
                        icon="person_add"
                        placeholder="Player name"
                        value={whitelistName()}
                        onInput={(e) => {
                            setWhitelistName(e.currentTarget.value);
                            setWhitelistError("");
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void whitelistNewPlayer();
                        }}
                    />
                    <Show when={whitelistError()}>
                        <PaperText size={2} color="danger">
                            {whitelistError()}
                        </PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}

function statusColor(online: boolean, banned: boolean): string {
    if (banned) return getVarCss("danger");
    return online ? getVarCss("success") : getVarCss("border-emphasis");
}

function PlayerRow(props: {
    player: PlayerInfo;
    banned: boolean;
    statusText: string;
}) {
    const online = () => onlinePlayerNames().has(props.player.name.toLowerCase());
    return (
        <PaperListItem
            value={props.player.name}
            icon={
                <PlayerHead
                    name={props.player.name}
                    uuid={props.player.uuid}
                    size="medium"
                />
            }
            description={props.statusText}
            actions={
                <PaperFlex direction="row" gap="onefourth" align="center">
                    <Show when={props.player.op}>
                        <PaperBadge variant="primary">OP</PaperBadge>
                    </Show>
                    <Show when={props.player.whitelisted}>
                        <PaperBadge>WL</PaperBadge>
                    </Show>
                    <Show when={props.banned}>
                        <PaperBadge variant="danger">Banned</PaperBadge>
                    </Show>
                    <PaperSwatch
                        color={statusColor(online(), props.banned)}
                        size="small"
                    />
                </PaperFlex>
            }
        >
            {props.player.name}
        </PaperListItem>
    );
}

function PlayerInspector(props: {
    player?: PlayerInfo;
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
    const healthValue = () =>
        stats()?.health !== undefined ? stats()!.health : "–";
    const healthMeter = () =>
        stats()?.health !== undefined
            ? { value: stats()!.health!, max: 20, variant: "danger" as const }
            : undefined;
    const foodValue = () =>
        stats()?.food !== undefined ? stats()!.food : "–";
    const foodMeter = () =>
        stats()?.food !== undefined
            ? { value: stats()!.food!, max: 20, variant: "warning" as const }
            : undefined;

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
                    <PaperGrid min={getVarCss("size-field")}>
                        <PaperStatTile
                            icon="favorite"
                            label="Health"
                            value={healthValue()}
                            tone="danger"
                            meter={healthMeter()}
                        />
                        <PaperStatTile
                            icon="restaurant"
                            label="Food"
                            value={foodValue()}
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
                            description="Full command and administration access."
                        >
                            <PaperToggle
                                checked={props.player?.op ?? false}
                                disabled={!isOnline()}
                                onChange={(checked) => props.onToggleFlag(name(), "op", checked)}
                            />
                        </PaperSettingItem>
                        <PaperSettingItem
                            title="Whitelisted"
                            description="May join while the whitelist is enabled."
                        >
                            <PaperToggle
                                checked={props.player?.whitelisted ?? false}
                                disabled={!isOnline()}
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
                <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                    <PaperButton onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="danger" onClick={submit}>
                        {props.confirmLabel}
                    </PaperButton>
                </PaperFlex>
            }
        >
            <PaperInput
                fullWidth
                placeholder="Reason (optional)"
                value={reason()}
                onInput={(e) => setReason(e.currentTarget.value)}
            />
        </PaperModal>
    );
}
