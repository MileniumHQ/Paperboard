// Home widgets for Bot Creator. One page draws every widget; the shell says
// which one this frame shows. Both read the panel's own service through its
// internal actions, poll only while the widget can be seen, and show a
// failed read as a failure with Retry, never as an empty or offline bot.
// Layout comes from PaperWidget so these line up with every other widget.
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "./widget.css";
import { render } from "solid-js/web";
import { createSignal, onCleanup, Show, type JSX } from "solid-js";
import {
    PaperAvatar,
    PaperButton,
    PaperChart,
    PaperIcon,
    PaperProvider,
    PaperWidget,
    PaperWidgetDot,
    PaperWidgetMessage,
    PaperWidgetStat,
} from "@mileniumhq/paperui";
import { actionsApi, defineWidgets, type WidgetContext } from "@mileniumhq/paperapi";
import type { CommandActivity } from "./commandActivity";
import { DEFAULT_DISCORD_AVATAR, errorToMessage } from "./types";

const PANEL_ID = "dev.paperboard.botcreator";
const STATUS_POLL_MS = 15_000;
const ACTIVITY_POLL_MS = 60_000;

interface BotWidgetStatus {
    configured: boolean;
    connected: boolean;
    lastError: string | null;
    name: string;
    avatar: string;
    guildCount: number;
}

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "failed"; message: string };

// reads the service now and every `ms` while the widget is visible; nothing
// runs while Home is hidden or the widget is scrolled away
function createPolledRead<T>(widget: WidgetContext, ms: number, read: () => Promise<T>) {
    const [state, setState] = createSignal<Load<T>>({ kind: "loading" });
    let timer: ReturnType<typeof setInterval> | undefined;
    let generation = 0;
    const refresh = async () => {
        const mine = ++generation;
        try {
            const value = await read();
            if (mine === generation) setState({ kind: "ready", value });
        } catch (err) {
            if (mine === generation) setState({ kind: "failed", message: errorToMessage(err) });
        }
    };
    const sync = (visible: boolean) => {
        clearInterval(timer);
        timer = undefined;
        if (!visible) return;
        void refresh();
        timer = setInterval(() => void refresh(), ms);
    };
    const off = widget.onVisibilityChange(sync);
    sync(widget.visible());
    onCleanup(() => {
        off();
        clearInterval(timer);
        generation++;
    });
    const ready = () => {
        const s = state();
        return s.kind === "ready" ? s.value : null;
    };
    const failed = () => {
        const s = state();
        return s.kind === "failed" ? s.message : null;
    };
    return { ready, failed, refresh };
}

function createSize(widget: WidgetContext) {
    const [size, setSize] = createSignal(widget.size());
    onCleanup(widget.onResize(setSize));
    return size;
}

async function readStatus(): Promise<BotWidgetStatus> {
    const status = await actionsApi.call<BotWidgetStatus>(PANEL_ID, "get-widget-status");
    if (!status || typeof status !== "object" || typeof status.connected !== "boolean") {
        throw new Error("Bot Creator returned no status");
    }
    return status;
}

async function readActivity(): Promise<CommandActivity> {
    const activity = await actionsApi.call<CommandActivity>(PANEL_ID, "get-command-activity");
    if (!activity || !Array.isArray(activity.counts)) {
        throw new Error("Bot Creator returned no command activity");
    }
    return activity;
}

function plural(n: number, one: string, many: string): string {
    return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// the header's way out: a compact icon button, the same in every state
function HeaderButton(props: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
    return (
        <PaperButton size="tiny" variant="text" icon aria-label={props.label} title={props.label} disabled={props.disabled} onClick={props.onClick}>
            <PaperIcon>{props.icon}</PaperIcon>
        </PaperButton>
    );
}

function BotStatus(props: { widget: WidgetContext }) {
    const size = createSize(props.widget);
    const wide = () => size().w > 1;
    const { ready, failed, refresh } = createPolledRead(props.widget, STATUS_POLL_MS, readStatus);
    const [connecting, setConnecting] = createSignal(false);
    const [connectError, setConnectError] = createSignal<string | null>(null);
    const open = () => props.widget.openPanel();

    // the service owns the session: the widget asks it to connect the vault
    // token, then shows whatever status the service reports afterwards
    const reconnect = async () => {
        setConnecting(true);
        setConnectError(null);
        try {
            await actionsApi.call(PANEL_ID, "connect-bot");
        } catch (err) {
            setConnectError(errorToMessage(err));
        } finally {
            setConnecting(false);
            await refresh();
        }
    };

    // a 2x1 puts its way out in the header; a 1x1 has no room beside the
    // bot's name, so its way out sits in the message instead
    const action = (): JSX.Element => {
        if (!wide()) return undefined;
        if (failed()) return <HeaderButton icon="refresh" label="Retry" onClick={() => void refresh()} />;
        const status = ready();
        if (!status) return undefined;
        if (!status.connected && status.configured) {
            return <HeaderButton icon="power_settings_new" label={connecting() ? "Connecting" : "Connect bot"} disabled={connecting()} onClick={() => void reconnect()} />;
        }
        return <HeaderButton icon="open_in_new" label={status.configured ? "Open Bot Creator" : "Set up in Bot Creator"} onClick={open} />;
    };

    const connectButton = () => (
        <PaperButton size="tiny" disabled={connecting()} onClick={() => void reconnect()}>
            {connecting() ? "Connecting" : "Connect"}
        </PaperButton>
    );

    // the bot's own avatar is its kind icon, drawn at the header's icon size
    const icon = (): JSX.Element | string => {
        const status = ready();
        // a 1x1 gives the room to the bot's name instead
        if (!wide()) return undefined;
        return status ? <PaperAvatar class="bc-header-avatar" src={status.avatar || DEFAULT_DISCORD_AVATAR} alt="" /> : "smart_toy";
    };

    return (
        <PaperWidget
            title={ready()?.name ?? "Bot status"}
            icon={icon()}
            action={action()}
            // a 1x1 has no room for a header button, so an online bot's tile opens its panel
            onPress={!wide() && !failed() && ready()?.connected ? open : undefined}
            pressLabel="Open Bot Creator"
        >
            <Show
                when={!failed()}
                fallback={
                    <PaperWidgetMessage tone="danger" title="Couldn't load status" description={wide() ? failed() ?? undefined : undefined}>
                        <Show when={!wide()}>
                            <PaperButton size="tiny" onClick={() => void refresh()}>Retry</PaperButton>
                        </Show>
                    </PaperWidgetMessage>
                }
            >
                <Show when={ready()} fallback={<PaperWidgetMessage title="Loading" />}>
                    {(status) => (
                        <Show
                            when={status().connected}
                            fallback={
                                <Show
                                    when={!connectError()}
                                    fallback={
                                        <PaperWidgetMessage
                                            tone="danger"
                                            title="Couldn't connect"
                                            description={wide() ? connectError() ?? undefined : undefined}
                                        >
                                            <Show when={!wide()}>{connectButton()}</Show>
                                        </PaperWidgetMessage>
                                    }
                                >
                                    <Show
                                        when={status().configured}
                                        fallback={
                                            <PaperWidgetMessage
                                                tone="warning"
                                                title={wide() ? "No bot token" : "Not set up"}
                                                description={wide() ? "Add one in Bot Creator" : undefined}
                                            >
                                                <Show when={!wide()}>
                                                    <PaperButton size="tiny" onClick={open}>Set up</PaperButton>
                                                </Show>
                                            </PaperWidgetMessage>
                                        }
                                    >
                                        <PaperWidgetMessage
                                            title={wide() ? "Not connected" : "Offline"}
                                            description={wide() ? status().lastError ?? "Connect to bring the bot online" : undefined}
                                        >
                                            <Show when={!wide()}>{connectButton()}</Show>
                                        </PaperWidgetMessage>
                                    </Show>
                                </Show>
                            }
                        >
                            {/* online reads as the success tone; the 2x1 also says it with a dot */}
                            <PaperWidgetStat
                                value={status().guildCount.toLocaleString()}
                                caption={
                                    wide() ? (
                                        <>
                                            {status().guildCount === 1 ? "server" : "servers"} · <PaperWidgetDot tone="success" /> Online
                                        </>
                                    ) : status().guildCount === 1 ? "server" : "servers"
                                }
                                tone="success"
                                aria-label={`${status().name} is online in ${plural(status().guildCount, "server", "servers")}`}
                            />
                        </Show>
                    )}
                </Show>
            </Show>
        </PaperWidget>
    );
}

function formatHour(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function CommandActivityWidget(props: { widget: WidgetContext }) {
    const { ready, failed, refresh } = createPolledRead(props.widget, ACTIVITY_POLL_MS, readActivity);

    // hours before recording began were not observed: they are left off the
    // chart rather than drawn as quiet hours
    const observed = (a: CommandActivity) => {
        const firstStart = a.currentBucketStart - (a.counts.length - 1) * a.bucketMs;
        return a.counts.filter((_, i) => firstStart + (i + 1) * a.bucketMs > a.since);
    };
    const fullDay = (a: CommandActivity) => observed(a).length === a.counts.length;

    return (
        <PaperWidget
            title="Commands"
            icon="bar_chart"
            detail={ready() ? ready()!.total.toLocaleString() : undefined}
            footer={
                <Show when={ready()}>
                    {(a) => (
                        <>
                            <span aria-hidden="true">{fullDay(a()) ? "24h ago" : `Since ${formatHour(a().since)}`}</span>
                            <span aria-hidden="true">Now</span>
                        </>
                    )}
                </Show>
            }
        >
            <Show
                when={!failed()}
                fallback={
                    <PaperWidgetMessage tone="danger" title="Couldn't load activity" description={failed() ?? undefined}>
                        <PaperButton size="tiny" onClick={() => void refresh()}>Retry</PaperButton>
                    </PaperWidgetMessage>
                }
            >
                <Show when={ready()} fallback={<PaperWidgetMessage title="Loading" />}>
                    {(a) => (
                        <PaperChart
                            type="line"
                            class="bc-chart"
                            label={`Slash commands run per hour, ${fullDay(a()) ? "last 24 hours" : `since ${formatHour(a().since)}`}`}
                            series={[{ label: "This hour", values: observed(a()), detail: plural(a().counts[a().counts.length - 1] ?? 0, "command", "commands") }]}
                            min={0}
                            max={Math.max(1, ...a().counts)}
                            span={a().counts.length}
                            fill
                        />
                    )}
                </Show>
            </Show>
        </PaperWidget>
    );
}

function mount(root: HTMLElement, view: () => JSX.Element): () => void {
    return render(
        () => (
            <PaperProvider fullWidth fullHeight class="bc-widget">
                {view()}
            </PaperProvider>
        ),
        root,
    );
}

defineWidgets({
    "bot-status": (root, widget) => mount(root, () => <BotStatus widget={widget} />),
    "command-activity": (root, widget) => mount(root, () => <CommandActivityWidget widget={widget} />),
});
