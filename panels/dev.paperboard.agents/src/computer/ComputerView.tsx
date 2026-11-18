// The agent's computer, laid out like the terminal panel: a tab for each of
// its windows, the chosen one live below. Using a window takes control of
// the computer (the agent's hands wait); a few idle seconds hand it back, and
// so does closing this view. Windows are listed only while it's open; a list
// that fails stays failed, with Try again, instead of retrying behind the
// user's back.

import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperError, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, createAction, createPolling, createRead, showError } from "@mileniumhq/paperui";
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
export const IDLE_MS = 5000;

/** a tab shows this much of a window's title; the rest is an ellipsis, and the whole title its tooltip */
const TITLE_CHARS = 32;

export default function ComputerView(props: { agent: Agent }) {
    const c = () => props.agent.state.computer;
    const name = () => props.agent.name();
    const ready = () => c().phase === "ready";

    const action = createAction();
    const busy = action.busy;

    // ------------------------------------------------------------- its windows

    // tabs go by id, so a tab never jumps (and the window being used never loses focus to a move)
    const listed = createRead(() => props.agent.calls.windows().then((list) => list.sort((a, b) => a.id - b.id)), { source: ready });
    const windows = () => listed.value() ?? [];
    const [chosen, setChosen] = createSignal<number | null>(null);
    // a computer that stopped has no windows; one that starts again is looked at afresh
    createEffect(on(ready, (on) => !on && listed.set(undefined), { defer: true }));
    // looked at again while it's on and seen; a failure is shown once, until the user tries again: polling it would only repeat it
    createPolling(() => (ready() && !listed.error() && !document.hidden ? listed.reload() : undefined), WINDOWS_POLL_MS);

    // the chosen tab, or the first when it closes
    const shown = () => (windows().some((w) => w.id === chosen()) ? chosen() : (windows()[0]?.id ?? null));

    const closeWindow = (w: ComputerWindow) =>
        void action.run("Couldn't close the window", async () => {
            await props.agent.calls.closeWindow({ window: w.id });
            listed.set((list) => list?.filter((x) => x.id !== w.id));
        });

    // ------------------------------------------------------------- control, taken by using it

    const [holding, setHolding] = createSignal(false);
    let disposed = false;
    onCleanup(() => (disposed = true));
    let taking: Promise<void> | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const giveBack = () =>
        props.agent.calls.control({ take: false }).catch((e) => {
            // closed meanwhile: nowhere on the page is left to say it, and the service's lease frees the agent anyway
            if (disposed) console.error("[agents] computer not handed back:", e);
            else showError("Couldn't hand the computer back", e);
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
        taking ??= props.agent.calls
            .control({ take: true })
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
                    void props.agent.calls.control({ take: true }).catch((e) => {
                        setHolding(false);
                        showError("Lost control of the computer", e);
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
            <Show when={ready() && windows().length > 0}>
                <PaperList direction="horizontal" name="computer-windows" value={shown() ?? ""} onValueChange={(v) => setChosen(Number(v))}>
                    <For each={windows()}>
                        {(w) => (
                            <PaperListItem icon="language" value={w.id} onClosed={() => closeWindow(w)} title={w.title || w.app}>
                                {clip(w.title || w.app, TITLE_CHARS)}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </Show>

            <div class={styles.content}>
                <Switch>
                    <Match when={c().phase === "unsupported"}>
                        <PaperEmptyState icon="desktop_access_disabled" title="No computer on this machine" description={c().error ?? undefined} />
                    </Match>
                    <Match when={c().phase === "installing" || (c().phase === "failed" && !c().installed)}>
                        <PaperFlex center padding="double">
                            <PaperFlex fullWidth maxWidth="panel-small">
                                <SetupProgress
                                    computer={c()}
                                    retry={{ label: "Set up again", disabled: busy(), onClick: () => void action.run("Couldn't set up the computer", props.agent.calls.installComputer) }}
                                />
                            </PaperFlex>
                        </PaperFlex>
                    </Match>
                    <Match when={c().phase === "none"}>
                        <PaperEmptyState
                            icon="computer"
                            title={`${name()} has no computer yet`}
                            description={`A web browser of its own that ${name()} uses for its work, about 400 MB of storage. It reaches the internet, never your files or your network.`}
                        >
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void action.run("Couldn't set up the computer", props.agent.calls.installComputer)}>
                                <PaperIcon>computer</PaperIcon> Set up {name()}'s computer
                            </PaperButton>
                        </PaperEmptyState>
                    </Match>
                    <Match when={c().phase === "starting" || c().phase === "stopping"}>
                        <PaperFlex center>
                            <PaperLoader loaderStatus="indeterminate" label={c().phase === "starting" ? "Starting" : "Stopping"} />
                        </PaperFlex>
                    </Match>
                    <Match when={c().phase === "stopped"}>
                        <PaperEmptyState icon="power_settings_new" title="The computer is off" description={`${name()} turns it on when it needs it, or you can now.`}>
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void action.run("Couldn't turn on the computer", props.agent.calls.startComputer)}>
                                Turn on
                            </PaperButton>
                        </PaperEmptyState>
                    </Match>
                    <Match when={c().phase === "failed"}>
                        <PaperError
                            fill
                            title="The computer stopped"
                            error={c().error}
                            action={{ label: "Try again", disabled: busy(), onClick: () => void action.run("Couldn't turn on the computer", props.agent.calls.startComputer) }}
                        />
                    </Match>
                    <Match when={listed.error()}>
                        {(err) => <PaperError fill title="Couldn't see its windows" error={err()} action={{ label: "Try again", disabled: listed.loading(), onClick: () => void listed.reload() }} />}
                    </Match>
                    <Match when={listed.value() === undefined}>
                        <PaperFlex center>
                            <PaperLoader loaderStatus="indeterminate" label="Looking" />
                        </PaperFlex>
                    </Match>
                    <Match when={windows().length === 0}>
                        <PaperEmptyState icon="web_asset" title="Nothing is open" description={`When ${name()} opens a page, you can watch it here.`} />
                    </Match>
                    <Match when={true}>
                        {/* every tab stays mounted (a window keeps its last frame); only the chosen one shows and polls */}
                        <For each={windows()}>
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
