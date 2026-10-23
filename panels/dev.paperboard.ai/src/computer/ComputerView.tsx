// The agent's computer, laid out like the terminal panel: a tab for each of
// its windows, the chosen one live below. Using a window takes control of
// the computer (the agent's hands wait); a few idle seconds hand it back, and
// so does closing this view. Windows are listed only while it's open; a list
// that fails stays failed, with Try again, instead of retrying behind the
// user's back.

import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PaperButton, PaperEmptyState, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperText } from "@mileniumhq/paperui";
import type { ComputerWindow } from "../contract";
import type { Agent } from "../lib/agent";
import { SetupProgress } from "./Computer";
import { clip } from "../lib/text";
import { WindowView } from "./WindowView";
import styles from "./ComputerView.module.css";

const WINDOWS_POLL_MS = 2000;
// well inside the service's 20 s lease, so a slow call doesn't let it lapse
const RENEW_MS = 6000;
// how long after the user's last click or key the agent gets its computer back
const IDLE_MS = 5000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** a tab shows this much of a window's title; the rest is an ellipsis, and the whole title its tooltip */
const TITLE_CHARS = 32;


export default function ComputerView(props: { agent: Agent }) {
    const { agent } = props;
    const c = () => agent.state.computer;
    const name = () => agent.state.settings?.name ?? "Your agent";
    const ready = () => c().phase === "ready";

    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const act = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
            return true;
        } catch (e) {
            setError(message(e));
            return false;
        } finally {
            setBusy(false);
        }
    };

    // ------------------------------------------------------------- its windows

    const [windows, setWindows] = createStore<ComputerWindow[]>([]);
    const [listError, setListError] = createSignal<string | null>(null);
    const [listed, setListed] = createSignal(false);
    const [chosen, setChosen] = createSignal<number | null>(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = async () => {
        clearTimeout(timer);
        if (disposed || !ready() || listError()) return;
        if (!document.hidden) {
            try {
                // tabs go by id, so a tab never jumps (and the window being used never loses focus to a move)
                const list = (await agent.windows()).sort((a, b) => a.id - b.id);
                setWindows(reconcile(list, { key: "id" }));
                setListed(true);
            } catch (e) {
                // shown once, until the user tries again; polling a failure would only repeat it
                setListError(message(e));
                return;
            }
        }
        if (!disposed) timer = setTimeout(() => void refresh(), WINDOWS_POLL_MS);
    };
    createEffect(
        on(ready, (on) => {
            setListError(null);
            if (on) void refresh();
            else {
                clearTimeout(timer);
                setWindows([]);
                setListed(false);
            }
        }),
    );
    onCleanup(() => {
        disposed = true;
        clearTimeout(timer);
    });
    const retryList = () => {
        setListError(null);
        void refresh();
    };

    // the chosen tab, or the first when it closes
    const shown = () => (windows.some((w) => w.id === chosen()) ? chosen() : (windows[0]?.id ?? null));

    const closeWindow = (w: ComputerWindow) =>
        void act(async () => {
            await agent.closeWindow(w.id);
            setWindows(windows.filter((x) => x.id !== w.id));
        });

    // ------------------------------------------------------------- control, taken by using it

    const [holding, setHolding] = createSignal(false);
    let taking: Promise<void> | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const handBack = () => {
        clearTimeout(idle);
        if (!holding()) return;
        setHolding(false);
        void agent.control(false).catch((e) => setError(`Couldn't hand the computer back: ${message(e)}`));
    };
    const use = async () => {
        clearTimeout(idle);
        idle = setTimeout(handBack, IDLE_MS);
        if (holding()) return;
        taking ??= agent
            .control(true)
            .then(() => {
                if (!disposed) setHolding(true);
            })
            .finally(() => (taking = null));
        await taking;
    };
    createEffect(() => {
        if (!holding()) return;
        const renew = setInterval(
            () =>
                void agent.control(true).catch((e) => {
                    setHolding(false);
                    setError(`You lost control of the computer: ${message(e)}`);
                }),
            RENEW_MS,
        );
        onCleanup(() => clearInterval(renew));
    });
    // the lease ended elsewhere (the computer stopped)
    createEffect(on(() => c().userControl, (now, before) => before && !now && setHolding(false)));
    onCleanup(handBack);

    return (
        <div class={styles.view}>
            <Show when={ready() && windows.length > 0}>
                <PaperList direction="horizontal" name="computer-windows" value={shown() ?? ""} onValueChange={(v) => setChosen(Number(v))}>
                    <For each={windows}>
                        {(w) => (
                            <PaperListItem icon="language" value={w.id} onClosed={() => closeWindow(w)} title={w.title || w.app}>
                                {clip(w.title || w.app, TITLE_CHARS)}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </Show>
            <Show when={error()}>
                <PaperText size={1} color="danger" role="alert" class={styles.error}>
                    {error()}
                </PaperText>
            </Show>

            <div class={styles.content}>
                <Switch>
                    <Match when={c().phase === "unsupported"}>
                        <PaperEmptyState icon="desktop_access_disabled" title="No computer on this machine" description={c().error ?? undefined} />
                    </Match>
                    <Match when={c().phase === "installing" || (c().phase === "failed" && !c().installed)}>
                        <div class={styles.setup}>
                            <SetupProgress computer={c()} />
                            <Show when={c().phase === "failed"}>
                                <div>
                                    <PaperButton variant="primary" disabled={busy()} onClick={() => void act(agent.installComputer)}>
                                        <PaperIcon>restart_alt</PaperIcon> Set up again
                                    </PaperButton>
                                </div>
                            </Show>
                        </div>
                    </Match>
                    <Match when={c().phase === "none"}>
                        <div class={styles.setup}>
                            <PaperText size={3}>
                                A web browser of its own that {name()} uses for its work, about 400 MB of storage. It reaches the internet, never your files or your network.
                            </PaperText>
                            <div>
                                <PaperButton variant="primary" disabled={busy()} onClick={() => void act(agent.installComputer)}>
                                    <PaperIcon>computer</PaperIcon> Set up {name()}'s computer
                                </PaperButton>
                            </div>
                        </div>
                    </Match>
                    <Match when={c().phase === "starting" || c().phase === "stopping"}>
                        <div class={styles.center}>
                            <PaperLoader loaderStatus="indeterminate" label={c().phase === "starting" ? "Starting" : "Stopping"} />
                        </div>
                    </Match>
                    <Match when={c().phase === "stopped"}>
                        <PaperEmptyState icon="power_settings_new" title="The computer is off" description={`${name()} turns it on when it needs it, or you can now.`}>
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act(agent.startComputer)}>
                                Turn on
                            </PaperButton>
                        </PaperEmptyState>
                    </Match>
                    <Match when={c().phase === "failed"}>
                        <PaperEmptyState icon="error" title="The computer stopped" description={c().error ?? undefined}>
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act(agent.startComputer)}>
                                Try again
                            </PaperButton>
                        </PaperEmptyState>
                    </Match>
                    <Match when={listError()}>
                        <PaperEmptyState icon="web_asset_off" title="Couldn't see its windows" description={listError() ?? undefined}>
                            <PaperButton variant="primary" onClick={retryList}>
                                Try again
                            </PaperButton>
                        </PaperEmptyState>
                    </Match>
                    <Match when={!listed()}>
                        <div class={styles.center}>
                            <PaperLoader loaderStatus="indeterminate" label="Looking" />
                        </div>
                    </Match>
                    <Match when={windows.length === 0}>
                        <PaperEmptyState icon="web_asset" title="Nothing is open" description={`When ${name()} opens a page, you can watch it here.`} />
                    </Match>
                    <Match when={true}>
                        {/* every tab stays mounted (a window keeps its last frame); only the chosen one shows and polls */}
                        <For each={windows}>
                            {(w) => (
                                <div class={styles.pane} classList={{ [styles.shown!]: shown() === w.id }}>
                                    <WindowView agent={agent} window={w} active={shown() === w.id} holding={holding()} onUse={use} />
                                </div>
                            )}
                        </For>
                    </Match>
                </Switch>
            </div>
        </div>
    );
}
