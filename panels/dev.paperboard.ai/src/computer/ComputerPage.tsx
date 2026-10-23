// The agent's computer: where it stands, and its windows to watch or take
// over. Windows are listed only while this page is open; a list that fails
// stays failed, with a way to try again, instead of retrying behind the
// user's back. Control is held while it's renewed here; leaving the page
// hands it back.

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    PaperButton,
    PaperEmptyState,
    PaperIcon,
    PaperLoader,
    PaperPageHeader,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import type { ComputerBudget, ComputerWindow } from "../contract";
import type { Agent } from "../lib/agent";
import { Budget, DEFAULT_BUDGET, SetupProgress } from "./Computer";
import { WindowView } from "./WindowView";
import styles from "./ComputerPage.module.css";

const WINDOWS_POLL_MS = 2000;
// well inside the service's 20 s lease, so a slow call doesn't let it lapse
const RENEW_MS = 6000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function windowIcon(w: ComputerWindow) {
    const app = w.app.toLowerCase();
    if (app.includes("helium") || app.includes("chrom")) return "language";
    if (app.includes("term")) return "terminal";
    return "web_asset";
}

export default function ComputerPage(props: { agent: Agent }) {
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
                // the guest lists windows in stacking order, which changes whenever one is raised; by id the
                // choice never jumps
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

    // the chosen window, or the first one when it closes
    const shown = createMemo(() => windows.find((w) => w.id === chosen()) ?? windows[0] ?? null);

    const closeWindow = (w: ComputerWindow) =>
        void act(async () => {
            await agent.closeWindow(w.id);
            setWindows(windows.filter((x) => x.id !== w.id));
        });

    // ------------------------------------------------------------- control

    const [holding, setHolding] = createSignal(false);
    const control = (take: boolean) =>
        void act(async () => {
            try {
                await agent.control(take);
                setHolding(take);
            } catch (e) {
                if (take) setHolding(false);
                throw e;
            }
        });
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
    // the lease ended elsewhere (the computer stopped, another window handed it back)
    createEffect(on(() => c().userControl, (now, before) => before && !now && setHolding(false)));
    onCleanup(() => {
        if (holding()) void agent.control(false).catch((e) => console.error("[ai] couldn't hand the computer back:", message(e)));
    });

    // ------------------------------------------------------------- setup

    const [budget, setBudget] = createSignal<ComputerBudget>(DEFAULT_BUDGET);

    const subtitle = () =>
        ({
            none: `${name()} doesn't have a computer yet.`,
            unsupported: "This machine can't run it.",
            installing: "Setting up…",
            starting: "Starting…",
            ready: holding() ? "You're driving. Hand it back when you're done." : c().userControl ? "Someone else is driving." : `On. ${name()} uses it for its work.`,
            stopping: "Stopping…",
            stopped: "Off.",
            failed: c().installed ? "Stopped with a problem." : "Its setup stopped.",
        })[c().phase];

    return (
        <div class={styles.page}>
            <PaperPageHeader icon="computer" title="Computer" subtitle={subtitle()}>
                <Show when={ready()}>
                    <Show
                        when={holding()}
                        fallback={
                            <PaperButton disabled={busy()} onClick={() => control(true)}>
                                <PaperIcon>pan_tool</PaperIcon> Take control
                            </PaperButton>
                        }
                    >
                        <PaperButton variant="primary" disabled={busy()} onClick={() => control(false)}>
                            <PaperIcon>back_hand</PaperIcon> Hand back
                        </PaperButton>
                    </Show>
                    <PaperButton icon disabled={busy()} onClick={() => void act(agent.stopComputer)} aria-label="Turn off" title="Turn off">
                        power_settings_new
                    </PaperButton>
                </Show>
            </PaperPageHeader>

            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>

            <div class={styles.body}>
                <Switch>
                    <Match when={c().phase === "unsupported"}>
                        <PaperEmptyState icon="desktop_access_disabled" title="No computer on this machine" description={c().error ?? undefined} />
                    </Match>
                    <Match when={c().phase === "installing" || (c().phase === "failed" && !c().installed)}>
                        <div class={styles.setup}>
                            <SetupProgress computer={c()} />
                            <Show when={c().phase === "failed"}>
                                <Budget name={name()} value={budget()} onChange={setBudget} />
                                <div>
                                    <PaperButton variant="primary" disabled={busy()} onClick={() => void act(() => agent.installComputer(budget()))}>
                                        <PaperIcon>restart_alt</PaperIcon> Set up again
                                    </PaperButton>
                                </div>
                            </Show>
                        </div>
                    </Match>
                    <Match when={c().phase === "none"}>
                        <div class={styles.setup}>
                            <PaperText size={3}>A Debian virtual machine {name()} uses for its work. Nothing on yours is shared with it.</PaperText>
                            <Budget name={name()} value={budget()} onChange={setBudget} />
                            <div>
                                <PaperButton variant="primary" disabled={busy()} onClick={() => void act(() => agent.installComputer(budget()))}>
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
                        <PaperEmptyState icon="web_asset" title="Nothing is open" description={`When ${name()} opens an app or a page, you can watch it here.`} />
                    </Match>
                    <Match when={shown()}>
                        {(w) => (
                            <div class={styles.windows}>
                                <div class={styles.picker}>
                                    <PaperSelectMenu name="window" aria-label="Window" value={w().id} onValueChange={(v) => setChosen(Number(v))}>
                                        <For each={windows}>
                                            {(x) => (
                                                <PaperSelectMenuItem value={x.id} icon={windowIcon(x)}>
                                                    {x.title || x.app}
                                                </PaperSelectMenuItem>
                                            )}
                                        </For>
                                    </PaperSelectMenu>
                                    <PaperButton icon disabled={busy()} onClick={() => closeWindow(w())} aria-label={`Close ${w().title || w().app}`} title="Close this window">
                                        close
                                    </PaperButton>
                                </div>
                                <Show when={w()} keyed>
                                    {(win) => <WindowView agent={agent} window={win} holding={holding()} />}
                                </Show>
                            </div>
                        )}
                    </Match>
                </Switch>
            </div>
        </div>
    );
}
