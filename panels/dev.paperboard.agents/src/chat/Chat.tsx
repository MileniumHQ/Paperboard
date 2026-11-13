import { For, Show, createComputed, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperButton, PaperContextMenu, PaperContextMenuItem, PaperEmptyState, PaperFlex, PaperIcon, copyText, haptic, PaperMarkdown, useContextMenuState, PaperPresence, PaperProgress, PaperQuote, PaperText, type MarkdownImage } from "@mileniumhq/paperui";
import { createStore, reconcile } from "solid-js/store";
import { Face } from "../face/Face";
import { skinFor } from "../face/skins";
import type { FaceController } from "../face/controller";
import type { AccessEntry, ChatEntry, PageEntry, PromptEntry, SignInEntry, ToolServerEntry, ToolSignInEntry, WaitingMessage } from "../contract";
import type { Agent } from "../lib/agent";
import type { Files } from "../lib/files";
import PageCard from "../pages/PageCard";
import type { Launcher } from "../pages/launcher";
import Composer from "./Composer";
import { AttachmentList, renderAgentImage } from "./Media";
import { createTray } from "./tray";
import History from "./History";
import { createSwipeReply } from "./swipeReply";
import SignIn, { type SignInDraft } from "./SignIn";
import AccessRequest from "./AccessRequest";
import Prompt from "./Prompt";
import ToolServerRequest from "./ToolServerRequest";
import ToolSignIn from "./ToolSignIn";
import { failure, type Failure } from "../lib/failure";
import styles from "./Chat.module.css";

/** A message someone can reply to, and be quoted. */
type Said = Extract<ChatEntry, { kind: "user" | "agent" }>;

/** Bubbles from one side this close in time sit together; a longer silence gets a timestamp. */
const GROUP_MS = 2 * 60_000;
const STAMP_MS = 30 * 60_000;
/** rows drawn at first, and added each time the user scrolls up to the top, so a long conversation isn't one huge list */
const PAGE_ROWS = 60;
/** this close to the top, the next rows are drawn */
const MORE_AT_PX = 200;
/** the agent's face at the top of the chat */
const AVATAR_PX = 56;

interface Row {
    key: string;
    entry: ChatEntry | null;
    /** a message not yet read by the agent */
    waiting: WaitingMessage | null;
    side: "me" | "them" | "note" | "card" | "access" | "prompt" | "tool-server" | "tool-sign-in" | "app";
    /** a timestamp to show above this row, if any */
    stamp: number | null;
    joinsPrev: boolean;
    joinsNext: boolean;
}

const stampText = (at: number) => {
    const d = new Date(at);
    const time = d.toLocaleTimeString([], { timeStyle: "short" });
    return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { dateStyle: "medium" })}, ${time}`;
};

/** One conversation, like texting a friend. */
export default function Chat(props: { agent: Agent; face: FaceController; pages: Launcher; onMenu: () => void }) {
    const { agent, face } = props;
    const name = () => agent.state.settings?.name ?? "Your agent";

    // thinking while the agent is on it, working or writing
    createEffect(() => face.ponder(agent.state.chat.busy));

    const status = () => {
        const c = agent.state.computer;
        if (c.userControl) return "Waiting while you use its computer";
        return (
            {
                none: "No computer yet",
                unsupported: "No computer on this machine",
                installing: "Setting up its computer…",
                starting: "Starting its computer…",
                ready: undefined,
                stopping: "Turning its computer off…",
                stopped: "Its computer is off",
                failed: "Its computer stopped with a problem",
            } as const
        )[c.phase];
    };

    const [replyTo, setReplyTo] = createSignal<Said | null>(null);
    const [draft, setDraft] = createSignal("");
    const tray = createTray(agent);
    const agentImage = renderAgentImage(agent.files);
    const [notice, setNotice] = createSignal<Failure | null>(null);
    const [historyOpen, setHistoryOpen] = createSignal(false);
    const [startingNew, setStartingNew] = createSignal(false);
    const canStartNew = () => !startingNew() && agent.entries.length > 0;
    const startNew = () => {
        setNotice(null);
        setStartingNew(true);
        agent
            .newConversation()
            .catch((e) => setNotice(failure("Conversation not started", e)))
            .finally(() => setStartingNew(false));
    };
    // the header's buttons fold into one menu when the chat is narrow: a phone, or a page open beside it
    const headerMenu = useContextMenuState();
    let header!: HTMLDivElement;
    const [compact, setCompact] = createSignal(false);
    onMount(() => {
        const measure = new ResizeObserver(() => setCompact(header.clientWidth < PAPER_PANEL_COMPACT_WIDTH));
        measure.observe(header);
        onCleanup(() => measure.disconnect());
    });
    // a bubble's menu, on a right click: answer it, or copy what's selected in it (or all of it)
    const menu = useContextMenuState();
    const [menuOn, setMenuOn] = createSignal<{ said: Said | null; text: string } | null>(null);
    const openMenu = (e: MouseEvent, said: Said | null, text: string, bubble: HTMLElement) => {
        const sel = getSelection();
        const picked = sel && !sel.isCollapsed && bubble.contains(sel.anchorNode) && bubble.contains(sel.focusNode) ? sel.toString() : "";
        setMenuOn({ said, text: picked || text });
        menu.openAtMouse(e);
    };
    const copy = (text: string) => {
        setNotice(null);
        copyText(text).then(
            (ok) => !ok && setNotice({ title: "Message not copied", message: "The clipboard refused it." }),
            (e) => setNotice(failure("Message not copied", e)),
        );
    };
    const byId = (id: string) => agent.entries.find((e): e is Said => e.id === id && (e.kind === "user" || e.kind === "agent"));

    // a waiting sign-in's or prompt's typed values outlive the row redraws; the card drops them when it's answered
    const drafts = new Map<string, SignInDraft>();
    const draftOf = (id: string) => drafts.get(id) ?? drafts.set(id, { values: [], image: null }).get(id)!;

    // another conversation became current: a reply or a sign-in draft from the last one has nothing to point at
    createEffect(() => {
        const r = replyTo();
        if (r && !agent.entries.some((e) => e.id === r.id)) setReplyTo(null);
        for (const id of drafts.keys()) if (!agent.entries.some((e) => e.id === id)) drafts.delete(id);
    });

    // Old transcripts held tool-call entries; only messages, errors, the agent's requests and pages are shown.
    const rows = createMemo<Row[]>(() => {
        const shown = agent.entries.filter((e) => e.kind === "user" || e.kind === "agent" || e.kind === "error" || e.kind === "sign-in" || e.kind === "access" || e.kind === "prompt" || e.kind === "tool-server" || e.kind === "tool-sign-in" || e.kind === "app");
        const items: Pick<Row, "key" | "entry" | "waiting" | "side">[] = [
            ...shown.map((entry) => ({ key: entry.id, entry, waiting: null, side: sideOf(entry) })),
            ...agent.state.chat.waiting.map((w) => ({ key: w.id, entry: null, waiting: w, side: "me" as const })),
        ];
        const gap = (a: (typeof items)[number], b: (typeof items)[number]) => (a.entry && b.entry ? b.entry.at - a.entry.at : 0);
        const near = (a: (typeof items)[number] | undefined, b: (typeof items)[number] | undefined) =>
            !!a && !!b && a.side === b.side && (a.side === "me" || a.side === "them") && gap(a, b) < GROUP_MS;
        return items.map((r, i) => {
            const prev = items[i - 1];
            const next = items[i + 1];
            return {
                ...r,
                stamp: r.entry && (!prev?.entry || r.entry.at - prev.entry.at > STAMP_MS) ? r.entry.at : null,
                joinsPrev: near(prev, r),
                joinsNext: near(r, next),
            };
        });
    });
    // Each row stays one object for as long as it's in the conversation, its fields updated in place, so the list keeps its bubble
    // (and a bubble popping in finishes) instead of drawing it again whenever anything in the conversation changes.
    const [kept, setKept] = createStore<Row[]>([]);
    createComputed(() => setKept(reconcile(rows(), { key: "key" })));

    // the latest rows; scrolling up to the top draws the ones before them
    const [drawn, setDrawn] = createSignal(PAGE_ROWS);
    const visible = createMemo(() => kept.slice(-drawn()));
    // Rows that arrive while the chat is open pop in. A conversation loading (every row new at once) and older rows drawn above don't:
    // the older ones are already in rows(), only drawn later, so they are never new.
    let seen = new Set<string>();
    const arriving = createMemo(() => {
        const keys = rows().map((r) => r.key);
        const fresh = keys.filter((k) => !seen.has(k));
        seen = new Set(keys);
        return new Set(fresh.length === keys.length && keys.length > 1 ? [] : fresh);
    });
    // another conversation starts drawn from its end again
    createEffect(on(() => agent.entries.length === 0, (empty) => empty && setDrawn(PAGE_ROWS)));

    // The typing bubble sits at the end, grouped with the agent's last bubble when that was just now.
    const typingJoins = () => {
        const last = rows().at(-1);
        return !!last && last.side === "them" && !!last.entry && Date.now() - last.entry.at < GROUP_MS;
    };

    // a reply that arrives while the chat is open is felt once, like a text coming in; a conversation loading (every id new) is not a reply
    let known = new Set<string>();
    createEffect(() => {
        const ids = agent.entries.map((e) => e.id);
        const fresh = agent.entries.filter((e) => !known.has(e.id));
        if (known.size > 0 && fresh.length < ids.length && fresh.some((e) => e.kind === "agent")) haptic("receive");
        known = new Set(ids);
    });

    // follow the conversation down as it grows, unless the user scrolled up to read
    let list!: HTMLDivElement;
    let pinned = true;
    // Going to the end is the chat's own doing: the scroll it causes lands a frame later, when the list may have grown again,
    // and must not be read as the reader leaving the end.
    let following = false;
    const follow = () => {
        following = true;
        list.scrollTo({ top: list.scrollHeight });
        requestAnimationFrame(() => (following = false));
    };
    createEffect(
        on(
            () => [agent.entries.length, agent.state.chat.waiting.length, agent.state.chat.typing],
            () =>
                queueMicrotask(() => {
                    watchRows();
                    if (pinned) follow();
                }),
        ),
    );

    // The keyboard rising shrinks the page (the shell resizes the panel's frame for it), and the list with it.
    // A conversation that was at its end stays there; one being read stays where it was, with the focused field in view.
    // The browser may move the scroll position while it lays the smaller list out; that is the page's doing, not the reader's, so it never unpins.
    // A row that grows after it's drawn (a sign-in's picture arriving) moves the end too, so rows are watched as well.
    let listHeight = 0;
    let readingAt = 0;
    let watch: ResizeObserver | undefined;
    let messages!: HTMLDivElement;
    const watchRows = () => {
        for (const row of messages.children) watch?.observe(row);
    };
    onMount(() => {
        listHeight = list.clientHeight;
        watch = new ResizeObserver(() => {
            const grew = list.clientHeight > listHeight;
            const resized = list.clientHeight !== listHeight;
            listHeight = list.clientHeight;
            if (pinned) follow();
            else if (resized) {
                list.scrollTop = readingAt;
                if (!grew && list.contains(document.activeElement)) document.activeElement?.scrollIntoView({ block: "nearest" });
            }
        });
        watch.observe(list);
        watchRows();
        onCleanup(() => watch?.disconnect());
    });

    // more rows above keep what's on screen where it was
    const drawMore = (count = PAGE_ROWS) => {
        const below = list.scrollHeight - list.scrollTop;
        setDrawn((n) => n + count);
        list.scrollTop = list.scrollHeight - below;
    };

    const jumpTo = (id: string) => {
        // a quoted message not drawn yet is drawn first, with a few around it
        const i = rows().findIndex((r) => r.key === id);
        if (i >= 0 && rows().length - i > drawn()) drawMore(rows().length - i - drawn() + PAGE_ROWS / 4);
        const el = list.querySelector<HTMLElement>(`[data-message="${CSS.escape(id)}"]`);
        el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };

    return (
        <div class={styles.page}>
            {/* the conversation is being compacted: it goes on, and what's sent meanwhile waits for it */}
            <Show when={agent.state.chat.compacting}>
                <PaperProgress class={styles.compacting} aria-label={`${name()} is compacting the conversation`} title="Compacting the conversation to save space" />
            </Show>

            <PaperContextMenu open={headerMenu.isOpen()} target={headerMenu.target()} placement={headerMenu.placement()} onClose={() => headerMenu.close()}>
                <PaperContextMenuItem
                    icon="history"
                    onClick={() => {
                        headerMenu.close();
                        setHistoryOpen(true);
                    }}
                >
                    Past conversations
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    icon="add"
                    disabled={!canStartNew()}
                    onClick={() => {
                        headerMenu.close();
                        startNew();
                    }}
                >
                    New conversation
                </PaperContextMenuItem>
            </PaperContextMenu>

            <div
                class={styles.list}
                ref={list}
                onScroll={() => {
                    if (following || list.clientHeight !== listHeight) return;
                    readingAt = list.scrollTop;
                    pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
                    if (list.scrollTop < MORE_AT_PX && drawn() < rows().length) drawMore();
                }}
            >
                {/* who this is, in the middle, and tapping their name opens their computer and settings; the conversation's buttons on the right,
                    folded into one menu when the chat is narrow. It stays at the top of the list, over the conversation scrolling under it */}
                <div class={styles.header} ref={header}>
                    <Face class={styles.face} face={face} size={AVATAR_PX} frame="sphere" hologram skin={skinFor(agent.state.settings?.name)} />
                    <div class={styles.who}>
                        <PaperButton variant="text" size="small" class={styles.name} aria-label={`${name()}: computer and settings`} title="Computer and settings" onClick={() => props.onMenu()}>
                            <span class={styles.nameText}>{name()}</span>
                            <PaperIcon>chevron_right</PaperIcon>
                        </PaperButton>
                        <Show when={status()}>
                            <PaperText preset="hint">{status()}</PaperText>
                        </Show>
                    </div>
                    <div class={styles.side}>
                        <Show
                            when={!compact()}
                            fallback={
                                <PaperButton icon variant="text" aria-label="Conversation menu" title="Conversation menu" onClick={(e) => headerMenu.openBelow(e.currentTarget, { align: "right" })}>
                                    more_horiz
                                </PaperButton>
                            }
                        >
                            <PaperButton icon variant="text" aria-label="Past conversations" title="Past conversations" onClick={() => setHistoryOpen(true)}>
                                history
                            </PaperButton>
                            <PaperButton icon variant="text" aria-label="New conversation" title="New conversation" disabled={!canStartNew()} onClick={startNew}>
                                add
                            </PaperButton>
                        </Show>
                    </div>
                </div>
                <div class={styles.messages} ref={messages} aria-live="polite">
                    <Show when={rows().length === 0}>
                        <PaperFlex flex center>
                            <PaperEmptyState title={`Say hi to ${name()}`} />
                        </PaperFlex>
                    </Show>
                    <For each={visible()}>
                        {(row) => (
                            <>
                                <Show when={row.stamp !== null}>
                                    <PaperFlex align="center" paddingY="half">
                                        <PaperText preset="hint">
                                            {stampText(row.stamp!)}
                                        </PaperText>
                                    </PaperFlex>
                                </Show>
                                <Show when={row.side === "note"}>
                                    <PaperQuote variant="danger" icon="error" title={(row.entry as Extract<ChatEntry, { kind: "error" }>).title} role="alert">
                                        {(row.entry as Extract<ChatEntry, { kind: "error" }>).text}
                                    </PaperQuote>
                                </Show>
                                <Show when={row.side === "card"}>
                                    <SignIn
                                        agent={agent}
                                        entry={row.entry as SignInEntry}
                                        name={name()}
                                        draft={draftOf(row.key)}
                                        onDone={() => drafts.delete(row.key)}
                                    />
                                </Show>
                                <Show when={row.side === "access"}>
                                    <AccessRequest agent={agent} entry={row.entry as AccessEntry} name={name()} />
                                </Show>
                                <Show when={row.side === "prompt"}>
                                    <Prompt agent={agent} entry={row.entry as PromptEntry} name={name()} draft={draftOf(row.key)} onDone={() => drafts.delete(row.key)} />
                                </Show>
                                <Show when={row.side === "tool-server"}>
                                    <ToolServerRequest agent={agent} entry={row.entry as ToolServerEntry} name={name()} />
                                </Show>
                                <Show when={row.side === "tool-sign-in"}>
                                    <ToolSignIn entry={row.entry as ToolSignInEntry} name={name()} />
                                </Show>
                                <Show when={row.side === "app"}>
                                    <PageCard entry={row.entry as PageEntry} pages={props.pages} />
                                </Show>
                                <Show when={row.side === "me" || row.side === "them"}>
                                    <PaperPresence when appear={arriving().has(row.key)} motion="pop">
                                        <Bubble
                                            files={agent.files}
                                            renderImage={agentImage}
                                            row={row}
                                            quoted={(id) => byId(id)}
                                            nameOf={(m) => (m.kind === "user" ? "You" : name())}
                                            onReply={(m) => setReplyTo(m)}
                                            onJump={jumpTo}
                                            onMenu={openMenu}
                                        />
                                    </PaperPresence>
                                </Show>
                            </>
                        )}
                    </For>
                    {/* only while it writes: working with its tools shows on its face, not as typing */}
                    {/* it pops in like a bubble, and goes at once: the reply it turns into takes its place */}
                    <PaperPresence when={agent.state.chat.typing} appear motion="pop" exitClass="">
                        <div class={styles.row} classList={{ [styles.them!]: true, [styles.joinsPrev!]: typingJoins() }} role="status" aria-label={`${name()} is typing`}>
                            <div class={`${styles.bubble} ${styles.typing}`} classList={{ [styles.joinsPrev!]: typingJoins() }} aria-hidden="true">
                                <span class={styles.dot} />
                                <span class={styles.dot} />
                                <span class={styles.dot} />
                            </div>
                        </div>
                    </PaperPresence>
                </div>
            </div>

            <Show when={notice()}>
                {(shown) => (
                    <PaperFlex paddingX="double">
                        <PaperQuote variant="danger" icon="error" title={shown().title} role="alert" onDismiss={() => setNotice(null)}>
                            {shown().message}
                        </PaperQuote>
                    </PaperFlex>
                )}
            </Show>

            <Composer
                agent={agent}
                draft={draft()}
                onDraft={setDraft}
                replyTo={replyTo()}
                replyAuthor={(m) => (m.kind === "user" ? "yourself" : name())}
                onCancelReply={() => setReplyTo(null)}
                onSend={() => {
                    // what's sent is shown, even to someone who had scrolled up to read
                    pinned = true;
                    follow();
                }}
                tray={tray}
            />
            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={() => menu.close()}>
                <Show when={menuOn()?.said}>
                    <PaperContextMenuItem
                        icon="reply"
                        onClick={() => {
                            setReplyTo(menuOn()!.said);
                            menu.close();
                        }}
                    >
                        Reply
                    </PaperContextMenuItem>
                </Show>
                <PaperContextMenuItem
                    icon="content_copy"
                    onClick={() => {
                        copy(menuOn()!.text);
                        menu.close();
                    }}
                >
                    Copy
                </PaperContextMenuItem>
            </PaperContextMenu>
            <History
                agent={agent}
                open={historyOpen()}
                onClose={() => setHistoryOpen(false)}
            />
        </div>
    );
}

const SIDES: Partial<Record<ChatEntry["kind"], Row["side"]>> = { user: "me", agent: "them", "sign-in": "card", access: "access", prompt: "prompt", "tool-server": "tool-server", "tool-sign-in": "tool-sign-in", app: "app" };
const sideOf = (e: ChatEntry): Row["side"] => SIDES[e.kind] ?? "note";

function Bubble(props: {
    row: Row;
    quoted: (id: string) => Said | undefined;
    nameOf: (m: Said) => string;
    onReply: (m: Said) => void;
    onJump: (id: string) => void;
    /** a right click on the bubble: its message, if it's been read, and its text */
    onMenu: (e: MouseEvent, said: Said | null, text: string, bubble: HTMLElement) => void;
    files: Files;
    renderImage: (image: MarkdownImage) => JSX.Element | undefined;
}) {
    const entry = () => props.row.entry as Said | null;
    const text = () => entry()?.text ?? props.row.waiting!.text;
    const replyId = () => entry()?.replyTo ?? props.row.waiting?.replyTo;
    const quote = () => (replyId() ? props.quoted(replyId()!) : undefined);
    const me = () => props.row.side === "me";
    // a finger drags a bubble toward the middle to answer it
    const swipe = createSwipeReply({
        toward: () => (me() ? -1 : 1),
        enabled: () => !!entry(),
        onArm: () => haptic("light"),
        onReply: () => props.onReply(entry()!),
    });
    // the user's files, or the ones the agent sent with a reply to a flow
    const attachments = () => (entry() ? entry()!.attachments : props.row.waiting?.attachments) ?? [];

    return (
        <div
            class={styles.row}
            classList={{ [styles.me!]: me(), [styles.them!]: !me(), [styles.joinsPrev!]: props.row.joinsPrev, [styles.joinsNext!]: props.row.joinsNext }}
            data-message={props.row.key}
            data-paper-no-swipe-back
            {...swipe.handlers}
        >
            <Show when={swipe.active()}>
                <PaperIcon class={styles.swipeIcon} style={{ opacity: swipe.progress() }} aria-hidden="true">
                    reply
                </PaperIcon>
            </Show>
            <div class={styles.bubbleWrap} classList={{ [styles.swiping!]: swipe.active() }} style={{ transform: `translateX(${swipe.offset()}px)` }}>
                <div
                    class={styles.bubble}
                    data-selectable="true"
                    onContextMenu={(e) => props.onMenu(e, entry(), text(), e.currentTarget)}
                    classList={{ [styles.joinsPrev!]: props.row.joinsPrev, [styles.joinsNext!]: props.row.joinsNext }}>
                    <Show when={replyId()}>
                        <button
                            type="button"
                            class={styles.quote}
                            disabled={!quote()}
                            onClick={() => quote() && props.onJump(quote()!.id)}
                            aria-label={quote() ? `Replying to ${props.nameOf(quote()!)}: ${quote()!.text}` : "Replying to an earlier message"}
                        >
                            <span class={styles.quoteWho}>{quote() ? props.nameOf(quote()!) : "Earlier message"}</span>
                            <span class={styles.quoteText}>{quote()?.text ?? ""}</span>
                        </button>
                    </Show>
                    <Show
                        when={me()}
                        fallback={
                            <>
                                <PaperMarkdown class={styles.markdown} text={text()} renderImage={props.renderImage} />
                                <Show when={attachments().length}>
                                    <AttachmentList class={styles.attachments} files={props.files} list={attachments()} />
                                </Show>
                            </>
                        }
                    >
                        <Show when={attachments().length}>
                            <AttachmentList class={styles.attachments} files={props.files} list={attachments()} />
                        </Show>
                        <Show when={text()}>
                            <PaperText preset="body" class={styles.plain}>
                                {text()}
                            </PaperText>
                        </Show>
                    </Show>
                </div>
                <Show when={entry()}>
                    <PaperButton icon size="tiny" variant="text" class={styles.replyButton} aria-label="Reply" title="Reply" onClick={() => props.onReply(entry()!)}>
                        reply
                    </PaperButton>
                </Show>
            </div>
        </div>
    );
}
