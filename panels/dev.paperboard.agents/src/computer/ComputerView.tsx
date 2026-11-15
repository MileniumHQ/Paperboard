// The agent's computer, laid out like the terminal panel: a tab for each of
// its windows, the chosen one live below. Using a window takes control of
// the computer (the agent's hands wait); a few idle seconds hand it back, and
// so does closing this view. Windows are listed only while it's open; a list
// that fails stays failed, with Try again, instead of retrying behind the
// user's back.

import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { ComputerWindow } from "../contract";
import type { Agent } from "../lib/agent";
import { SetupProgress } from "./Computer";
import { createAction } from "../lib/action";
import { errorText, failure } from "../lib/failure";
import { clip } from "../lib/text";
import { WindowView } from "./WindowView";
import styles from "./ComputerView.module.css";

const WINDOWS_POLL_MS = 2000;
// well inside the service's 20 s lease, so a slow call doesn't let it lapse
const RENEW_MS = 6000;
// how long after the user's last click or key the agent gets its computer back
const IDLE_MS = 5000;


/** a tab shows this much of a window's title; the rest is an ellipsis, and the whole title its tooltip */
const TITLE_CHARS = 32;


export default function ComputerView(props: { agent: Agent }) {
    const c = () => props.agent.state.computer;
    const name = () => props.agent.state.settings?.name ?? "Your agent";
    const ready = () => c().phase === "ready";

    const { busy, error, setError, run: act } = createAction();

    // ------------------------------------------------------------- its windows

    const [windows, setWindows] = createStore<ComputerWindow[]>([]);
    const [listError, setListError] = createSignal<string | null>(null);
    const [listed, setListed] = createSignal(false);
    const [chosen, setChosen] = createSignal<number | null>(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    // one poll at a time: starting another, or stopping, makes an answer still on its way the old poll's, and it is dropped
    let poll = 0;
    const stopPolling = () => {
        poll++;
        clearTimeout(timer);
    };
    const refresh = async () => {
        stopPolling();
        const mine = poll;
        if (disposed || !ready() || listError()) return;
        if (!document.hidden) {
            try {
                // tabs go by id, so a tab never jumps (and the window being used never loses focus to a move)
                const list = (await props.agent.windows()).sort((a, b) => a.id - b.id);
                if (mine !== poll) return;
                setWindows(reconcile(list, { key: "id" }));
                setListed(true);
            } catch (e) {
                // shown once, until the user tries again; polling a failure would only repeat it
                if (mine === poll) setListError(errorText(e));
                return;
            }
        }
        timer = setTimeout(() => void refresh(), WINDOWS_POLL_MS);
    };
    createEffect(
        on(ready, (on) => {
            setListError(null);
            if (on) void refresh();
            else {
                stopPolling();
                setWindows([]);
                setListed(false);
            }
        }),
    );
    onCleanup(() => {
        disposed = true;
        stopPolling();
    });
    const retryList = () => {
        setListError(null);
        void refresh();
    };

    // the chosen tab, or the first when it closes
    const shown = () => (windows.some((w) => w.id === chosen()) ? chosen() : (windows[0]?.id ?? null));

    const closeWindow = (w: ComputerWindow) =>
        void act("Window not closed", async () => {
            await props.agent.closeWindow(w.id);
            setWindows(windows.filter((x) => x.id !== w.id));
        });

    // ------------------------------------------------------------- control, taken by using it

    const [holding, setHolding] = createSignal(false);
    let taking: Promise<void> | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const giveBack = () =>
        props.agent.control(false).catch((e) => {
            // closed meanwhile: nowhere on the page is left to say it, and the service's lease frees the agent anyway
            if (disposed) console.error("[agents] computer not handed back:", e);
            else setError(failure("Computer not handed back", e));
        });
    const handBack = () => {
        clearTimeout(idle);
        if (!holding()) return;
        setHolding(false);
        void giveBack();
    };
    const use = async () => {
        clearTimeout(idle);
        idle = setTimeout(handBack, IDLE_MS);
        if (holding()) return;
        taking ??= props.agent
            .control(true)
            .then(() => {
                // taken just as the view closed: it goes straight back
                if (disposed) void giveBack();
                else setHolding(true);
            })
            .finally(() => (taking = null));
        await taking;
    };
    createEffect(
        on(holding, (held) => {
            if (!held) return;
            const renew = setInterval(
                () =>
                    void props.agent.control(true).catch((e) => {
                        setHolding(false);
                        setError(failure("Control lost", e));
                    }),
                RENEW_MS,
            );
            onCleanup(() => clearInterval(renew));
        }),
    );
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
                {(shown) => (
                    <PaperFlex paddingX="full" paddingY="half">
                        <PaperQuote variant="danger" icon="error" title={shown().title} role="alert" onDismiss={() => setError(null)}>
                            {shown().message}
                        </PaperQuote>
                    </PaperFlex>
                )}
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
                                <PaperFlex direction="row">
                                    <PaperButton variant="primary" disabled={busy()} onClick={() => void act("Computer not set up", props.agent.installComputer)}>
                                        <PaperIcon>restart_alt</PaperIcon> Set up again
                                    </PaperButton>
                                </PaperFlex>
                            </Show>
                        </div>
                    </Match>
                    <Match when={c().phase === "none"}>
                        <div class={styles.setup}>
                            <PaperText preset="text">
                                A web browser of its own that {name()} uses for its work, about 400 MB of storage. It reaches the internet, never your files or your network.
                            </PaperText>
                            <PaperFlex direction="row">
                                <PaperButton variant="primary" disabled={busy()} onClick={() => void act("Computer not set up", props.agent.installComputer)}>
                                    <PaperIcon>computer</PaperIcon> Set up {name()}'s computer
                                </PaperButton>
                            </PaperFlex>
                        </div>
                    </Match>
                    <Match when={c().phase === "starting" || c().phase === "stopping"}>
                        <PaperFlex center>
                            <PaperLoader loaderStatus="indeterminate" label={c().phase === "starting" ? "Starting" : "Stopping"} />
                        </PaperFlex>
                    </Match>
                    <Match when={c().phase === "stopped"}>
                        <PaperEmptyState icon="power_settings_new" title="The computer is off" description={`${name()} turns it on when it needs it, or you can now.`}>
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act("Computer not turned on", props.agent.startComputer)}>
                                Turn on
                            </PaperButton>
                        </PaperEmptyState>
                    </Match>
                    <Match when={c().phase === "failed"}>
                        <PaperEmptyState icon="error" title="The computer stopped" description={c().error ?? undefined}>
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act("Computer not turned on", props.agent.startComputer)}>
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
                        <PaperFlex center>
                            <PaperLoader loaderStatus="indeterminate" label="Looking" />
                        </PaperFlex>
                    </Match>
                    <Match when={windows.length === 0}>
                        <PaperEmptyState icon="web_asset" title="Nothing is open" description={`When ${name()} opens a page, you can watch it here.`} />
                    </Match>
                    <Match when={true}>
                        {/* every tab stays mounted (a window keeps its last frame); only the chosen one shows and polls */}
                        <For each={windows}>
                            {(w) => (
                                <div class={styles.pane} classList={{ [styles.shown!]: shown() === w.id }}>
                                    <WindowView agent={props.agent} window={w} active={shown() === w.id} holding={holding()} onUse={use} />
                                </div>
                            )}
                        </For>
                    </Match>
                </Switch>
            </div>
        </div>
    );
}
