import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperIcon, PaperMarkdown } from "@mileniumhq/paperui";
import { Face } from "../face/Face";
import { createFace } from "../face/controller";
import { Budget, DEFAULT_BUDGET, SetupProgress } from "../computer/Computer";
import type { ChatEntry, ComputerBudget } from "../contract";
import type { Agent } from "../lib/agent";
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
export default function Chat(props: { agent: Agent; onOpenSettings: () => void; onShowComputer: () => void }) {
    const { agent } = props;
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);
    const name = () => agent.state.settings?.name ?? "Your agent";

    // thinking while a turn runs
    createEffect(() => face.ponder(agent.state.chat.busy));

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
            <header class={styles.header}>
                <Face face={face} size={40} frame="face" />
                <div class={styles.who}>
                    <h1 class={styles.name}>{name()}</h1>
                    <ComputerBar agent={agent} name={name()} />
                </div>
            </header>

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

/** Where the agent's computer stands, and the way forward from every state it can be in. */
function ComputerBar(props: { agent: Agent; name: string }) {
    const c = () => props.agent.state.computer;
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [choosing, setChoosing] = createSignal(false);
    const [budget, setBudget] = createSignal<ComputerBudget>(DEFAULT_BUDGET);
    const act = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const choose = () => {
        setBudget(c().budget ?? DEFAULT_BUDGET);
        setChoosing(true);
    };
    // a failed setup shows where it stopped until it's tried again
    const showSetup = () => c().phase === "installing" || (c().phase === "failed" && !c().installed);

    return (
        <>
            <div class={styles.computer}>
                <Switch>
                    <Match when={c().phase === "ready"}>
                        <span>Computer on</span>
                        <PaperButton size="tiny" variant="text" disabled={busy()} onClick={() => void act(props.agent.stopComputer)}>
                            Turn off
                        </PaperButton>
                    </Match>
                    <Match when={c().phase === "starting"}>
                        <span>Computer starting…</span>
                    </Match>
                    <Match when={c().phase === "installing"}>
                        <span>Setting up the computer…</span>
                    </Match>
                    <Match when={c().phase === "stopping"}>
                        <span>Computer stopping…</span>
                    </Match>
                    <Match when={c().phase === "stopped"}>
                        <span>Computer off</span>
                        <PaperButton size="tiny" variant="text" disabled={busy()} onClick={() => void act(props.agent.startComputer)}>
                            Turn on
                        </PaperButton>
                    </Match>
                    <Match when={c().phase === "failed" && c().installed}>
                        <span class={styles.computerError}>Computer: {c().error}</span>
                        <PaperButton size="tiny" variant="text" disabled={busy()} onClick={() => void act(props.agent.startComputer)}>
                            Try again
                        </PaperButton>
                    </Match>
                    <Match when={c().phase === "failed"}>
                        <span class={styles.computerError}>The computer's setup stopped</span>
                        <PaperButton size="tiny" variant="text" disabled={busy() || choosing()} onClick={choose}>
                            Set up again
                        </PaperButton>
                    </Match>
                    <Match when={c().phase === "unsupported"}>
                        <span class={styles.computerError} title={c().error ?? undefined}>
                            No computer: {c().error}
                        </span>
                    </Match>
                    <Match when={c().phase === "none"}>
                        <span>No computer yet</span>
                        <PaperButton size="tiny" variant="text" disabled={busy() || choosing()} onClick={choose}>
                            Set up
                        </PaperButton>
                    </Match>
                </Switch>
            </div>
            <Show when={error()}>
                <p class={styles.computerError} role="alert">
                    {error()}
                </p>
            </Show>
            <Show when={choosing() || showSetup()}>
                <section class={styles.setup} aria-label={`${props.name}'s computer`}>
                    <Show when={showSetup() && !choosing()}>
                        <SetupProgress computer={c()} />
                    </Show>
                    <Show when={choosing()}>
                        <Budget name={props.name} value={budget()} onChange={setBudget} />
                        <div class={styles.setupActions}>
                            <PaperButton
                                variant="primary"
                                disabled={busy()}
                                onClick={async () => {
                                    if (await act(() => props.agent.installComputer(budget()))) setChoosing(false);
                                }}
                            >
                                Set up {props.name}'s computer
                            </PaperButton>
                            <PaperButton variant="text" onClick={() => setChoosing(false)}>
                                Cancel
                            </PaperButton>
                        </div>
                    </Show>
                </section>
            </Show>
        </>
    );
}
