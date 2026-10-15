// Game Server's Home widgets, on PaperUI's shared PaperWidget layout so they
// line up with every other widget on Home. Every one reads the panel's own
// service through useWidgetServer, so what they show is what the service
// holds: a service that doesn't answer is "unavailable", never an empty server.
import { createEffect, createMemo, createSignal, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js";
import { fileApi, type WidgetContext } from "@mileniumhq/paperapi";
import {
    PaperButton,
    PaperWidget,
    PaperWidgetDot,
    PaperWidgetMessage,
    PaperWidgetRows,
    PaperWidgetStat,
    type PaperRole,
    type PaperWidgetRow,
} from "@mileniumhq/paperui";
import { ACTION_IDS, PANEL_ID } from "../service/contract";
import { getStatusBadge } from "../core/statusBadge";
import { SOFTWARE_NAMES } from "../lib/software";
import { createHeadLoader } from "../lib/headCache";
import HeadAvatar from "../components/HeadAvatar";
import { MotdPreview } from "../components/MotdPreview";
import { useWidgetServer, type ServerView, type WidgetServer } from "./connection";
import { consoleTail, playerCount, rosterRows, softwareLabel } from "./view";
import styles from "./widgets.module.css";

type Props = { widget: WidgetContext };
type Status = ServerView["serverStatus"];

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** the status's role, or undefined for offline (a hollow dot, plain text) */
function statusTone(status: Status): PaperRole | undefined {
    const variant = getStatusBadge(status).variant;
    return variant === "monochrome" ? undefined : (variant as PaperRole);
}

/** a dot and a word: how every widget says what the server is doing */
function StatusWord(props: { status: Status; suffix?: string }) {
    return (
        <span class={styles.state}>
            <PaperWidgetDot tone={statusTone(props.status) ?? "none"} />
            {getStatusBadge(props.status).label}
            {props.suffix}
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
                        description={props.short ? undefined : "Its service may be stopped or updating."}
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
    createEffect(() => {
        const c = server.connection();
        if (asked || !server.visible() || c.phase !== "ready") return;
        if (c.server.serverStatus !== "online" || c.server.maxPlayers !== null) return;
        asked = true;
        server.call(ACTION_IDS.queryOnlinePlayers).catch((err) =>
            console.warn("[gameserver widget] player list query failed:", messageOf(err)),
        );
    });
}

// ── Server status (2x1, 2x2) ────────────────────────────────────────────

const SERVER_TITLE = "Server";

export function StatusWidget(props: Props) {
    const server = useWidgetServer(props.widget);
    askForCap(server);
    const size = useSize(props.widget);
    const tall = () => size().h > 1;
    const [pending, setPending] = createSignal(false);
    const [failure, setFailure] = createSignal<{ verb: string; action: string; message: string } | null>(null);

    const run = (verb: string, action: string) => {
        setPending(true);
        setFailure(null);
        server
            .call(action)
            .catch((err) => setFailure({ verb, action, message: messageOf(err) }))
            .finally(() => setPending(false));
    };

    return (
        <Connected server={server} widget={props.widget} title={SERVER_TITLE} icon="dns" short={!tall()}>
            {(s) => {
                const status = () => s().serverStatus;
                const installed = () => s().serverVersion !== "";
                const online = () => status() === "online";
                const busy = () => pending() || status() === "stopping" || status() === "restarting";
                const address = () => `${s().localIp}:${s().serverPort}`;
                const players = () => playerCount(s().onlinePlayers.length, s().maxPlayers);
                // what the one button does now; a server with nothing installed
                // can't start, so it opens the panel to set up
                const control = () =>
                    status() === "offline"
                        ? { label: "Start server", short: "Start", icon: "play_arrow", variant: "success" as const, act: () => run("start", ACTION_IDS.startServer) }
                        : { label: "Stop server", short: "Stop", icon: "stop", variant: "danger" as const, act: () => run("stop", ACTION_IDS.stopServer) };
                const canControl = () => installed() || status() !== "offline";
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
                    return <StatusWord status={status()} suffix=" · players" />;
                };
                return (
                    <PaperWidget
                        title={SERVER_TITLE}
                        // a 2x1 header holds the version and the button; the icon would cut the title
                        icon={tall() ? "dns" : undefined}
                        detail={installed() ? softwareLabel(s().serverSoftware, s().serverVersion, SOFTWARE_NAMES) : "Not set up"}
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
                            <Match when={failure()}>
                                {(failed) => (
                                    <PaperWidgetMessage
                                        tone="danger"
                                        title={`Couldn't ${failed().verb} the server`}
                                        description={tall() ? failed().message : undefined}
                                    >
                                        <PaperButton size="tiny" onClick={() => setFailure(null)}>
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

/** names as players typed them, from the server's own cache; the roster is lowercase keys */
function useNameCasing(server: WidgetServer) {
    const [names, setNames] = createSignal<Map<string, string>>(new Map());
    createEffect(
        on(server.visible, (shown) => {
            if (!shown) return;
            fileApi
                .read("usercache.json", PANEL_ID)
                .then((raw) => {
                    const next = new Map<string, string>();
                    const parsed: unknown = raw ? JSON.parse(raw) : [];
                    if (Array.isArray(parsed)) {
                        for (const entry of parsed.slice(0, 1000)) {
                            if (typeof entry?.name === "string") next.set(entry.name.toLowerCase(), entry.name);
                        }
                    }
                    setNames(next);
                })
                // casing only: the roster's own names stand without it
                .catch((err) => console.warn("[gameserver widget] usercache.json unreadable:", messageOf(err)));
        }),
    );
    return (key: string) => names().get(key) ?? key;
}

const ROSTER_ROWS = 6;

export function PlayersWidget(props: Props) {
    const server = useWidgetServer(props.widget);
    askForCap(server);
    const nameOf = useNameCasing(server);
    const heads = createHeadLoader((request) =>
        server.call<string | null>(ACTION_IDS.getPlayerSkin, { player: request.name, size: request.size }),
    );

    return (
        <Connected server={server} widget={props.widget} title="Players" icon="group" short={false}>
            {(s) => {
                const online = () => s().serverStatus === "online";
                const rows = (): PaperWidgetRow[] => {
                    const roster = rosterRows(s().onlinePlayers, ROSTER_ROWS);
                    const list: PaperWidgetRow[] = roster.shown.map((key) => ({
                        id: key,
                        label: (
                            <span class={styles.player}>
                                <HeadAvatar name={nameOf(key)} loader={heads} size="small" alt="" class={styles.head} />
                                <span class={styles.playerName}>{nameOf(key)}</span>
                            </span>
                        ),
                    }));
                    if (roster.more > 0) {
                        list.push({ id: "more", label: `and ${roster.more} more`, ariaLabel: `${roster.more} more players: open Game Server`, onClick: () => props.widget.openPanel() });
                    }
                    return list;
                };
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
                const rows = (): PaperWidgetRow[] =>
                    consoleTail(s().serverEntries, 2).map((line, index) => ({
                        id: `${index}:${line.time}:${line.text}`,
                        label: <span class={styles.mono} title={line.text}>{line.text}</span>,
                        detail: line.time || undefined,
                        tone: line.tone === "error" ? "danger" : line.tone === "warn" ? "warning" : "none",
                        ariaLabel: `${TONE_WORD[line.tone] ? `${TONE_WORD[line.tone]}: ` : ""}${line.text}. Open the console`,
                        onClick: () => props.widget.openPanel(),
                    }));
                return (
                    <PaperWidget title="Console" icon="terminal" detail={<StatusWord status={s().serverStatus} />} action={open}>
                        <Show when={s().serverEntries.length > 0} fallback={<PaperWidgetMessage title="No server output since the service started" />}>
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
