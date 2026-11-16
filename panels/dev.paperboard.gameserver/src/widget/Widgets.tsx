// Game Server's Home widgets, on PaperUI's shared PaperWidget layout so they
// line up with every other widget on Home. Every one reads the panel's own
// service through useWidgetServer, so what they show is what the service
// holds: a service that doesn't answer is "unavailable", never an empty server.
import { batch, createEffect, createMemo, createSignal, mapArray, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js";
import { type ServiceCalls, type WidgetContext } from "@mileniumhq/paperapi";
import type { gameServerContract } from "../service/contract";
import {
    createAction,
    PaperButton,
    PaperWidget,
    PaperWidgetDot,
    PaperWidgetMessage,
    PaperWidgetRows,
    PaperWidgetStat,
    type PaperRole,
    type PaperWidgetRow,
} from "@mileniumhq/paperui";
import { getStatusBadge } from "../core/statusBadge";
import type { HeadFetch } from "../lib/skins";
import HeadAvatar from "../components/HeadAvatar";
import PlayerAvatar from "../components/PlayerAvatar";
import { MotdPreview } from "../components/MotdPreview";
import { useWidgetServer, type ServerView, type WidgetServer } from "./connection";
import { consoleTail, playerCount, rosterRows } from "./view";
import styles from "./widgets.module.css";
import { errorMessage } from "../lib/failure";

type Props = { widget: WidgetContext };
type Status = ServerView["serverStatus"];


/** the status's role, or undefined for offline (a hollow dot, plain text) */
function statusTone(status: Status): PaperRole | undefined {
    const variant = getStatusBadge(status).variant;
    return variant === "monochrome" ? undefined : (variant as PaperRole);
}

/** a dot and a word: how every widget says what the server is doing */
function StatusWord(props: { status: Status }) {
    return (
        <span class={styles.state}>
            <PaperWidgetDot tone={statusTone(props.status) ?? "none"} />
            {getStatusBadge(props.status).label}
        </span>
    );
}

/** the widget's size, kept current */
function useSize(widget: WidgetContext) {
    const [size, setSize] = createSignal(widget.size());
    onCleanup(widget.onResize(setSize));
    return size;
}

/** loading and unavailable, under the widget's own header; its content once the service answered */
function Connected(props: {
    server: WidgetServer;
    widget: WidgetContext;
    title: string;
    icon?: string;
    short: boolean;
    children: (server: () => ServerView) => JSX.Element;
}) {
    const ready = createMemo(() => {
        const c = props.server.connection();
        return c.phase === "ready" ? c.server : null;
    });
    return (
        <Switch>
            <Match when={ready()}>{(server) => props.children(server)}</Match>
            <Match when={props.server.connection().phase === "loading"}>
                <PaperWidget title={props.title} icon={props.icon}>
                    <PaperWidgetMessage title="Connecting to Game Server…" />
                </PaperWidget>
            </Match>
            <Match when={props.server.connection().phase === "unavailable"}>
                <PaperWidget title={props.title} icon={props.icon}>
                    <PaperWidgetMessage
                        tone="danger"
                        title="Game Server isn't answering"
                        description={props.short ? undefined : (props.server.connection() as { message: string }).message}
                    >
                        <PaperButton size="tiny" onClick={() => props.server.retry()}>
                            Retry
                        </PaperButton>
                        <PaperButton size="tiny" onClick={() => props.widget.openPanel()}>
                            Open
                        </PaperButton>
                    </PaperWidgetMessage>
                </PaperWidget>
            </Match>
        </Switch>
    );
}

/** asks the running server for its player cap once per showing, when the service doesn't know it yet */
function askForCap(server: WidgetServer) {
    let asked = false;
    createEffect(
        on(server.visible, (shown) => {
            if (!shown) asked = false;
        }),
    );
    createEffect(on([server.connection, server.visible], ([c, shown]) => {
        if (asked || !shown || c.phase !== "ready") return;
        if (!c.server.supportsPlayers) return;
        if (c.server.serverStatus !== "online" || c.server.maxPlayers !== null) return;
        asked = true;
        // quiet: the widget shows the players as unknown, and asks again the next time it is shown
        server.call((calls) => calls.queryOnlinePlayers()).catch((err) =>
            console.warn("[gameserver widget] player list query failed:", errorMessage(err)),
        );
    }));
}

// ── Server status (2x1, 2x2) ────────────────────────────────────────────

// before the service answers, the widget doesn't know the server's name yet
const SERVER_TITLE = "Server";

export function StatusWidget(props: Props) {
    const server = useWidgetServer(props.widget);
    askForCap(server);
    const size = useSize(props.widget);
    const tall = () => size().h > 1;
    const power = createAction({ message: errorMessage, toast: false });
    const run = (verb: string, action: (calls: ServiceCalls<typeof gameServerContract>) => Promise<unknown>) => void power.run(`Couldn't ${verb} the server`, () => server.call(action));

    return (
        <Connected server={server} widget={props.widget} title={SERVER_TITLE} icon="dns" short={!tall()}>
            {(s) => {
                const status = () => s().serverStatus;
                const installed = () => s().serverVersion !== "";
                const online = () => status() === "online";
                const busy = () => power.busy() || status() === "stopping" || status() === "restarting";
                // stopping disconnects whoever is playing, so with anyone on it asks
                // first, in the tile, until the server's state moves on
                const [askStop, setAskStop] = createSignal(false);
                createEffect(on(status, () => setAskStop(false), { defer: true }));
                const stop = () => run("stop", (calls) => calls.stopServer());
                const address = () => `${s().localIp}:${s().serverPort}`;
                const players = () => !s().supportsPlayers ? { ...playerCount(0, null), short: "Unavailable", long: "Player count unavailable", online: "—" } : playerCount(s().onlinePlayers.length, s().maxPlayers);
                // what the one button does now; a server with nothing installed
                // can't start, so it opens the panel to set up
                const control = () =>
                    status() === "offline"
                        ? { label: "Start server", short: "Start", icon: "play_arrow", variant: "success" as const, act: () => run("start", (calls) => calls.startServer()) }
                        : { label: "Stop server", short: "Stop", icon: "stop", variant: "danger" as const, act: () => (s().onlinePlayers.length > 0 ? setAskStop(true) : stop()) };
                const canControl = () => (installed() || status() !== "offline") && !askStop();
                const button = (small: boolean) => (
                    <PaperButton
                        size={small ? "small" : "tiny"}
                        icon={!small}
                        variant={control().variant}
                        disabled={busy()}
                        title={control().label}
                        aria-label={control().label}
                        onClick={() => control().act()}
                    >
                        {small ? control().short : control().icon}
                    </PaperButton>
                );
                const value = () => (online() ? (players().max ? `${players().online} / ${players().max}` : players().online) : getStatusBadge(status()).label);
                const caption = () => {
                    if (!online()) return address();
                    if (tall()) return address();
                    return players().noun;
                };
                return (
                    <PaperWidget
                        title={s().name}
                        // a 2x1 header holds the version and the button; the icon would cut the title
                        icon={tall() ? "dns" : undefined}
                        detail={installed() ? s().softwareLabel : "Not set up"}
                        action={!tall() && canControl() ? button(false) : undefined}
                        footer={
                            tall() && canControl() ? (
                                <>
                                    <span class={styles.meta}>
                                        <Show when={online()}>
                                            <StatusWord status={status()} />
                                        </Show>
                                    </span>
                                    {button(true)}
                                </>
                            ) : undefined
                        }
                    >
                        <Switch
                            fallback={
                                <PaperWidgetStat
                                    value={value()}
                                    caption={caption()}
                                    tone={online() ? undefined : statusTone(status())}
                                />
                            }
                        >
                            <Match when={askStop()}>
                                <PaperWidgetMessage
                                    tone="warning"
                                    title={`Stop ${s().name}?`}
                                    description={`${players().online} ${s().onlinePlayers.length === 1 ? "player is" : "players are"} online, and stopping disconnects them.`}
                                >
                                    <PaperButton size="tiny" variant="text" onClick={() => setAskStop(false)}>
                                        Cancel
                                    </PaperButton>
                                    <PaperButton size="tiny" variant="danger" onClick={() => { setAskStop(false); stop(); }}>
                                        Stop
                                    </PaperButton>
                                </PaperWidgetMessage>
                            </Match>
                            <Match when={power.error()}>
                                {(failed) => (
                                    <PaperWidgetMessage
                                        tone="danger"
                                        title={failed().title}
                                        description={tall() ? failed().message : undefined}
                                    >
                                        <PaperButton size="tiny" onClick={() => power.setError(null)}>
                                            Dismiss
                                        </PaperButton>
                                        <PaperButton size="tiny" onClick={() => props.widget.openPanel()}>
                                            Open
                                        </PaperButton>
                                    </PaperWidgetMessage>
                                )}
                            </Match>
                            <Match when={!installed() && status() === "offline"}>
                                <PaperWidgetMessage title="Nothing installed" description={tall() ? "Pick a server version in Game Server." : undefined}>
                                    <PaperButton size="tiny" onClick={() => props.widget.openPanel()}>
                                        Set up
                                    </PaperButton>
                                </PaperWidgetMessage>
                            </Match>
                            <Match when={s().activeIssue}>
                                {(issue) => (
                                    <PaperWidgetMessage tone="warning" title={issue().title} description={tall() ? issue().description : undefined}>
                                        <PaperButton size="tiny" onClick={() => props.widget.openPanel()}>
                                            Open
                                        </PaperButton>
                                    </PaperWidgetMessage>
                                )}
                            </Match>
                        </Switch>
                    </PaperWidget>
                );
            }}
        </Connected>
    );
}

// ── Players online (2x2) ────────────────────────────────────────────────

/**
 * Names as players typed them, for a game that lists its online players in
 * lower case: read from the file its definition names, once per showing.
 */
function useNameCasing(server: WidgetServer) {
    const [names, setNames] = createSignal<Map<string, string>>(new Map());
    const [error, setError] = createSignal("");
    // a push that leaves the book where it was is no reason to read it again
    const book = createMemo(() => {
        const c = server.connection();
        return c.phase === "ready" ? c.server.nameBook : undefined;
    });
    createEffect(
        on([server.visible, book], ([shown, path]) => {
            if (!shown || !path) return;
            server.call((calls) => calls.readServerFile({ path }))
                .then((file) => {
                    if (file.kind !== "text") throw new Error(file.kind === "unavailable" ? file.reason : `${path} is not text`);
                    const parsed: unknown = file.text ? JSON.parse(file.text) : [];
                    if (!Array.isArray(parsed)) throw new Error(`${path} is not a list of players`);
                    const next = new Map<string, string>();
                    for (const entry of parsed.slice(0, 1000)) {
                        if (typeof entry?.name === "string") next.set(entry.name.toLowerCase(), entry.name);
                    }
                    batch(() => {
                        setNames(next);
                        setError("");
                    });
                })
                .catch((err) => setError(errorMessage(err)));
        }),
    );
    return { nameOf: (key: string) => names().get(key) ?? key, error };
}

const ROSTER_ROWS = 6;

export function PlayersWidget(props: Props) {
    const server = useWidgetServer(props.widget);
    askForCap(server);
    const casing = useNameCasing(server);
    const nameOf = casing.nameOf;
    const loadHead: HeadFetch = (request) =>
        server.call((calls) => calls.getPlayerSkin({ player: request.name, size: request.size }));

    return (
        <Connected server={server} widget={props.widget} title="Players" icon="group" short={false}>
            {(s) => {
                const online = () => s().serverStatus === "online";
                const roster = createMemo(() => rosterRows(s().onlinePlayers, ROSTER_ROWS));
                // one row per player, made when they join the list and kept
                // while they stay, so their head is asked for once
                const playerRows = createMemo(
                    mapArray(
                        () => roster().shown,
                        (key): PaperWidgetRow => ({
                            id: key,
                            label: (
                                <span class={styles.player}>
                                    <Show when={s().heads} fallback={<PlayerAvatar name={nameOf(key)} size="small" />}>
                                        <HeadAvatar name={nameOf(key)} loadHead={loadHead} size="small" alt="" class={styles.head} />
                                    </Show>
                                    <span class={styles.playerName}>{nameOf(key)}</span>
                                </span>
                            ),
                        }),
                    ),
                );
                const more = createMemo(() => roster().more);
                const moreRow = createMemo((): PaperWidgetRow | null =>
                    more() > 0 ? { id: "more", label: `and ${more()} more`, ariaLabel: `${more()} more players: open Game Server`, onClick: () => props.widget.openPanel() } : null,
                );
                // names as typed are only how they're spelled: the roster stands
                // without them, first saying why they're missing
                const namesRow = createMemo((): PaperWidgetRow | null =>
                    casing.error() ? { id: "names", label: `Names as typed not read: ${casing.error()}`, tone: "danger", ariaLabel: `Names as typed not read: ${casing.error()}. Open Game Server`, onClick: () => props.widget.openPanel() } : null,
                );
                const rows = createMemo((): PaperWidgetRow[] => [namesRow(), ...playerRows(), moreRow()].filter((row): row is PaperWidgetRow => row !== null));
                return (
                    <PaperWidget
                        title="Players"
                        icon="group"
                        detail={online() ? playerCount(s().onlinePlayers.length, s().maxPlayers).short : undefined}
                    >
                        <Switch fallback={<PaperWidgetRows rows={rows()} aria-label="Players online" />}>
                            <Match when={s().serverStatus === "offline"}>
                                <PaperWidgetMessage title="The server is offline" description="Start it from the status widget or Game Server.">
                                    <PaperButton size="tiny" onClick={() => props.widget.openPanel()}>
                                        Open
                                    </PaperButton>
                                </PaperWidgetMessage>
                            </Match>
                            <Match when={!online()}>
                                <PaperWidgetMessage title={getStatusBadge(s().serverStatus).label} />
                            </Match>
                            <Match when={s().onlinePlayers.length === 0}>
                                <PaperWidgetMessage title="No one is online" />
                            </Match>
                        </Switch>
                    </PaperWidget>
                );
            }}
        </Connected>
    );
}

// ── Console tail (4x1) ──────────────────────────────────────────────────

const TONE_WORD = { error: "Error", warn: "Warning", plain: "" } as const;

export function ConsoleWidget(props: Props) {
    const server = useWidgetServer(props.widget);
    const open = (
        <PaperButton size="tiny" icon variant="text" title="Open the console" aria-label="Open the console" onClick={() => props.widget.openPanel()}>
            open_in_new
        </PaperButton>
    );
    return (
        <Connected server={server} widget={props.widget} title="Console" icon="terminal" short>
            {(s) => {
                const rows = createMemo((): PaperWidgetRow[] =>
                    consoleTail(s().serverEntries, 2).map((line, index) => ({
                        id: `${index}:${line.time}:${line.text}`,
                        label: <span class={styles.mono} title={line.text}>{line.text}</span>,
                        detail: line.time || undefined,
                        tone: line.tone === "error" ? "danger" : line.tone === "warn" ? "warning" : "none",
                        ariaLabel: `${TONE_WORD[line.tone] ? `${TONE_WORD[line.tone]}: ` : ""}${line.text}. Open the console`,
                        onClick: () => props.widget.openPanel(),
                    })),
                );
                return (
                    <PaperWidget title="Console" icon="terminal" detail={<StatusWord status={s().serverStatus} />} action={open}>
                        <Show when={s().serverEntries.length > 0} fallback={<PaperWidgetMessage title="No server output yet" />}>
                            <PaperWidgetRows rows={rows()} aria-label="Latest server log" />
                        </Show>
                    </PaperWidget>
                );
            }}
        </Connected>
    );
}

// ── MOTD card (4x1) ─────────────────────────────────────────────────────

export function MotdWidget(props: Props) {
    const server = useWidgetServer(props.widget);
    askForCap(server);
    return (
        <Connected server={server} widget={props.widget} title="Server list" icon="dns" short>
            {(s) => (
                <PaperWidget
                    title="Server list"
                    icon="dns"
                    detail={
                        s().serverStatus === "online" ? (
                            playerCount(s().onlinePlayers.length, s().maxPlayers).short
                        ) : (
                            <StatusWord status={s().serverStatus} />
                        )
                    }
                >
                    <MotdPreview motd={s().serverMotd} paused={!server.visible()} class={styles.motd} />
                </PaperWidget>
            )}
        </Connected>
    );
}
