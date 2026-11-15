// Home widgets for Bot Creator. One page draws every widget; the shell says
// which one this frame shows. Both read the panel's own service through its
// own calls, poll only while the widget can be seen, and show a
// failed read as a failure with Retry, never as an empty or offline bot.
// Layout comes from PaperWidget so these line up with every other widget.
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "./widget.css";
import { render } from "solid-js/web";
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
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
    createPolling,
    createRead,
} from "@mileniumhq/paperui";
import { defineWidgets, type WidgetContext, errorMessage } from "@mileniumhq/paperapi";
import { botCreator } from "./client";
import type { CommandActivity } from "./commandActivity";
import type { BotWidgetStatus } from "./session";
import { count } from "./types";
import { picture } from "./picture";

const STATUS_POLL_MS = 15_000;
const ACTIVITY_POLL_MS = 60_000;

// reads the service now and every `ms` while the widget is visible; nothing
// runs while Home is hidden or the widget is scrolled away. A read that
// says what the last one said changes nothing on screen.
function createPolledRead<T>(widget: WidgetContext, ms: number, read: () => Promise<T>) {
    const [visible, setVisible] = createSignal(widget.visible());
    onCleanup(widget.onVisibilityChange(setVisible));
    const polled = createRead(read, { source: visible });
    createEffect(on(visible, (shown) => shown && createPolling(polled.reload, ms)));
    // a failed read is shown as the failure, never as the last answer
    const ready = () => (polled.error() ? null : polled.value() ?? null);
    return { ready, failed: polled.error, refresh: polled.reload };
}

function createSize(widget: WidgetContext) {
    const [size, setSize] = createSignal(widget.size());
    onCleanup(widget.onResize(setSize));
    return size;
}

// the bot chosen in the gallery; the service refuses a widget with none
const chosenBot = (widget: WidgetContext) => ({ bot: widget.options.bot ?? "" });

const readStatus = (widget: WidgetContext): Promise<BotWidgetStatus> => botCreator.calls.getWidgetStatus(chosenBot(widget));
const readActivity = (widget: WidgetContext): Promise<CommandActivity> => botCreator.calls.getCommandActivity(chosenBot(widget));

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
    const { ready, failed, refresh } = createPolledRead(props.widget, STATUS_POLL_MS, () => readStatus(props.widget));
    const [connecting, setConnecting] = createSignal(false);
    // why the last Connect press failed, until the bot is seen online
    const [connectError, setConnectError] = createSignal<string | null>(null);
    createEffect(on(() => ready()?.connected, (connected) => {
        if (connected) setConnectError(null);
    }));
    const open = () => props.widget.openPanel();

    // the service owns the session: the widget asks it to connect the vault
    // token, then shows whatever status the service reports afterwards
    const reconnect = async () => {
        setConnecting(true);
        setConnectError(null);
        try {
            await botCreator.calls.connectBot(chosenBot(props.widget));
        } catch (err) {
            setConnectError(errorMessage(err));
        } finally {
            setConnecting(false);
            await refresh();
        }
    };

    // a 2x1 puts its way out in the header; a 1x1 has no room beside the
    // bot's name, so its way out sits in the message instead. The button is
    // built from the one thing that decides it, so a status that changes
    // (a server joined) keeps the same button.
    const actionKind = createMemo<"retry" | "connect" | "open" | null>(() => {
        if (!wide()) return null;
        if (failed()) return "retry";
        const status = ready();
        if (!status) return null;
        return !status.connected && status.configured ? "connect" : "open";
    });
    const action = createMemo((): JSX.Element => {
        switch (actionKind()) {
            case "retry":
                return <HeaderButton icon="refresh" label="Retry" onClick={() => void refresh()} />;
            case "connect":
                return <HeaderButton icon="power_settings_new" label={connecting() ? "Connecting" : "Connect bot"} disabled={connecting()} onClick={() => void reconnect()} />;
            case "open":
                return <HeaderButton icon="open_in_new" label="Open Bot Creator" onClick={open} />;
            default:
                return undefined;
        }
    });

    const connectButton = () => (
        <PaperButton size="tiny" disabled={connecting()} onClick={() => void reconnect()}>
            {connecting() ? "Connecting" : "Connect"}
        </PaperButton>
    );

    // the bot's own avatar is its kind icon, drawn at the header's icon size;
    // it is drawn again only when the picture changes
    const avatar = createMemo(() => {
        const status = ready();
        return status ? picture(status.avatar) ?? null : null;
    });
    const icon = createMemo((): JSX.Element | string => {
        // a 1x1 gives the room to the bot's name instead
        if (!wide()) return undefined;
        const src = avatar();
        return src ? <PaperAvatar class="bc-header-avatar" src={src} alt="" /> : "smart_toy";
    });

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
                                                title={wide() ? "No bot token" : "No token"}
                                                description={wide() ? "Replace it in Bot Creator" : undefined}
                                            >
                                                <Show when={!wide()}>
                                                    <PaperButton size="tiny" onClick={open}>Open</PaperButton>
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
                                aria-label={`${status().name} is online in ${count(status().guildCount, "server")}`}
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
    const { ready, failed, refresh } = createPolledRead(props.widget, ACTIVITY_POLL_MS, () => readActivity(props.widget));

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
                            series={[{ label: "This hour", values: observed(a()), detail: count(a().counts[a().counts.length - 1] ?? 0, "command") }]}
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
