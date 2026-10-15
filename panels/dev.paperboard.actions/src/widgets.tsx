// Home widgets: a Run button for one manual workflow, and the recent runs.
// Everything shown comes from the Actions service: a run is "running" only
// once the service says it started, and passed or failed only from its result.
import "@mileniumhq/paperui/style.css";
import "./widget.css";
import { render } from "solid-js/web";
import { createSignal, Match, onCleanup, Switch } from "solid-js";
import { createPanelBridge, defineWidgets, type WidgetContext } from "@mileniumhq/paperapi";
import {
    PaperButton,
    PaperIcon,
    PaperProvider,
    PaperWidget,
    PaperWidgetMessage,
    PaperWidgetRows,
    PaperWidgetStat,
} from "@mileniumhq/paperui";
import { ACTIONS_PANEL_ID } from "./panelId";
import type { ActionsServiceState } from "./service";
import type { FlowRun } from "./lib/widgetFlows";

const DEFAULT_STATE: ActionsServiceState = { flowCount: 0, functionCount: 0, rev: 0, runs: [], running: [] };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function ago(at: number, now: number): string {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

// "Failed at step "Calculate": …" under a red "Failed" says it twice; the
// step is what fits a caption. Other failures read as they are.
function failedWhere(message: string): string {
    const step = /^Failed at step "([^"]+)"/.exec(message);
    return step ? `at ${step[1]}` : message;
}

/** The clock relative times read; it ticks only while the widget is seen. */
function useNow(widget: WidgetContext) {
    const [now, setNow] = createSignal(Date.now());
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = (visible: boolean) => {
        clearInterval(timer);
        timer = undefined;
        if (visible) {
            setNow(Date.now());
            timer = setInterval(() => setNow(Date.now()), 15_000);
        }
    };
    const off = widget.onVisibilityChange(sync);
    sync(widget.visible());
    onCleanup(() => { off(); clearInterval(timer); });
    return now;
}

/** The service's state, and whether the service answered at all. */
function useActions(autoHydrate = true) {
    const bridge = createPanelBridge<ActionsServiceState>({ panelId: ACTIONS_PANEL_ID, defaultState: DEFAULT_STATE });
    const [state, setState] = createSignal<ActionsServiceState>(bridge.getState());
    const [ready, setReady] = createSignal(false);
    const [unavailable, setUnavailable] = createSignal<string | null>(null);
    const off = bridge.onStateChange((_patch, full) => setState({ ...full }));
    const hydrate = async () => {
        setUnavailable(null);
        try {
            setState({ ...(await bridge.refreshState()) });
            setReady(true);
        } catch (err) {
            setUnavailable(errorText(err));
        }
    };
    if (autoHydrate) void hydrate();
    onCleanup(() => { off(); bridge.dispose(); });
    return { bridge, state, ready, unavailable, setUnavailable, hydrate };
}

// A short tile has no room for a message's own buttons: its way out moves to
// the header's action (see RunButton), and the reason to the tooltip.
function Unavailable(props: { message: string; onRetry?: () => void; compact?: boolean }) {
    return (
        <PaperWidgetMessage
            tone="danger"
            title="Actions unavailable"
            description={props.compact ? undefined : props.message}
        >
            {props.onRetry ? <PaperButton size="tiny" onClick={props.onRetry}>Retry</PaperButton> : undefined}
        </PaperWidgetMessage>
    );
}

function RunButton(props: { widget: WidgetContext }) {
    const flowId = props.widget.options.flow ?? "";
    const actions = useActions(false);
    const now = useNow(props.widget);
    const [size, setSize] = createSignal(props.widget.size());
    const offResize = props.widget.onResize(setSize);
    onCleanup(offResize);

    const [flow, setFlow] = createSignal<{ label: string } | { gone: true } | null>(null);
    const [starting, setStarting] = createSignal(false);
    // a run the service refused never reaches its history: kept here until the next run
    const [refused, setRefused] = createSignal<{ message: string; at: number } | null>(null);

    let describedRev = -1;
    const describe = async () => {
        if (!flowId) { setFlow({ gone: true }); return; }
        describedRev = actions.state().rev;
        try {
            setFlow(await actions.bridge.call<{ label: string } | { gone: true }>("widget-flow", { flowId }));
            // the service answered: a failure an earlier describe recorded is over
            actions.setUnavailable(null);
        } catch (err) {
            actions.setUnavailable(errorText(err));
        }
    };
    const retry = async () => {
        await actions.hydrate();
        if (!actions.unavailable()) await describe();
    };
    void retry();
    // a canvas edit may rename or delete the workflow
    const offRev = actions.bridge.onStateChange((patch) => {
        if (patch.rev !== undefined && patch.rev !== describedRev && actions.ready()) void describe();
    });
    onCleanup(offRev);

    const running = () => actions.state().running.includes(flowId);
    const lastRun = (): FlowRun | undefined => actions.state().runs.find((r) => r.flowId === flowId);
    const label = () => { const f = flow(); return f && "label" in f ? f.label : ""; };
    const gone = () => { const f = flow(); return Boolean(f && "gone" in f); };
    const runnable = () => !actions.unavailable() && Boolean(flow()) && !gone();
    const wide = () => size().w > 1;
    const busy = () => running() || starting();

    const run = async () => {
        setStarting(true);
        setRefused(null);
        try {
            await actions.bridge.call("run-widget-flow", { flowId });
        } catch (err) {
            setRefused({ message: errorText(err), at: Date.now() });
            // the workflow may have been deleted since it was described
            void describe();
        } finally {
            setStarting(false);
        }
    };

    const refusal = () => {
        const r = refused();
        const last = lastRun();
        return r && (!last || last.finishedAt <= r.at) ? r : null;
    };

    return (
        <PaperWidget
            title={label() || "Run button"}
            icon="play_circle"
            // a 1x1 has no room beside the name for a button: its tile is the button
            onPress={!wide() && runnable() ? () => void run() : undefined}
            pressLabel={`Run ${label()}`}
            pressDisabled={busy()}
            // Run sits in the header at every size: a 2x1 is a short tile, and
            // a footer row would leave the status no room. So does each
            // state's way out (Retry, Open), for the same reason.
            action={actions.unavailable() ? (
                <PaperButton size="tiny" icon aria-label="Retry" title="Retry" onClick={() => void retry()}>
                    <PaperIcon>refresh</PaperIcon>
                </PaperButton>
            ) : gone() ? (
                <PaperButton size="tiny" icon aria-label="Open Actions" title="Open Actions" onClick={() => props.widget.openPanel()}>
                    <PaperIcon>open_in_new</PaperIcon>
                </PaperButton>
            ) : runnable() && wide() ? (
                <PaperButton size="tiny" icon variant="primary" aria-label={`Run ${label()}`} title={`Run ${label()}`} disabled={busy()} onClick={() => void run()}>
                    <PaperIcon>play_arrow</PaperIcon>
                </PaperButton>
            ) : undefined}
        >
            <Switch>
                <Match when={actions.unavailable()}>
                    <Unavailable message={actions.unavailable()!} compact={!wide()} />
                </Match>
                <Match when={flow() === null}>
                    <PaperWidgetMessage title="Loading…" />
                </Match>
                <Match when={gone()}>
                    <PaperWidgetMessage tone="warning" title="Deleted" description={wide() ? "Choose another workflow" : undefined} />
                </Match>
                <Match when={running()}>
                    <PaperWidgetStat value="Running" caption="now" tone="primary" role="status" />
                </Match>
                <Match when={starting()}>
                    <PaperWidgetStat value="Starting" caption="now" role="status" />
                </Match>
                <Match when={refusal()}>
                    <PaperWidgetMessage
                        tone="danger"
                        title="Couldn't run"
                        // a 1x1 has room for the title only; the 2x1 says why
                        description={wide() ? refusal()!.message : undefined}
                    />
                </Match>
                <Match when={lastRun()}>
                    {(last) => (
                        <PaperWidgetStat
                            role="status"
                            value={last().status === "passed" ? "Passed" : "Failed"}
                            // a 2x1 has room to say why it failed
                            caption={wide() && last().status === "failed" && last().message ? `${ago(last().finishedAt, now())} · ${failedWhere(last().message)}` : ago(last().finishedAt, now())}
                            tone={last().status === "passed" ? "success" : "danger"}
                            title={last().message}
                        />
                    )}
                </Match>
                <Match when={true}>
                    <PaperWidgetStat value="Not run" caption="yet" role="status" />
                </Match>
            </Switch>
        </PaperWidget>
    );
}

function RecentRuns(props: { widget: WidgetContext }) {
    const actions = useActions();
    const now = useNow(props.widget);
    const runs = () => actions.state().runs;
    const runningCount = () => actions.state().running.length;
    return (
        <PaperWidget title="Recent runs" icon="history" detail={runningCount() > 0 ? `${runningCount()} running` : undefined}>
            <Switch>
                <Match when={actions.unavailable()}>
                    <Unavailable message={actions.unavailable()!} onRetry={() => void actions.hydrate()} />
                </Match>
                <Match when={!actions.ready()}>
                    <PaperWidgetMessage title="Loading…" />
                </Match>
                <Match when={runs().length === 0}>
                    <PaperWidgetMessage title="No runs yet" description="Runs since Actions started show here">
                        <PaperButton size="tiny" aria-label="Open Actions" onClick={() => props.widget.openPanel()}>Open</PaperButton>
                    </PaperWidgetMessage>
                </Match>
                <Match when={true}>
                    <PaperWidgetRows
                        rows={runs().map((r) => {
                            const when = ago(r.finishedAt, now());
                            const word = r.status === "passed" ? "Passed" : "Failed";
                            return {
                                id: r.id,
                                label: r.label,
                                detail: when,
                                tone: r.status === "passed" ? "success" : "danger",
                                ariaLabel: `${word}: ${r.label}, ${when}. Open Actions`,
                                onClick: () => props.widget.openPanel(),
                            };
                        })}
                    />
                </Match>
            </Switch>
        </PaperWidget>
    );
}

const mount = (Widget: (props: { widget: WidgetContext }) => any) => (root: HTMLElement, widget: WidgetContext) =>
    render(() => (
        <PaperProvider fullWidth fullHeight>
            <Widget widget={widget} />
        </PaperProvider>
    ), root);

defineWidgets({
    "run-button": mount(RunButton),
    "recent-runs": mount(RecentRuns),
});
