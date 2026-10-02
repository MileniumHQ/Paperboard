import { PANEL_ID } from "../service/types";
import { createSignal, createEffect, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCheckbox,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperTable,
    PaperText,
    PaperToggle,
    getVarCss,
    PaperCard,
    PaperAvatar,
} from "@paperboard-dev/paperui";
import {   fileApi } from "@paperboard-dev/paperapi";
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
import { PaperPageHeader } from "@paperboard-dev/paperui";

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
    const [openPlayerName, setOpenPlayerName] = createSignal<string | undefined>();

    const [actionModal, setActionModal] = createSignal<"kick" | "ban" | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
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
        return allPlayers().filter((player) => {
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

    const openPlayer = () => allPlayers().find((p) => p.name === openPlayerName());
    const openIsBanned = () =>
        bannedNames().has((openPlayer()?.name ?? "").toLowerCase());

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
                    <PaperPageHeader icon="group" title="Players">
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
                    </PaperPageHeader>
                    <PaperCard>
                        <PaperFlex direction="row" gap="threefourths" padding="full" align="center" wrap>
                            <PaperCheckbox
                                checked={showOnline()}
                                onChange={setShowOnline}
                                label="Online"
                            />
                            <PaperCheckbox
                                checked={showWhitelisted()}
                                onChange={setShowWhitelisted}
                                label="Whitelisted"
                            />
                            <PaperCheckbox
                                checked={showOp()}
                                onChange={setShowOp}
                                label="OP"
                            />
                        </PaperFlex>
                        <Show when={feedback()}>
                            <PaperText
                                size={3}
                                style={{
                                    color: `${getVarCss("danger")}`,
                                    padding: `0 ${getVarCss("uigap")} ${getVarCss("uigap")}`,
                                }}
                            >
                                {feedback()}
                            </PaperText>
                        </Show>
                    </PaperCard>

                    <Show
                        when={sortedPlayers().length > 0}
                        fallback={
                            <PaperCard>
                                <PaperFlex padding="full" center>
                                    <PaperText size={3}>No players match these filters.</PaperText>
                                </PaperFlex>
                            </PaperCard>
                        }
                    >
                        <PaperMediaCardGroup minCardWidth={getVarCss("size-card-min")}>
                            <For each={sortedPlayers()}>
                                {(player) => {
                                    const isOn = () =>
                                        onlinePlayerNames().has(player.name.toLowerCase());
                                    return (
                                        <PaperMediaCard
                                            icon={`https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/64`}
                                            title={player.name}
                                            subtitle={`Played ${statText(player, "playtime")}`}
                                            description={
                                                sortBy() !== "name" && sortBy() !== "playtime"
                                                    ? `${SORT_LABELS[sortBy()]}: ${statText(player, sortBy())}`
                                                    : undefined
                                            }
                                            onClick={() => setOpenPlayerName(player.name)}
                                            badge={
                                                <Show
                                                    when={!bannedNames().has(player.name.toLowerCase())}
                                                    fallback={<PaperBadge variant="danger">Banned</PaperBadge>}
                                                >
                                                    <PaperBadge variant={isOn() ? "success" : "monochrome"}>
                                                        {isOn() ? "Online" : "Offline"}
                                                    </PaperBadge>
                                                </Show>
                                            }
                                            footerLeft={
                                                player.op ? (
                                                    <PaperBadge variant="primary">OP</PaperBadge>
                                                ) : undefined
                                            }
                                            footerRight={
                                                player.whitelisted ? (
                                                    <PaperBadge>Whitelisted</PaperBadge>
                                                ) : undefined
                                            }
                                        />
                                    );
                                }}
                            </For>
                        </PaperMediaCardGroup>
                    </Show>

            <PlayerModal
                player={openPlayer()}
                banned={openIsBanned()}
                open={openPlayer() !== undefined}
                onClose={() => setOpenPlayerName(undefined)}
                onToggleFlag={togglePlayerFlag}
                onAction={(action) => setActionModal(action)}
                onDeleteRequest={() => setDeleteConfirmOpen(true)}
                onPardon={pardonOpenPlayer}
                onKill={killOpenPlayer}
            />

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
        </>
    );
}

function PlayerModal(props: {
    player?: PlayerInfo;
    banned: boolean;
    open: boolean;
    onClose: () => void;
    onToggleFlag: (name: string, field: "op" | "whitelisted", value: boolean) => void;
    onAction: (action: "kick" | "ban") => void;
    onDeleteRequest: () => void;
    onPardon: () => void | Promise<void>;
    onKill: () => void;
}) {
    const [copied, setCopied] = createSignal(false);

    const name = () => props.player?.name ?? "";
    const key = () => name().toLowerCase();
    const isPlayerOnline = () => onlinePlayerNames().has(key());
    const stats = () => playerStats().get(key());
    const summary = () =>
        props.player?.uuid
            ? playerStatSummaries().get(props.player.uuid.toLowerCase())
            : undefined;

    // refresh live stats while the modal is open and the player is online
    createEffect(() => {
        if (props.open && props.player && isPlayerOnline()) {
            queryPlayerStats(name());
        }
    });

    const handleCopyUuid = async () => {
        const id = props.player?.uuid;
        if (!id) return;
        try {
            await navigator.clipboard?.writeText(id);
        } catch (err) {
            console.debug("[players] clipboard write failed, falling back:", String(err));
            const textarea = document.createElement("textarea");
            textarea.value = id;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <PaperModal
            open={props.open && props.player !== undefined}
            onClose={props.onClose}
            size="medium"
            noHeader
        >
            <PaperFlex direction="column" gap="full">
                {/* identity */}
                <PaperFlex direction="row" gap="threefourths" align="center">
                    <PaperAvatar
                        src={`https://mc-heads.net/avatar/${encodeURIComponent(name())}/64`}
                        shape="square"
                        size="xlarge"
                    />
                    <PaperFlex direction="column" gap="onefourth" style={{ "min-width": 0 }}>
                        <PaperText size={7} weight={700}>
                            {name()}
                        </PaperText>
                        <PaperFlex direction="row" gap="half" align="center" wrap>
                            <PaperBadge variant={isPlayerOnline() ? "success" : "monochrome"}>
                                {isPlayerOnline() ? "Online" : "Offline"}
                            </PaperBadge>
                            <Show when={props.player?.op}>
                                <PaperBadge variant="primary">OP</PaperBadge>
                            </Show>
                            <Show when={props.player?.whitelisted}>
                                <PaperBadge>Whitelisted</PaperBadge>
                            </Show>
                            <Show when={props.banned}>
                                <PaperBadge variant="danger">Banned</PaperBadge>
                            </Show>
                        </PaperFlex>
                    </PaperFlex>
                    <PaperFlex
                        direction="row"
                        gap="half"
                        align="center"
                        style={{ "margin-left": "auto", "flex-shrink": 0 }}
                    >
                        <Show when={props.player?.uuid}>
                            <PaperButton size="tiny"
                                icon
                                onClick={handleCopyUuid}
                                title={copied() ? "Copied!" : props.player!.uuid}>
                                <PaperIcon>{copied() ? "check" : "content_copy"}</PaperIcon>
                            </PaperButton>
                        </Show>
                    </PaperFlex>
                </PaperFlex>

                {/* stats */}
                <PaperCard>
                    <PaperTable>
                        <tbody>
                            <tr>
                                <th>Playtime</th>
                                <td>
                                    {summary()
                                        ? formatPlaytime(
                                              Math.floor(summary()!.playTimeTicks / 20),
                                          )
                                        : formatPlaytime(
                                              getPlayerPlaytimeSeconds(name()),
                                          )}
                                </td>
                            </tr>
                            <tr>
                                <th>Health</th>
                                <td>{stats()?.health !== undefined ? stats()!.health : "–"}</td>
                            </tr>
                            <tr>
                                <th>Food</th>
                                <td>{stats()?.food !== undefined ? stats()!.food : "–"}</td>
                            </tr>
                            <tr>
                                <th>XP Level</th>
                                <td>{stats()?.xpLevel !== undefined ? stats()!.xpLevel : "–"}</td>
                            </tr>
                            <tr>
                                <th>Deaths</th>
                                <td>{summary()?.deaths ?? "–"}</td>
                            </tr>
                            <tr>
                                <th>Mob Kills</th>
                                <td>{summary()?.mobKills ?? "–"}</td>
                            </tr>
                            <tr>
                                <th>Player Kills</th>
                                <td>{summary()?.playerKills ?? "–"}</td>
                            </tr>
                            <tr>
                                <th>Blocks Mined</th>
                                <td>{summary()?.blocksMined ?? "–"}</td>
                            </tr>
                            <tr>
                                <th>Distance</th>
                                <td>
                                    {summary()
                                        ? formatDistance(summary()!.distanceCm)
                                        : "–"}
                                </td>
                            </tr>
                        </tbody>
                    </PaperTable>
                </PaperCard>

                {/* permissions */}
                <SectionLabel>Permissions</SectionLabel>
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

                {/* moderation */}
                <SectionLabel>Moderation</SectionLabel>
                <PaperFlex direction="row" gap="half" wrap>
                    <PaperButton
                        disabled={!isOnline() || !isPlayerOnline()}
                        onClick={() => props.onAction("kick")}>
                        Kick
                    </PaperButton>
                    <Show
                        when={!props.banned}
                        fallback={
                            <PaperButton
                                variant="primary"
                                disabled={!isOnline()}
                                onClick={() => void props.onPardon()}>
                                Pardon
                            </PaperButton>
                        }
                    >
                        <PaperButton
                            variant="danger"
                            disabled={!isOnline()}
                            onClick={() => props.onAction("ban")}>
                            Ban
                        </PaperButton>
                    </Show>
                    <PaperButton
                        variant="warning"
                        disabled={!isOnline() || !isPlayerOnline()}
                        onClick={() => props.onKill()}>
                        Kill
                    </PaperButton>
                </PaperFlex>

                {/* danger */}
                <PaperSeparator />
                <SectionLabel danger>Danger</SectionLabel>
                <PaperCard
                    style={{
                        "border-color": getVarCss("danger", "transparent"),
                    }}
                >
                    <PaperFlex
                        direction="row"
                        justify="space-between"
                        align="center"
                        gap="full"
                        padding="full"
                    >
                        <PaperFlex direction="column" gap="onefourth" style={{ "min-width": 0 }}>
                            <PaperText size={3} weight={600}>
                                Delete player data
                            </PaperText>
                            <PaperText size={2} color="text-subtle">
                                Inventory, position and progress, moved to trash.
                            </PaperText>
                        </PaperFlex>
                        <PaperButton variant="danger" onClick={props.onDeleteRequest}>
                            <PaperIcon>delete</PaperIcon>
                            Delete
                        </PaperButton>
                    </PaperFlex>
                </PaperCard>
            </PaperFlex>
        </PaperModal>
    );
}

function SectionLabel(props: { children: JSX.Element; danger?: boolean }) {
    return (
        <PaperText
            size={2}
            weight={700}
            style={{
                "text-transform": "uppercase",
                "letter-spacing": getVarCss("text-tracking"),
                color: props.danger
                    ? `${getVarCss("danger")}`
                    : `${getVarCss("text-subtle")}`,
            }}
        >
            {props.children}
        </PaperText>
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
