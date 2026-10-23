// The panel once the agent exists, in tabs like the terminal panel: the
// conversation, one tab per window open on the agent's computer, and
// settings. Window tabs come and go with the windows; closing one closes the
// window. Control of the computer is held by this shell and renewed while
// it's held; leaving hands it back.

import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PaperButton, PaperIcon, PaperList, PaperListItem, PaperText } from "@mileniumhq/paperui";
import Chat from "./chat/Chat";
import { WindowView } from "./computer/WindowView";
import Settings from "./settings/Settings";
import type { ComputerWindow } from "./contract";
import type { Agent } from "./lib/agent";
import styles from "./Workspace.module.css";

const WINDOWS_POLL_MS = 2000;
// well inside the service's 20 s lease, so a slow call doesn't let it lapse
const RENEW_MS = 6000;

const CHAT = "chat";
const SETTINGS = "settings";
const tabOf = (w: ComputerWindow) => `w${w.id}`;

function windowIcon(w: ComputerWindow) {
    const app = w.app.toLowerCase();
    if (app.includes("helium") || app.includes("chrom")) return "language";
    if (app.includes("term")) return "terminal";
    return "web_asset";
}

export default function Workspace(props: { agent: Agent }) {
    const { agent } = props;
    const [tab, setTab] = createSignal(CHAT);
    const [settingsOpen, setSettingsOpen] = createSignal(false);
    const [windows, setWindows] = createStore<ComputerWindow[]>([]);
    const [listError, setListError] = createSignal<string | null>(null);
    const ready = () => agent.state.computer.phase === "ready";

    // ------------------------------------------------------------- the computer's windows

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = async () => {
        clearTimeout(timer);
        if (disposed) return;
        if (ready() && !document.hidden) {
            try {
                // the guest lists windows in stacking order, which changes whenever one is raised; tabs go by id,
                // a stable order, so a tab never jumps (and the window being used never loses focus to the move)
                const list = (await agent.windows()).sort((a, b) => a.id - b.id);
                setWindows(reconcile(list, { key: "id" }));
                setListError(null);
            } catch (e) {
                setListError(e instanceof Error ? e.message : String(e));
            }
        }
        if (!disposed) timer = setTimeout(() => void refresh(), WINDOWS_POLL_MS);
    };
    createEffect(
        on(ready, (on) => {
            if (on) void refresh();
            else {
                setWindows([]);
                setListError(null);
            }
        }),
    );
    onCleanup(() => {
        disposed = true;
        clearTimeout(timer);
    });

    // a closed window's tab goes with it
    createEffect(() => {
        const t = tab();
        if (t !== CHAT && t !== SETTINGS && !windows.some((w) => tabOf(w) === t)) setTab(CHAT);
    });

    const closeWindow = async (w: ComputerWindow) => {
        try {
            await agent.closeWindow(w.id);
            setWindows(windows.filter((x) => x.id !== w.id));
        } catch (e) {
            setListError(`Couldn't close ${w.title || w.app}: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    // ------------------------------------------------------------- control

    const [holding, setHolding] = createSignal(false);
    const [controlBusy, setControlBusy] = createSignal(false);
    const control = async (take: boolean) => {
        setControlBusy(true);
        try {
            await agent.control(take);
            setHolding(take);
        } catch (e) {
            setListError(e instanceof Error ? e.message : String(e));
            if (take) setHolding(false);
        } finally {
            setControlBusy(false);
        }
    };
    createEffect(() => {
        if (!holding()) return;
        const renew = setInterval(
            () =>
                void agent.control(true).catch((e) => {
                    setHolding(false);
                    setListError(`You lost control of the computer: ${e instanceof Error ? e.message : String(e)}`);
                }),
            RENEW_MS,
        );
        onCleanup(() => clearInterval(renew));
    });
    // the lease ended elsewhere (the computer stopped, another window handed it back)
    createEffect(on(() => agent.state.computer.userControl, (now, before) => before && !now && setHolding(false)));
    onCleanup(() => {
        if (holding()) void agent.control(false).catch((e) => console.error("[ai] couldn't hand the computer back:", String(e)));
    });

    const openSettings = () => {
        setSettingsOpen(true);
        setTab(SETTINGS);
    };

    return (
        <div class={styles.workspace}>
            <div class={styles.tabs}>
                <PaperList direction="horizontal" name="ai-tabs" value={tab()} onValueChange={(v) => setTab(String(v))}>
                    <PaperListItem icon="forum" value={CHAT}>
                        {agent.state.settings?.name ?? "Chat"}
                    </PaperListItem>
                    <For each={windows}>
                        {(w) => (
                            <PaperListItem icon={windowIcon(w)} value={tabOf(w)} onClosed={() => void closeWindow(w)}>
                                {w.title || w.app}
                            </PaperListItem>
                        )}
                    </For>
                    <Show when={settingsOpen()}>
                        <PaperListItem
                            icon="settings"
                            value={SETTINGS}
                            onClosed={() => {
                                setSettingsOpen(false);
                                if (tab() === SETTINGS) setTab(CHAT);
                            }}
                        >
                            Settings
                        </PaperListItem>
                    </Show>
                </PaperList>
                <Show when={!settingsOpen()}>
                    <PaperButton size="tiny" icon onClick={openSettings} title="Settings" aria-label="Settings">
                        <PaperIcon>settings</PaperIcon>
                    </PaperButton>
                </Show>
            </div>
            <Show when={listError()}>
                <PaperText size={1} color="danger" role="alert" class={styles.listError}>
                    {listError()}
                </PaperText>
            </Show>

            <div class={styles.content}>
                <div class={styles.pane} classList={{ [styles.shown!]: tab() === CHAT }}>
                    <Chat
                        agent={agent}
                        onOpenSettings={openSettings}
                        onShowComputer={() => {
                            const first = windows[0];
                            if (first) setTab(tabOf(first));
                            else setListError("Nothing is open on the computer right now.");
                        }}
                    />
                </div>
                <For each={windows}>
                    {(w) => (
                        <div class={styles.pane} classList={{ [styles.shown!]: tab() === tabOf(w) }}>
                            <WindowView
                                agent={agent}
                                window={w}
                                active={tab() === tabOf(w)}
                                holding={holding()}
                                controlBusy={controlBusy()}
                                onTakeControl={() => void control(true)}
                                onHandBack={() => void control(false)}
                            />
                        </div>
                    )}
                </For>
                <Show when={settingsOpen()}>
                    <div class={styles.pane} classList={{ [styles.shown!]: tab() === SETTINGS }}>
                        <Settings agent={agent} />
                    </div>
                </Show>
            </div>
        </div>
    );
}
