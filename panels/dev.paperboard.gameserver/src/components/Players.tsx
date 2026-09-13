import { PANEL_ID } from "../service/types";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCheckbox,
    PaperContainer,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperText,
    PaperToggle,
} from "@paperboard-dev/paperui";
import {   fileApi } from "@paperboard-dev/paperapi";
import {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    onlinePlayerNames,
    queryOnlinePlayers,
    seenPlayerNames,
    serverBridge,
    serverStatus,
} from "../lib/server";
import { ACTION_IDS, type ActionId } from "../service/contract";

const LIST_POLL_MS = 15000;

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

    onMount(async () => {
        queryOnlinePlayers();
        const poll = setInterval(queryOnlinePlayers, LIST_POLL_MS);
        onCleanup(() => clearInterval(poll));

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
            if (!listed.has(name)) known.push({ name, whitelisted: false, op: false });
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
        setTimeout(() => {
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
            console.error("[Players] Failed to delete player data:", err);
            return;
        }

        forgetPlayerData(player.name);
        setPlayers((prev) =>
            prev.filter((p) => p.name.toLowerCase() !== player.name.toLowerCase()),
        );
        setOpenPlayerName(undefined);
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight padding="double" gap="threefourths">
            <PaperContainer style={{ "flex-shrink": 0 }}>
                <PaperFlex direction="row" gap="threefourths" padding="full" align="center">
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
                    <PaperText size={3} style={{ color: "red", padding: "0 var(--paper-uigap-full)" }}>
                        {feedback()}
                    </PaperText>
                </Show>
            </PaperContainer>

            <div
                style={{
                    flex: 1,
                    "min-height": 0,
                    "overflow-y": "auto",
                    padding: "var(--paper-uigap-half)",
                }}
            >
                <Show
                    when={visiblePlayers().length > 0}
                    fallback={
                        <PaperFlex padding="full" center>
                            <PaperText size={3}>No players match these filters.</PaperText>
                        </PaperFlex>
                    }
                >
                    <PaperMediaCardGroup minCardWidth="15rem">
                        <For each={visiblePlayers()}>
                            {(player) => {
                                const isOn = () =>
                                    onlinePlayerNames().has(player.name.toLowerCase());
                                return (
                                    <PaperMediaCard
                                        icon={`https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/64`}
                                        title={player.name}
                                        subtitle={`Played for ${formatPlaytime(
                                            getPlayerPlaytimeSeconds(player.name),
                                        )}`}
                                        onClick={() => setOpenPlayerName(player.name)}
                                        badge={
                                            <Show
                                                when={!bannedNames().has(player.name.toLowerCase())}
                                                fallback={<PaperBadge variant="red">Banned</PaperBadge>}
                                            >
                                                <PaperBadge variant={isOn() ? "green" : "monochrome"}>
                                                    {isOn() ? "Online" : "Offline"}
                                                </PaperBadge>
                                            </Show>
                                        }
                                        footerLeft={
                                            player.op ? (
                                                <PaperBadge variant="blue">OP</PaperBadge>
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
            </div>

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
                        <PaperButton compact onClick={() => setDeleteConfirmOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton compact variant="red" onClick={deleteOpenPlayer}>
                            Delete Data
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    This permanently deletes this player's inventory, position, and
                    progress. They will join as a fresh player. This cannot be undone.
                </PaperText>
            </PaperModal>
        </PaperFlex>
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
    const isPlayerOnline = () => onlinePlayerNames().has(name().toLowerCase());

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
            title={name()}
            size="medium"
        >
            <PaperFlex direction="row" gap="double" align="stretch">
                <PaperFlex direction="column" gap="half" align="center" justify="space-between" style={{ "flex-shrink": 0 }}>
                    <img
                        src={`https://mc-heads.net/body/${encodeURIComponent(name())}`}
                        alt={`${name()} skin`}
                        style={{
                            height: "12rem",
                            width: "auto",
                            "max-width": "none",
                            "image-rendering": "pixelated",
                            display: "block",
                        }}
                    />
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperIcon>schedule</PaperIcon>
                        <PaperText size={3}>
                            Played for{" "}
                            <strong>{formatPlaytime(getPlayerPlaytimeSeconds(name()))}</strong>
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>

                <PaperFlex direction="column" gap="threefourths" fullWidth justify="space-between">
                    <PaperFlex direction="column" gap="threefourths" fullWidth>
                        <Show when={props.player?.uuid}>
                            <PaperButton
                                tiny
                                onClick={handleCopyUuid}
                                title={copied() ? "Copied!" : props.player!.uuid}
                            >
                                <PaperIcon>{copied() ? "check" : "content_copy"}</PaperIcon>
                                {copied() ? "Copied!" : "Copy UUID"}
                            </PaperButton>
                        </Show>

                        <PaperFlex direction="column" gap="half" fullWidth>
                            <PaperFlex direction="row" justify="space-between" align="center" fullWidth>
                                <PaperText size={3}>OP</PaperText>
                                <PaperToggle
                                    checked={props.player?.op ?? false}
                                    disabled={!isOnline()}
                                    onChange={(checked) => props.onToggleFlag(name(), "op", checked)}
                                />
                            </PaperFlex>
                            <PaperFlex direction="row" justify="space-between" align="center" fullWidth>
                                <PaperText size={3}>Whitelist</PaperText>
                                <PaperToggle
                                    checked={props.player?.whitelisted ?? false}
                                    disabled={!isOnline()}
                                    onChange={(checked) =>
                                        props.onToggleFlag(name(), "whitelisted", checked)
                                    }
                                />
                            </PaperFlex>
                        </PaperFlex>
                    </PaperFlex>

                    <PaperFlex direction="row" gap="half" fullWidth>
                        <PaperButton
                            compact
                            style={{ flex: 1 }}
                            disabled={!isOnline() || !isPlayerOnline()}
                            onClick={() => props.onAction("kick")}
                        >
                            Kick
                        </PaperButton>
                        <Show
                            when={!props.banned}
                            fallback={
                                <PaperButton
                                    compact
                                    variant="blue"
                                    style={{ flex: 1 }}
                                    disabled={!isOnline()}
                                    onClick={() => void props.onPardon()}
                                >
                                    Pardon
                                </PaperButton>
                            }
                        >
                            <PaperButton
                                compact
                                variant="red"
                                style={{ flex: 1 }}
                                disabled={!isOnline()}
                                onClick={() => props.onAction("ban")}
                            >
                                Ban
                            </PaperButton>
                        </Show>
                        <PaperButton
                            compact
                            variant="red"
                            style={{ flex: 1 }}
                            onClick={props.onDeleteRequest}
                        >
                            <PaperIcon>delete</PaperIcon>
                            Delete Data
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="yellow"
                            style={{ flex: 1 }}
                            disabled={!isOnline() || !isPlayerOnline()}
                            onClick={() => props.onKill()}
                        >
                            Kill
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperFlex>
        </PaperModal>
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
                    <PaperButton compact onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton compact variant="red" onClick={submit}>
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
