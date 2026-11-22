import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperCopyButton,
    PaperEmptyState,
    PaperError,
    PaperFlex,
    PaperGrid,
    PaperIcon,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperStatTile,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { useServer, type ServerStatus } from "../../lib/server";
import type { SavedSetting } from "../../lib/saves";
import { errorMessage } from "../../lib/failure";
import PlayerHead from "../PlayerHead";
import { formatDistance, formatPlaytime, type Leaderboard } from "./leaderboard";
import type { PlayerFlagField, PlayerInfo } from "./state";

// how often an online player's open page asks the game for their health,
// food and experience: each ask is four console commands
const LIVE_STATS_MS = 15000;

// a running server takes op and whitelist through its console, a stopped
// one has its files edited; only a server between the two must wait
export function canEditLists(status: ServerStatus): boolean {
    return status === "online" || status === "starting" || status === "offline";
}

/** The open player: who they are, moderation, their stats and permissions, and deleting their data. */
export default function PlayerInspector(props: {
    player?: PlayerInfo;
    leaderboard: Leaderboard;
    bedrock: boolean;
    /** the open player's op or whitelist switch, made once per player shown */
    flag: (field: PlayerFlagField) => SavedSetting<boolean>;
    onAction: (action: "kick" | "ban") => void;
    onDeleteRequest: () => void;
    onPardon: () => void | Promise<void>;
    onKill: () => void;
}) {
    const { calls, onlinePlayerNames, playerStats, serverStatus } = useServer();
    const isOnline = () => serverStatus() === "online";
    const name = () => props.player?.name ?? "";
    const key = () => name().toLowerCase();
    const isPlayerOnline = () => onlinePlayerNames().has(key());
    const stats = () => playerStats().get(key());
    const summary = () => (props.player ? props.leaderboard.summaryOf(props.player) : undefined);

    // live stats for an online player: asked when their page opens or they
    // come online, then on a slow poll, never because other state arrived
    const liveName = createMemo(() => (props.player && isPlayerOnline() ? name() : undefined));
    // why the game could not be asked, until an ask goes through
    const [liveError, setLiveError] = createSignal("");
    createEffect(
        on(liveName, (player) => {
            setLiveError("");
            if (!player) return;
            // an answer about the player shown before does not count
            let current = true;
            const ask = () =>
                calls.queryPlayerStats({ player }).then(
                    () => current && setLiveError(""),
                    (err) => current && setLiveError(errorMessage(err)),
                );
            void ask();
            const poll = setInterval(() => void ask(), LIVE_STATS_MS);
            onCleanup(() => {
                current = false;
                clearInterval(poll);
            });
        }),
    );

    const playtimeText = () => formatPlaytime(props.player ? props.leaderboard.playtimeSeconds(props.player) : undefined);
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
    // why the head could not be looked up, in words: a phone shows no tooltip
    const [headFailure, setHeadFailure] = createSignal<string | null>(null);
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
                <PaperFlex fullHeight fullWidth center padding="full">
                    <PaperEmptyState
                        icon="group"
                        title="Select a player"
                        description="Pick someone from the roster to see their status, stats, and controls."
                    />
                </PaperFlex>
            }
        >
            <PaperFlex direction="column" gap="full" padding="full" scrollable="y" fullHeight>
                {/* identity */}
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PlayerHead
                        name={name()}
                        uuid={props.player?.uuid}
                        size="xlarge"
                        onFailure={setHeadFailure}
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
                                variant={props.player?.banned ? "danger" : isPlayerOnline() ? "success" : "monochrome"}
                            >
                                {props.player?.banned
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
                        <Show when={props.player?.banned && props.player.banReason}>
                            {(reason) => <PaperText size={2} color="text-subtle">Ban reason: {reason()}</PaperText>}
                        </Show>
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

                <Show when={headFailure()}>
                    {(err) => <PaperError title="Couldn't look up the head" error={err()} />}
                </Show>

                <PaperSeparator />

                {/* moderation */}
                <PaperFlex direction="row" gap="half" wrap>
                    <PaperButton
                        disabled={!isOnline() || !isPlayerOnline()}
                        onClick={() => props.onAction("kick")}
                    >
                        <PaperIcon>logout</PaperIcon>Kick
                    </PaperButton>
                    <Show
                        when={!props.player?.banned}
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
                {/* asked again on its own every few seconds */}
                <Show when={liveError()}>
                    {(err) => <PaperError title="Couldn't read the live stats" error={err()} />}
                </Show>
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
                {/* made again for each player, so a switch saving for one never shows on another */}
                <Show when={name()} keyed>
                    {(_name) => {
                        const op = props.flag("op");
                        const whitelisted = props.flag("whitelisted");
                        return (
                            <PaperSettingList autoHeight>
                                <PaperSettingItem
                                    title="Operator"
                                    description={
                                        props.bedrock
                                            ? "Full command and administration access. While the server runs, only a Bedrock player who has joined once can be made an operator."
                                            : "Full command and administration access."
                                    }
                                >
                                    <PaperToggle checked={op.value()} disabled={!canEditLists(serverStatus())} onChange={op.set} />
                                </PaperSettingItem>
                                <PaperSettingItem title="Whitelisted" description="May join while the whitelist is enabled.">
                                    <PaperToggle checked={whitelisted.value()} disabled={!canEditLists(serverStatus())} onChange={whitelisted.set} />
                                </PaperSettingItem>
                            </PaperSettingList>
                        );
                    }}
                </Show>

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
        </Show>
    );
}
