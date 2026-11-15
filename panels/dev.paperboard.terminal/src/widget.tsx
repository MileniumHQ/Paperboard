// Home widget: one saved command with a Run button and how it last exited.
// The service owns the command, the run and its outcome; the widget asks it
// to run and shows the exit the daemon reported, never one it expected.
import { render } from "solid-js/web";
import { createSignal, onCleanup, Show, Switch, Match } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    PaperButton,
    PaperIcon,
    PaperProvider,
    PaperWidget,
    PaperWidgetMessage,
    PaperWidgetStat,
    type PaperRole,
} from "@mileniumhq/paperui";
import { defineWidgets, serviceClient, type WidgetContext, errorMessage } from "@mileniumhq/paperapi";
import "@mileniumhq/paperui/style.css";
import "./widget.css";
import { terminalContract, type CommandRun, type TerminalState } from "./lib/contract";
import { describeRun, runErrorStands, type RunTone } from "./lib/runStatus";
import { createAgoClock } from "./lib/clock";

const TONE_ROLE: Record<RunTone, PaperRole | undefined> = {
    idle: undefined,
    running: undefined,
    success: "success",
    danger: "danger",
    warning: "warning",
};

function PinnedCommand(props: { widget: WidgetContext }) {
    const commandId = () => props.widget.options.command ?? "";
    // each widget mirrors the service's state for as long as it is shown
    const terminal = serviceClient(terminalContract);
    // reconciled, so a push that changes nothing here (a shell's folder) notifies nothing
    const [state, setState] = createStore<TerminalState>(terminal.state.current());
    const [hydration, setHydration] = createSignal<"loading" | "ready" | "failed">("loading");
    const [hydrationError, setHydrationError] = createSignal("");
    const [runError, setRunError] = createSignal("");
    const [starting, setStarting] = createSignal(false);
    const [visible, setVisible] = createSignal(props.widget.visible());
    // "2m ago" moves only while someone can see it
    const now = createAgoClock(visible);
    const offVisible = props.widget.onVisibilityChange(setVisible);

    // the run a failed press started from; its error stands while that run does
    let pressedFrom: CommandRun | undefined;
    const offState = terminal.state.subscribe((full) => {
        setState(reconcile(full));
        if (runError() && !runErrorStands(pressedFrom, full.commandRuns[commandId()])) setRunError("");
    });

    const hydrate = async () => {
        setHydration("loading");
        try {
            setState(reconcile(await terminal.state.refresh()));
            setHydration("ready");
        } catch (err) {
            // unavailable is not "no such command"
            setHydrationError(errorMessage(err));
            setHydration("failed");
        }
    };
    void hydrate();

    onCleanup(() => {
        offVisible();
        offState();
        terminal.state.dispose();
    });

    const command = () => state.savedCommands.find((c) => c.id === commandId());
    const run = () => state.commandRuns[commandId()];
    const status = () => describeRun(run(), now());
    const running = () => run()?.state === "running";

    const start = async () => {
        setRunError("");
        pressedFrom = run();
        setStarting(true);
        try {
            // accepted only: the exit arrives through the service's state
            await terminal.calls.runSavedCommand({ id: commandId() });
        } catch (err) {
            setRunError(errorMessage(err));
        } finally {
            setStarting(false);
        }
    };

    // every state that isn't the command itself: same header, a message in the body
    const notice = (title: string, description: string, tone: PaperRole | undefined, action?: () => void, actionLabel?: string) => (
        <PaperWidget title="Pinned command" icon="terminal">
            {/* the tile has room for a title and one action; the reason is the tooltip */}
            <PaperWidgetMessage title={title} tone={tone} hint={description}>
                {action ? (
                    <PaperButton size="tiny" onClick={action}>
                        {actionLabel}
                    </PaperButton>
                ) : undefined}
            </PaperWidgetMessage>
        </PaperWidget>
    );

    return (
        <Switch>
            <Match when={hydration() === "failed"}>
                {notice("Terminal not answering", hydrationError(), "danger", () => void hydrate(), "Retry")}
            </Match>
            <Match when={hydration() === "loading"}>{notice("Loading…", "", undefined)}</Match>
            <Match when={state.savedCommandsError}>
                {notice("Saved commands unreadable", state.savedCommandsError, "danger", () => props.widget.openPanel(), "Open")}
            </Match>
            <Match when={!command()}>
                {notice("Command removed", "It is no longer saved in Terminal; open the panel to pin another", "warning", () => props.widget.openPanel(), "Open")}
            </Match>
            <Match when={command()}>
                {(saved) => (
                    <PaperWidget
                        title={saved().label}
                        icon="terminal"
                        // a 2x1 tile is too short for a footer row: Run is the header's one action
                        action={
                            <PaperButton
                                size="tiny"
                                icon
                                disabled={running() || starting()}
                                aria-label={`Run ${saved().label}`}
                                title={running() ? "Running" : `Run ${saved().command}`}
                                onClick={() => void start()}
                            >
                                <PaperIcon>play_arrow</PaperIcon>
                            </PaperButton>
                        }
                    >
                        <Show
                            when={runError()}
                            fallback={
                                <PaperWidgetStat
                                    value={status().value}
                                    caption={status().caption}
                                    tone={TONE_ROLE[status().tone]}
                                    title={status().detail}
                                    aria-live="polite"
                                />
                            }
                        >
                            <PaperWidgetStat value="Not started" caption={runError()} tone="danger" title={runError()} role="alert" />
                        </Show>
                    </PaperWidget>
                )}
            </Match>
        </Switch>
    );
}

defineWidgets({
    "pinned-command": (root, widget) =>
        render(
            () => (
                <PaperProvider fullWidth fullHeight>
                    <PinnedCommand widget={widget} />
                </PaperProvider>
            ),
            root,
        ),
});
