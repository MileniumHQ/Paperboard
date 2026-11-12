import { createEffect, createMemo, createSignal, on, Show, type JSX } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCopyButton,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    type PaperAvatarSize,
} from "@mileniumhq/paperui";
import PlayerRoster, { statusColor } from "./PlayerRoster";
import { onlinePlayerNames, serverStatus } from "../lib/server";
import { errorMessage, type Outcome } from "../lib/failure";

/** What every game's roster knows about a player. */
export interface RosterPlayer {
    /** what the roster shows; two players never share one */
    name: string;
    online: boolean;
    banned: boolean;
    lastSeen?: number;
}

/**
 * A roster's loading and moderation: it is read again whenever who is online
 * or the server's status changes, and an action that fails is told to the
 * user with the player it failed for. `load` reads the game's roster files
 * or service and keeps them in the game's own signals.
 */
export function createRosterState(load: () => Promise<void>) {
    const [loadFailure, setLoadFailure] = createSignal<Outcome>();
    const [actionFailure, setActionFailure] = createSignal<Outcome>();
    const [busy, setBusy] = createSignal(false);

    const reload = async () => {
        try {
            await load();
            setLoadFailure(undefined);
        } catch (err) {
            console.error("[Players] Failed to read the roster:", err);
            setLoadFailure({ title: "Players not loaded", message: errorMessage(err) });
        }
    };
    // joins, leaves and kicks change who is online, and a stopped server changes who can be moderated
    createEffect(on([onlinePlayerNames, serverStatus], () => void reload()));

    /** Runs a moderation action, then reads the roster again; `failure` titles the quote when it fails. */
    const run = async (failure: string, work: () => Promise<unknown>): Promise<boolean> => {
        setBusy(true);
        setActionFailure(undefined);
        try {
            await work();
        } catch (err) {
            console.error(`[Players] ${failure}:`, err);
            setActionFailure({ title: failure, message: errorMessage(err) });
            return false;
        } finally {
            setBusy(false);
        }
        await reload();
        return true;
    };

    return {
        busy,
        run,
        actionFailure,
        /** what the roster tells about the last thing that went wrong */
        feedback: () => actionFailure() ?? loadFailure(),
        dismiss: () => { setActionFailure(undefined); setLoadFailure(undefined); },
        clearActionFailure: () => setActionFailure(undefined),
    };
}
export type RosterState = ReturnType<typeof createRosterState>;

const lastSeenText = (at: number | undefined) => (at ? `Last seen ${new Date(at).toLocaleString()}` : "Not seen yet");

/** One row of a player's Details with a value to copy, in the monospace the ids and addresses use. */
export function CopyRow(props: { label: string; value: string }) {
    return (
        <tr>
            <th>{props.label}</th>
            <td>
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperText family="code" size={2}>{props.value}</PaperText>
                    <PaperCopyButton text={props.value} />
                </PaperFlex>
            </td>
        </tr>
    );
}

/** What kicking and banning mean in a game. */
export interface RosterModeration<T> {
    kick(player: T): Promise<unknown>;
    ban(player: T): Promise<unknown>;
    unban(player: T): Promise<unknown>;
    /** the ban dialog's words: what the ban is bound to */
    banNote: string;
    /** a game that bans only through its running server says so; Ban and Unban wait for it */
    needsServer?: string;
    /** false for a player the game cannot ban, such as a bot */
    canBan?(player: T): boolean;
}

/**
 * Players for a game with no roster of its own to manage: a searchable,
 * filterable list beside the open player's identity, Kick and Ban, and
 * Details. A game merges its roster into `players` and says what its players
 * are called, what moderation means and what else to show about one.
 */
export default function GameRoster<T extends RosterPlayer>(props: {
    state: RosterState;
    players: readonly T[];
    /** what tells two players apart; their name unless the game says otherwise */
    playerId?(player: T): string;
    /** more than the name that the search matches, such as an account id */
    searchTerms?(player: T): readonly string[];
    avatar(player: T, size: PaperAvatarSize): JSX.Element;
    /** the row under an online player's name */
    playing(player: T): string;
    /** what the empty detail pane says a player shows */
    pickHint: string;
    /** badges after the status in the open player's identity */
    badges?(player: T): JSX.Element;
    moderation: RosterModeration<T>;
    /** sections between the buttons and Details, each opening with a separator */
    sections?(player: T): JSX.Element;
    /** rows of Details after Last seen */
    details(player: T): JSX.Element;
    /** false for a player with no Details to show, such as a bot */
    hasDetails?(player: T): boolean;
}) {
    const idOf = (player: T) => props.playerId?.(player) ?? player.name;
    const [search, setSearch] = createSignal("");
    const [showOnline, setShowOnline] = createSignal(true);
    const [showBanned, setShowBanned] = createSignal(true);
    const [openId, setOpenId] = createSignal<string | undefined>();
    const [banOpen, setBanOpen] = createSignal(false);

    const visible = createMemo(() => {
        const query = search().trim().toLowerCase();
        return props.players.filter((p) => {
            if (query && ![p.name, ...(props.searchTerms?.(p) ?? [])].some((text) => text.toLowerCase().includes(query))) return false;
            if (p.online && showOnline()) return true;
            if (p.banned && showBanned()) return true;
            return !p.online && !p.banned;
        });
    });
    const open = () => props.players.find((p) => idOf(p) === openId());
    const needsServer = () => props.moderation.needsServer !== undefined && serverStatus() !== "online";
    const failure = (player: T, past: string) => `${player.name} was not ${past}`;

    const confirmBan = async () => {
        const player = open();
        if (player && (await props.state.run(failure(player, "banned"), () => props.moderation.ban(player)))) setBanOpen(false);
    };
    const showBanDialog = () => {
        props.state.clearActionFailure();
        setBanOpen(true);
    };
    const closeBanDialog = () => {
        setBanOpen(false);
        props.state.clearActionFailure();
    };

    return (
        <>
            <PaperPageHeader icon="group" title="Players" />
            <PlayerRoster
                search={search()}
                onSearch={setSearch}
                filters={[
                    { label: "Online", count: props.players.filter((p) => p.online).length, selected: showOnline(), onToggle: () => setShowOnline((v) => !v) },
                    { label: "Banned", count: props.players.filter((p) => p.banned).length, selected: showBanned(), onToggle: () => setShowBanned((v) => !v) },
                ]}
                // a refused ban is told in its dialog, not twice
                feedback={banOpen() ? undefined : props.state.feedback()}
                onDismissFeedback={props.state.dismiss}
                sections={[
                    { label: "Online", players: visible().filter((p) => p.online) },
                    { label: "Offline", players: visible().filter((p) => !p.online) },
                ]}
                icon={(player) => props.avatar(player, "medium")}
                description={(player) => (player.online ? props.playing(player) : lastSeenText(player.lastSeen))}
                badges={(player) => (
                    <Show when={player.banned}>
                        <PaperBadge variant="danger">Banned</PaperBadge>
                    </Show>
                )}
                status={(player) => statusColor(player.online, player.banned)}
                open={open()?.name}
                onOpen={(name) => setOpenId((() => { const player = props.players.find((p) => p.name === name); return player && idOf(player); })())}
            >
                <Show
                    when={open()}
                    keyed
                    fallback={
                        <PaperFlex fullHeight fullWidth center padding="full">
                            <PaperEmptyState icon="group" title="Select a player" description={props.pickHint} />
                        </PaperFlex>
                    }
                >
                    {(player) => (
                        <PaperFlex direction="column" gap="full" padding="full" scrollable="y" fullHeight>
                            <PaperFlex direction="row" gap="full" align="center" wrap>
                                {props.avatar(player, "xlarge")}
                                <PaperFlex direction="column" gap="onefourth" grow minWidth={0}>
                                    <PaperText size={7} weight={700}>{player.name}</PaperText>
                                    <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                                        <PaperBadge variant={player.banned ? "danger" : player.online ? "success" : "monochrome"}>
                                            {player.banned ? "Banned" : player.online ? "Online" : "Offline"}
                                        </PaperBadge>
                                        {props.badges?.(player)}
                                    </PaperFlex>
                                </PaperFlex>
                            </PaperFlex>

                            <PaperSeparator />

                            <PaperFlex direction="row" gap="half" wrap>
                                <PaperButton
                                    disabled={props.state.busy() || serverStatus() !== "online" || !player.online}
                                    onClick={() => void props.state.run(failure(player, "kicked"), () => props.moderation.kick(player))}
                                >
                                    Kick
                                </PaperButton>
                                <Show when={props.moderation.canBan?.(player) ?? true}>
                                    <Show
                                        when={!player.banned}
                                        fallback={
                                            <PaperButton
                                                variant="primary"
                                                disabled={props.state.busy() || needsServer()}
                                                onClick={() => void props.state.run(failure(player, "unbanned"), () => props.moderation.unban(player))}
                                            >
                                                Unban
                                            </PaperButton>
                                        }
                                    >
                                        <PaperButton variant="danger" disabled={props.state.busy() || needsServer()} onClick={showBanDialog}>
                                            <PaperIcon>block</PaperIcon>Ban
                                        </PaperButton>
                                    </Show>
                                </Show>
                            </PaperFlex>
                            <Show when={needsServer()}>
                                <PaperText size={2} color="text-subtle">{props.moderation.needsServer}</PaperText>
                            </Show>

                            {props.sections?.(player)}

                            <Show when={props.hasDetails?.(player) ?? true}>
                                <PaperSeparator />

                                <PaperText size={2} weight={700} color="text-subtle">Details</PaperText>
                                <PaperTable>
                                    <tbody>
                                        <tr>
                                            <th>Last seen</th>
                                            <td>{player.online ? "Online now" : player.lastSeen ? new Date(player.lastSeen).toLocaleString() : "Not seen yet"}</td>
                                        </tr>
                                        {props.details(player)}
                                    </tbody>
                                </PaperTable>
                            </Show>
                        </PaperFlex>
                    )}
                </Show>
            </PlayerRoster>

            <PaperModal
                open={banOpen()}
                onClose={closeBanDialog}
                title={`Ban ${open()?.name ?? "player"}`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={closeBanDialog}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={props.state.busy() || needsServer()} onClick={() => void confirmBan()}>
                            Ban
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">{props.moderation.banNote} An online player is removed at once.</PaperText>
                <Show when={props.state.actionFailure()}>
                    {(note) => <PaperQuote variant="danger" icon="warning" title={note().title}>{note().message}</PaperQuote>}
                </Show>
            </PaperModal>
        </>
    );
}
