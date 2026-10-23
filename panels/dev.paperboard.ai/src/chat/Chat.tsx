import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { PaperIcon, PaperMarkdown, PaperPageHeader } from "@mileniumhq/paperui";
import { Face } from "../face/Face";
import type { FaceController } from "../face/controller";
import type { ChatEntry } from "../contract";
import type { Agent } from "../lib/agent";
import { brainLabel } from "../lib/brains";
import { StartOver } from "../settings/Settings";
import Composer from "./Composer";
import styles from "./Chat.module.css";

const TOOL_ICONS: Record<string, string> = {
    shell: "terminal",
    search: "travel_explore",
    open: "open_in_new",
    look: "visibility",
    zoom: "zoom_in",
    windows: "web_asset",
    click: "ads_click",
    hover: "near_me",
    drag: "drag_pan",
    type: "keyboard",
    key: "keyboard_command_key",
    scroll: "swap_vert",
    place: "open_with",
    close: "close",
};

/** One conversation, like texting a friend. */
export default function Chat(props: { agent: Agent; face: FaceController; onOpenSettings: () => void; onShowComputer: () => void }) {
    const { agent, face } = props;
    const name = () => agent.state.settings?.name ?? "Your agent";

    // thinking while a turn runs
    createEffect(() => face.ponder(agent.state.chat.busy));

    const status = () => {
        if (agent.state.chat.busy) return "Working on it…";
        const c = agent.state.computer;
        if (c.userControl) return "Waiting while you use its computer";
        return (
            {
                none: "No computer yet",
                unsupported: "No computer on this machine",
                installing: "Setting up its computer…",
                starting: "Starting its computer…",
                ready: `Thinks with ${brainLabel(agent.state.settings!)}`,
                stopping: "Turning its computer off…",
                stopped: "Its computer is off",
                failed: "Its computer stopped with a problem",
            } as const
        )[c.phase];
    };

    const [startingOver, setStartingOver] = createSignal(false);

    // follow the conversation down as it grows, unless the user scrolled up to read
    let list!: HTMLDivElement;
    let pinned = true;
    createEffect(
        on(
            () => agent.entries.length,
            () => queueMicrotask(() => pinned && list.scrollTo({ top: list.scrollHeight })),
        ),
    );

    return (
        <div class={styles.page}>
            <div class={styles.header}>
                <PaperPageHeader icon={<Face face={face} size={40} frame="face" />} title={name()} subtitle={status()} />
            </div>

            <div
                class={styles.list}
                ref={list}
                onScroll={() => (pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 48)}
                aria-live="polite"
            >
                <Show when={agent.entries.length === 0}>
                    <p class={styles.empty}>Say hi to {name()}.</p>
                </Show>
                <For each={agent.entries}>{(entry) => <Entry entry={entry} />}</For>
                <Show when={agent.state.chat.busy}>
                    <p class={styles.typing}>{name()} is on it…</p>
                </Show>
            </div>

            <Composer
                agent={agent}
                onOpenSettings={props.onOpenSettings}
                onShowComputer={props.onShowComputer}
                onStartOver={() => setStartingOver(true)}
            />
            <StartOver agent={agent} open={startingOver()} onClose={() => setStartingOver(false)} />
        </div>
    );
}

function Entry(props: { entry: ChatEntry }) {
    return (
        <Switch>
            <Match when={props.entry.kind === "user" && props.entry}>
                {(e) => <p class={styles.user}>{e().text}</p>}
            </Match>
            <Match when={props.entry.kind === "agent" && props.entry}>
                {(e) => <PaperMarkdown class={styles.agent} text={e().text} />}
            </Match>
            <Match when={props.entry.kind === "tool" && (props.entry as Extract<ChatEntry, { kind: "tool" }>)}>
                {(e) => (
                    <div class={styles.tool} classList={{ [styles.failed!]: e().status === "failed" }} title={e().detail ?? undefined}>
                        <PaperIcon>{TOOL_ICONS[e().tool] ?? "build"}</PaperIcon>
                        <span class={styles.toolName}>{e().tool}</span>
                        <span class={styles.toolSummary}>{e().summary}</span>
                        <Show when={e().status === "running"}>
                            <span class={styles.toolStatus}>working</span>
                        </Show>
                        <Show when={e().status === "failed"}>
                            <span class={styles.toolStatus}>failed</span>
                        </Show>
                    </div>
                )}
            </Match>
            <Match when={props.entry.kind === "error" && props.entry}>
                {(e) => (
                    <p class={styles.error} role="alert">
                        <PaperIcon>error</PaperIcon> {e().text}
                    </p>
                )}
            </Match>
        </Switch>
    );
}
