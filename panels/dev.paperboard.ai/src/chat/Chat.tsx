import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { PaperButton, PaperIcon, PaperMarkdown, PaperPageHeader } from "@mileniumhq/paperui";
import { Face } from "../face/Face";
import type { FaceController } from "../face/controller";
import type { ChatEntry, WaitingMessage } from "../contract";
import type { Agent } from "../lib/agent";
import Composer from "./Composer";
import styles from "./Chat.module.css";

/** A message someone can reply to, and be quoted. */
type Said = Extract<ChatEntry, { kind: "user" | "agent" }>;

/** Bubbles from one side this close in time sit together; a longer silence gets a timestamp. */
const GROUP_MS = 2 * 60_000;
const STAMP_MS = 30 * 60_000;

interface Row {
    key: string;
    entry: ChatEntry | null;
    /** a message not yet read by the agent */
    waiting: WaitingMessage | null;
    side: "me" | "them" | "note";
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

    // thinking while the agent is typing
    createEffect(() => face.ponder(agent.state.chat.busy));

    const status = () => {
        if (agent.state.chat.busy) return "typing…";
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
    const [notice, setNotice] = createSignal<string | null>(null);
    const byId = (id: string) => agent.entries.find((e): e is Said => e.id === id && (e.kind === "user" || e.kind === "agent"));

    // Old transcripts held tool-call entries; only messages and errors are shown.
    const rows = createMemo<Row[]>(() => {
        const shown = agent.entries.filter((e) => e.kind === "user" || e.kind === "agent" || e.kind === "error");
        const items: Pick<Row, "key" | "entry" | "waiting" | "side">[] = [
            ...shown.map((entry) => ({ key: entry.id, entry, waiting: null, side: sideOf(entry) })),
            ...agent.state.chat.waiting.map((w) => ({ key: w.id, entry: null, waiting: w, side: "me" as const })),
        ];
        const gap = (a: (typeof items)[number], b: (typeof items)[number]) => (a.entry && b.entry ? b.entry.at - a.entry.at : 0);
        const near = (a: (typeof items)[number] | undefined, b: (typeof items)[number] | undefined) =>
            !!a && !!b && a.side === b.side && a.side !== "note" && gap(a, b) < GROUP_MS;
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
            () => [agent.entries.length, agent.state.chat.waiting.length, agent.state.chat.busy],
            () => queueMicrotask(() => pinned && list.scrollTo({ top: list.scrollHeight })),
        ),
    );

    const jumpTo = (id: string) => {
        const el = list.querySelector<HTMLElement>(`[data-message="${CSS.escape(id)}"]`);
        el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };

    return (
        <div class={styles.page}>
            <div class={styles.header}>
                <PaperPageHeader icon={<Face face={face} size={40} frame="face" />} title={name()} subtitle={status()}>
                    <PaperButton icon variant="text" aria-label="Menu" title="Menu" onClick={() => props.onMenu()}>
                        more_horiz
                    </PaperButton>
                </PaperPageHeader>
            </div>

            <div
                class={styles.list}
                ref={list}
                onScroll={() => (pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 48)}
                aria-live="polite"
            >
                <Show when={rows().length === 0}>
                    <p class={styles.empty}>Say hi to {name()}.</p>
                </Show>
                <For each={rows()}>
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
                            <Show when={row.side !== "note"}>
                                <Bubble
                                    row={row}
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
                                            },
                                            (e) => setNotice(e instanceof Error ? e.message : String(e)),
                                        );
                                    }}
                                />
                            </Show>
                        </>
                    )}
                </For>
                <Show when={agent.state.chat.busy}>
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
            />
        </div>
    );
}

const sideOf = (e: ChatEntry): Row["side"] => (e.kind === "user" ? "me" : e.kind === "agent" ? "them" : "note");

function Bubble(props: {
    row: Row;
    quoted: (id: string) => Said | undefined;
    nameOf: (m: Said) => string;
    onReply: (m: Said) => void;
    onJump: (id: string) => void;
    onTakeBack: (w: WaitingMessage) => void;
}) {
    const entry = () => props.row.entry as Said | null;
    const text = () => entry()?.text ?? props.row.waiting!.text;
    const replyId = () => entry()?.replyTo ?? props.row.waiting?.replyTo;
    const quote = () => (replyId() ? props.quoted(replyId()!) : undefined);
    const me = () => props.row.side === "me";

    return (
        <div
            class={styles.row}
            classList={{ [styles.me!]: me(), [styles.them!]: !me(), [styles.joinsPrev!]: props.row.joinsPrev, [styles.joinsNext!]: props.row.joinsNext }}
            data-message={props.row.key}
        >
            <div class={styles.bubbleWrap}>
                <div class={styles.bubble} classList={{ [styles.waiting!]: !!props.row.waiting, [styles.joinsPrev!]: props.row.joinsPrev, [styles.joinsNext!]: props.row.joinsNext }}>
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
                    <Show when={me()} fallback={<PaperMarkdown class={styles.markdown} text={text()} />}>
                        <span class={styles.plain}>{text()}</span>
                    </Show>
                </div>
                <Show when={entry()}>
                    <button type="button" class={styles.replyButton} aria-label="Reply" title="Reply" onClick={() => props.onReply(entry()!)}>
                        <PaperIcon>reply</PaperIcon>
                    </button>
                </Show>
            </div>
            <Show when={props.row.waiting}>
                <div class={styles.waitingNote}>
                    <span>Waiting</span>
                    <button type="button" class={styles.takeBack} onClick={() => props.onTakeBack(props.row.waiting!)}>
                        Take back
                    </button>
                </div>
            </Show>
        </div>
    );
}
