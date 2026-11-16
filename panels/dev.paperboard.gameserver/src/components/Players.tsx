import { createMemo, createSignal, For, Show } from "solid-js";
import { useServer } from "../lib/server";
import { PaperBadge, PaperButton, PaperFlex, PaperIcon, PaperPageHeader, PaperSelectMenu, PaperSelectMenuItem } from "@mileniumhq/paperui";
import { gamertagOf, isFloodgateUuid, type BedrockNaming } from "../core/bedrock";
import { errorMessage } from "../lib/failure";
import { createSaves } from "../lib/saves";
import PlayerHead from "./PlayerHead";
import PlayerRoster, { statusColor } from "./PlayerRoster";
import { createPlayers, type PlayerInfo } from "./players/state";
import { formatPlaytime, SORT_LABELS, type SortKey } from "./players/leaderboard";
import PlayerInspector, { canEditLists } from "./players/PlayerInspector";
import { DeleteDataDialog, ReasonActionDialog, WhitelistDialog } from "./players/PlayerDialogs";

/** a Bedrock player: a Floodgate uuid, or a name with Floodgate's prefix */
function isBedrockPlayer(player: PlayerInfo, naming: BedrockNaming | null): boolean {
    return (player.uuid !== undefined && isFloodgateUuid(player.uuid)) || gamertagOf(player.name, naming) !== null;
}

export default function Players() {
    const { onlinePlayerNames, serverStatus } = useServer();
    const roster = createPlayers();
    const [showOnline, setShowOnline] = createSignal(true);
    const [showWhitelisted, setShowWhitelisted] = createSignal(true);
    const [showOp, setShowOp] = createSignal(true);
    const [searchQuery, setSearchQuery] = createSignal("");
    const [sortBy, setSortBy] = createSignal<SortKey>("playtime");
    const [actionModal, setActionModal] = createSignal<"kick" | "ban" | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
    const [whitelistOpen, setWhitelistOpen] = createSignal(false);

    const isPlayerOn = (name: string) => onlinePlayerNames().has(name.toLowerCase());

    // Unflagged players are always shown so offline ones don't vanish
    const visiblePlayers = createMemo(() => {
        const query = searchQuery().trim().toLowerCase();
        return roster.all().filter((player) => {
            if (query && !player.name.toLowerCase().includes(query)) return false;
            const isOn = isPlayerOn(player.name);
            if (isOn && showOnline()) return true;
            if (player.whitelisted && showWhitelisted()) return true;
            if (player.op && showOp()) return true;
            return !isOn && !player.whitelisted && !player.op;
        });
    });

    const sortedPlayers = createMemo(() => roster.leaderboard.sort(visiblePlayers(), sortBy()));
    const onlineSorted = createMemo(() => sortedPlayers().filter((p) => isPlayerOn(p.name)));
    const offlineSorted = createMemo(() => sortedPlayers().filter((p) => !isPlayerOn(p.name)));
    const sections = createMemo(() => [
        { label: "Online", players: onlineSorted() },
        { label: "Offline", players: offlineSorted() },
    ]);

    const onlineCount = () => roster.all().filter((p) => isPlayerOn(p.name)).length;
    const whitelistedCount = () => roster.listed().filter((p) => p.whitelisted).length;
    const opCount = () => roster.listed().filter((p) => p.op).length;

    // op and whitelist switches flip at once and save in the order pressed
    // (lib/saves); a refusal is quoted and the switch shows what is stored
    const saves = createSaves({
        failed: (err) => roster.setFeedback({ title: "Permission not changed", message: errorMessage(err) }),
        changed: () => roster.setFeedback(undefined),
    });

    // a player with no playtime in this world has not joined it, said as the other games say it
    const rowText = (player: PlayerInfo) => {
        const seconds = roster.leaderboard.playtimeSeconds(player);
        if (isPlayerOn(player.name)) return seconds === undefined ? "Playing" : `Playing · ${formatPlaytime(seconds)}`;
        return seconds === undefined ? "Not seen yet" : `Played ${formatPlaytime(seconds)}`;
    };

    return (
        <>
            <PaperPageHeader
                icon="group"
                title="Players"
            >
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
                    disabled={!canEditLists(serverStatus())}
                    onClick={() => setWhitelistOpen(true)}
                >
                    <PaperIcon>how_to_reg</PaperIcon>Whitelist
                </PaperButton>
            </PaperPageHeader>

            <PlayerRoster
                search={searchQuery()}
                total={roster.all().length}
                onSearch={setSearchQuery}
                filters={[
                    { label: "Online", count: onlineCount(), selected: showOnline(), onToggle: () => setShowOnline((v) => !v) },
                    { label: "Whitelisted", count: whitelistedCount(), selected: showWhitelisted(), onToggle: () => setShowWhitelisted((v) => !v) },
                    { label: "OP", count: opCount(), selected: showOp(), onToggle: () => setShowOp((v) => !v) },
                ]}
                feedback={roster.feedback()}
                onDismissFeedback={() => roster.setFeedback(undefined)}
                sections={sections()}
                icon={(player) => <PlayerHead name={player.name} uuid={player.uuid} size="medium" />}
                description={rowText}
                badges={(player) => (
                    <>
                        <Show when={player.op}>
                            <PaperBadge variant="primary">OP</PaperBadge>
                        </Show>
                        <Show when={player.whitelisted}>
                            <PaperBadge>WL</PaperBadge>
                        </Show>
                        <Show when={roster.isBanned(player.name)}>
                            <PaperBadge variant="danger">Banned</PaperBadge>
                        </Show>
                    </>
                )}
                status={(player) => statusColor(isPlayerOn(player.name), roster.isBanned(player.name))}
                open={roster.openPlayer()?.name}
                onOpen={roster.setOpenName}
            >
                <PlayerInspector
                    player={roster.openPlayer()}
                    leaderboard={roster.leaderboard}
                    bedrock={roster.openPlayer() ? isBedrockPlayer(roster.openPlayer()!, roster.bedrock()) : false}
                    banned={roster.isBanned(roster.openPlayer()?.name ?? "")}
                    banReason={roster.banReason(roster.openPlayer()?.name ?? "")}
                    flag={(field) => {
                        // the player it was made for, even once another is open
                        const name = roster.openPlayer()!.name;
                        return saves.setting(
                            `${field}:${name}`,
                            () => roster.find(name)?.[field] ?? false,
                            (value) => roster.setFlag(name, field, value),
                        );
                    }}
                    onAction={setActionModal}
                    onDeleteRequest={() => setDeleteConfirmOpen(true)}
                    onPardon={async () => {
                        const player = roster.openPlayer();
                        if (player) await roster.setBanned(player.name, false);
                    }}
                    onKill={() => {
                        const player = roster.openPlayer();
                        if (player) void roster.kill(player.name);
                    }}
                />
            </PlayerRoster>

            <ReasonActionDialog
                open={actionModal() !== null}
                title={`${actionModal() === "ban" ? "Ban" : "Kick"} ${roster.openPlayer()?.name ?? "player"}?`}
                confirmLabel={actionModal() === "ban" ? "Ban" : "Kick"}
                onClose={() => setActionModal(null)}
                onSubmit={async (reason) => {
                    const player = roster.openPlayer();
                    if (!player) throw new Error("No player is open");
                    const done = actionModal() === "ban" ? await roster.setBanned(player.name, true, reason) : await roster.kick(player.name, reason);
                    // closed either way: a failure is quoted on the page, under it
                    setActionModal(null);
                    return done;
                }}
            />

            <DeleteDataDialog
                open={deleteConfirmOpen()}
                player={roster.openPlayer()?.name}
                onClose={() => setDeleteConfirmOpen(false)}
                onDelete={() => {
                    setDeleteConfirmOpen(false);
                    void roster.deleteOpenData();
                }}
            />

            <WhitelistDialog
                open={whitelistOpen()}
                onClose={() => setWhitelistOpen(false)}
                bedrock={roster.bedrock()}
                disabled={!canEditLists(serverStatus())}
                onAdd={roster.whitelistName}
            />
        </>
    );
}
