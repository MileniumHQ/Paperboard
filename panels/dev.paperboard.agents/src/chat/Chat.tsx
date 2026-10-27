import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js";
import { PaperButton, PaperIcon, haptic, PaperMarkdown, PaperPageHeader, PaperProgress, type MarkdownImage } from "@mileniumhq/paperui";
import { Face } from "../face/Face";
import { skinFor } from "../face/skins";
import type { FaceController } from "../face/controller";
import type { ChatEntry, SignInEntry, WaitingMessage } from "../contract";
import type { Agent } from "../lib/agent";
import type { Files } from "../lib/files";
import Composer from "./Composer";
import { AttachmentList, renderAgentImage } from "./Media";
import { createTray } from "./tray";
import History from "./History";
import { createSwipeReply } from "./swipeReply";
import SignIn, { type SignInDraft } from "./SignIn";
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

interface Row {
    key: string;
    entry: ChatEntry | null;
    /** a message not yet read by the agent */
    waiting: WaitingMessage | null;
    side: "me" | "them" | "note" | "card";
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
export default function Chat(props: { agent: Agent; face: FaceController; onMenu: () => void }) {
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
    const [notice, setNotice] = createSignal<string | null>(null);
    const [historyOpen, setHistoryOpen] = createSignal(false);
    const [startingNew, setStartingNew] = createSignal(false);
    const byId = (id: string) => agent.entries.find((e): e is Said => e.id === id && (e.kind === "user" || e.kind === "agent"));

    // a waiting sign-in's typed values outlive the row redraws; the card drops them when it's answered
    const drafts = new Map<string, SignInDraft>();
    const draftOf = (id: string) => drafts.get(id) ?? drafts.set(id, { values: [], image: null }).get(id)!;

    // another conversation became current: a reply or a sign-in draft from the last one has nothing to point at
    createEffect(() => {
        const r = replyTo();
        if (r && !agent.entries.some((e) => e.id === r.id)) setReplyTo(null);
        for (const id of drafts.keys()) if (!agent.entries.some((e) => e.id === id)) drafts.delete(id);
    });

    // Old transcripts held tool-call entries; only messages, errors and sign-in requests are shown.
    const rows = createMemo<Row[]>(() => {
        const shown = agent.entries.filter((e) => e.kind === "user" || e.kind === "agent" || e.kind === "error" || e.kind === "sign-in");
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

    // the latest rows; scrolling up to the top draws the ones before them
    const [drawn, setDrawn] = createSignal(PAGE_ROWS);
    const visible = createMemo(() => rows().slice(-drawn()));
    // another conversation starts drawn from its end again
    createEffect(on(() => agent.entries.length === 0, (empty) => empty && setDrawn(PAGE_ROWS)));

    // The typing bubble sits at the end, grouped with the agent's last bubble when that was just now.
    const typingJoins = () => {
        const last = rows().at(-1);
        return !!last && last.side === "them" && !!last.entry && Date.now() - last.entry.at < GROUP_MS;
    };

    // follow the conversation down as it grows, unless the user scrolled up to read
    let list!: HTMLDivElement;
    let pinned = true;
    createEffect(
        on(
            () => [agent.entries.length, agent.state.chat.waiting.length, agent.state.chat.typing],
            () => queueMicrotask(() => pinned && list.scrollTo({ top: list.scrollHeight })),
        ),
    );

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
            <div class={styles.header}>
                <PaperPageHeader icon={<Face face={face} size={40} frame="sphere" skin={skinFor(agent.state.settings?.name)} />} title={name()} subtitle={status()}>
                    <PaperButton icon variant="text" aria-label="Past conversations" title="Past conversations" onClick={() => setHistoryOpen(true)}>
                        history
                    </PaperButton>
                    <PaperButton
                        icon
                        variant="text"
                        aria-label="New conversation"
                        title="New conversation"
                        disabled={startingNew() || agent.entries.length === 0}
                        onClick={() => {
                            setNotice(null);
                            setStartingNew(true);
                            agent
                                .newConversation()
                                .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
                                .finally(() => setStartingNew(false));
                        }}
                    >
                        add
                    </PaperButton>
                    <PaperButton icon variant="text" aria-label="Menu" title="Menu" onClick={() => props.onMenu()}>
                        more_horiz
                    </PaperButton>
                </PaperPageHeader>
            </div>

            <div
                class={styles.list}
                ref={list}
                onScroll={() => {
                    pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
                    if (list.scrollTop < MORE_AT_PX && drawn() < rows().length) drawMore();
                }}
                aria-live="polite"
            >
                <Show when={rows().length === 0}>
                    <p class={styles.empty}>Say hi to {name()}.</p>
                </Show>
                <For each={visible()}>
                    {(row) => (
                        <>
                            <Show when={row.stamp !== null}>
                                <p class={styles.stamp}>{stampText(row.stamp!)}</p>
                            </Show>
                            <Show when={row.side === "note"}>
                                <p class={styles.error} role="alert">
                                    <PaperIcon>error</PaperIcon> {(row.entry as { text: string }).text}
                                </p>
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
                            <Show when={row.side === "me" || row.side === "them"}>
                                <Bubble
                                    files={agent.files}
                                    renderImage={agentImage}
                                    row={row}
                                    held={agent.state.chat.held}
                                    quoted={(id) => byId(id)}
                                    nameOf={(m) => (m.kind === "user" ? "You" : name())}
                                    onReply={(m) => setReplyTo(m)}
                                    onJump={jumpTo}
                                    onTakeBack={(w) => {
                                        // taken back into the box, so it can be edited and sent again
                                        setNotice(null);
                                        agent.unqueue(w.id).then(
                                            () => {
                                                if (!draft().trim()) setDraft(w.text);
                                                if (w.attachments?.length) tray.restore(w.attachments);
                                            },
                                            (e) => setNotice(e instanceof Error ? e.message : String(e)),
                                        );
                                    }}
                                />
                            </Show>
                        </>
                    )}
                </For>
                {/* only while it writes: working with its tools shows on its face, not as typing */}
                <Show when={agent.state.chat.typing}>
                    <div class={styles.row} classList={{ [styles.them!]: true, [styles.joinsPrev!]: typingJoins() }} role="status" aria-label={`${name()} is typing`}>
                        <div class={`${styles.bubble} ${styles.typing}`} classList={{ [styles.joinsPrev!]: typingJoins() }} aria-hidden="true">
                            <span class={styles.dot} />
                            <span class={styles.dot} />
                            <span class={styles.dot} />
                        </div>
                    </div>
                </Show>
            </div>

            <Show when={notice()}>
                <p class={styles.error} role="alert">
                    <PaperIcon>error</PaperIcon> {notice()}
                </p>
            </Show>

            <Composer
                agent={agent}
                draft={draft()}
                onDraft={setDraft}
                replyTo={replyTo()}
                replyAuthor={(m) => (m.kind === "user" ? "yourself" : name())}
                onCancelReply={() => setReplyTo(null)}
                tray={tray}
            />
            <History
                agent={agent}
                open={historyOpen()}
                onClose={() => setHistoryOpen(false)}
            />
        </div>
    );
}

const sideOf = (e: ChatEntry): Row["side"] => (e.kind === "user" ? "me" : e.kind === "agent" ? "them" : e.kind === "sign-in" ? "card" : "note");

function Bubble(props: {
    row: Row;
    /** waiting messages are held for the user to finish typing: as good as sent, so they show as sent */
    held: boolean;
    quoted: (id: string) => Said | undefined;
    nameOf: (m: Said) => string;
    onReply: (m: Said) => void;
    onJump: (id: string) => void;
    onTakeBack: (w: WaitingMessage) => void;
    files: Files;
    renderImage: (image: MarkdownImage) => JSX.Element | undefined;
}) {
    const entry = () => props.row.entry as Said | null;
    const text = () => entry()?.text ?? props.row.waiting!.text;
    const replyId = () => entry()?.replyTo ?? props.row.waiting?.replyTo;
    const quote = () => (replyId() ? props.quoted(replyId()!) : undefined);
    const me = () => props.row.side === "me";
    const waiting = () => (props.row.waiting && !props.held ? props.row.waiting : null);
    // a finger drags a bubble toward the middle to answer it
    const swipe = createSwipeReply({
        toward: () => (me() ? -1 : 1),
        enabled: () => !!entry(),
        onArm: () => haptic("light"),
        onReply: () => props.onReply(entry()!),
    });
    const attachments = () => (entry()?.kind === "user" ? (entry() as Extract<Said, { kind: "user" }>).attachments : props.row.waiting?.attachments) ?? [];

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
                <div class={styles.bubble} classList={{ [styles.waiting!]: !!waiting(), [styles.joinsPrev!]: props.row.joinsPrev, [styles.joinsNext!]: props.row.joinsNext }}>
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
                    <Show when={me()} fallback={<PaperMarkdown class={styles.markdown} text={text()} renderImage={props.renderImage} />}>
                        <Show when={attachments().length}>
                            <AttachmentList class={styles.attachments} files={props.files} list={attachments()} />
                        </Show>
                        <Show when={text()}>
                            <span class={styles.plain}>{text()}</span>
                        </Show>
                    </Show>
                </div>
                <Show when={entry()}>
                    <PaperButton icon size="tiny" variant="text" class={styles.replyButton} aria-label="Reply" title="Reply" onClick={() => props.onReply(entry()!)}>
                        reply
                    </PaperButton>
                </Show>
            </div>
            <Show when={waiting()}>
                <div class={styles.waitingNote}>
                    <span>Waiting</span>
                    <button type="button" class={styles.takeBack} onClick={() => props.onTakeBack(waiting()!)}>
                        Take back
                    </button>
                </div>
            </Show>
        </div>
    );
}
