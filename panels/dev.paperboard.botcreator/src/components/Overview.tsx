import { createEffect, createSignal, on, onMount, onCleanup, Show, For } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperButton,
    PaperAvatar,
    PaperBadge,
    PaperTable,
    PaperCard,
    PaperCopyButton,
    PaperToggle,
} from "@mileniumhq/paperui";
import { actionsApi, projectActionId } from "@mileniumhq/paperapi";
import { PANEL_ID, type BotSummary } from "../bots";
import {
    appendCapped,
    DEFAULT_DISCORD_AVATAR,
    formatDuration,
    RECENT_MESSAGE_CAP,
    errorToMessage,
} from "../types";

const HEALTH_POLL_MS = 10000;

interface RecentMessage {
    content: string;
    author: string;
    channelId: string;
    guildId: string | null;
    messageId: string;
}

interface Health {
    connected: boolean;
    lastError: string | null;
    uptimeMs: number;
    wsPing: number;
    guildCount: number;
    cachedUsers: number;
    cachedChannels: number;
    commandsReceived: number;
    pendingInteractions: number;
    commandSyncError: string | null;
}

export interface OverviewProps {
    bot: () => BotSummary;
    /** turns the bot on or off; rejects with the reason it couldn't */
    onSetEnabled: (enabled: boolean) => Promise<unknown>;
}

export default function Overview(props: OverviewProps) {
    const [tag, setTag] = createSignal("");
    const [infoError, setInfoError] = createSignal("");
    const [healthError, setHealthError] = createSignal("");
    const [toggleError, setToggleError] = createSignal("");
    const [recent, setRecent] = createSignal<RecentMessage[]>([]);
    const [health, setHealth] = createSignal<Health | null>(null);
    // the bot's name, avatar and connection are the service's, kept live
    const connected = () => props.bot().connected;
    const connectionError = () => props.bot().lastError;

    const loadBotInfo = async () => {
        setInfoError("");
        try {
            const info = await actionsApi.call<any>(PANEL_ID, "get-bot-info", { bot: props.bot().id });
            if (!info || typeof info !== "object") throw new Error("get-bot-info returned no bot details");
            setTag(typeof info.tag === "string" ? info.tag : "");
            if (Array.isArray(info.recentMessages)) setRecent(info.recentMessages);
        } catch (err) {
            console.error("[Overview] bot info read failed:", err);
            setInfoError(errorToMessage(err));
        }
    };

    const loadHealth = async () => {
        try {
            const next = await actionsApi.call<Health>(PANEL_ID, "get-health", { bot: props.bot().id });
            if (!next || typeof next !== "object") {
                throw new Error("get-health returned no health payload");
            }
            setHealth(next);
            setHealthError("");
        } catch (err) {
            // the last good reading stays on screen under the error
            console.error("[Overview] health read failed:", err);
            setHealthError(errorToMessage(err));
        }
    };

    onMount(() => {
        void loadBotInfo();
        void loadHealth();
        const poll = setInterval(() => void loadHealth(), HEALTH_POLL_MS);
        onCleanup(() => clearInterval(poll));
    });

    // a bot that comes online has a tag and a fresh session to show
    createEffect(on(connected, (now, before) => {
        if (now && before === false) {
            void loadBotInfo();
            void loadHealth();
        }
    }, { defer: true }));

    // live session truth: the service emits each message as the bot's
    // event; the subscription is cleaned up with the component (bounded: no
    // listener outlives it)
    onCleanup(
        actionsApi.onTrigger(PANEL_ID, projectActionId(props.bot().id, "on-message"), (msg: any) => {
            if (!msg || typeof msg !== "object") return;
            setRecent((prev) =>
                appendCapped(
                    prev,
                    {
                        content: String(msg.content ?? ""),
                        author: String(msg.author ?? ""),
                        channelId: String(msg.channelId ?? ""),
                        guildId: msg.guildId ?? null,
                        messageId: String(msg.messageId ?? ""),
                    },
                    RECENT_MESSAGE_CAP,
                ),
            );
        }),
    );

    const setEnabled = async (enabled: boolean) => {
        setToggleError("");
        try {
            await props.onSetEnabled(enabled);
        } catch (err) {
            setToggleError(errorToMessage(err));
        }
    };


    const pingText = () => {
        const h = health();
        if (!h || !h.connected || h.wsPing < 0) return "—";
        return `${h.wsPing} ms`;
    };

    const uptimeText = () => {
        const h = health();
        if (!h || !h.connected) return "—";
        return formatDuration(h.uptimeMs);
    };

    return (
        <>
            <PaperCard>
                        <PaperFlex direction="row" padding="full" gap="full" align="center">
                            <PaperAvatar
                                src={props.bot().avatar || DEFAULT_DISCORD_AVATAR}
                                alt={props.bot().name}
                                size="xlarge"
                            />

                            <PaperFlex direction="column" gap="onefourth" flex minWidth={0}>
                                <PaperFlex direction="row" gap="half" align="baseline" wrap>
                                    <PaperText preset="title">
                                        {props.bot().name}
                                    </PaperText>
                                    <Show when={tag() && tag() !== props.bot().name}>
                                        <PaperText preset="hint">
                                            @{tag()}
                                        </PaperText>
                                    </Show>
                                    <PaperBadge variant={connected() ? "success" : props.bot().connecting ? "warning" : props.bot().enabled ? "danger" : "monochrome"}>
                                        {connected() ? "Online" : props.bot().connecting ? "Connecting" : "Offline"}
                                    </PaperBadge>
                                </PaperFlex>

                                <Show when={props.bot().applicationId}>
                                    <PaperFlex direction="row" gap="half" align="center">
                                        <PaperText preset="hint" family="code">
                                            {props.bot().applicationId}
                                        </PaperText>
                                        <PaperCopyButton text={props.bot().applicationId} title="Copy application ID" />
                                    </PaperFlex>
                                </Show>
                            </PaperFlex>
                            <PaperToggle
                                checked={props.bot().enabled}
                                aria-label={`${props.bot().name} is on`}
                                title={props.bot().enabled ? "On: runs while Paperboard does" : "Off"}
                                onChange={(enabled) => void setEnabled(enabled)}
                            />
                </PaperFlex>
            </PaperCard>

            <Show when={infoError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't read the bot's details">
                    {infoError()}
                </PaperQuote>
            </Show>

            <Show when={toggleError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't turn the bot on or off" onDismiss={() => setToggleError("")}>
                    {toggleError()}
                </PaperQuote>
            </Show>

            <Show when={connectionError()}>
                        <PaperQuote variant="danger" icon="warning" title="Connection error">
                            {connectionError()}
                        </PaperQuote>
                    </Show>

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center">
                                <PaperText preset="heading">
                                    Health
                                </PaperText>
                                <PaperText preset="hint">
                                    Refreshes every {HEALTH_POLL_MS / 1000}s
                                </PaperText>
                            </PaperFlex>

                            <Show when={healthError()}>
                                <PaperQuote variant="danger" icon="warning" title="Couldn't check health">
                                    {healthError()}
                                </PaperQuote>
                            </Show>

                            <Show
                                when={health()}
                                fallback={
                                    <Show when={!healthError()}>
                                        <PaperText preset="hint">
                                            Checking health…
                                        </PaperText>
                                    </Show>
                                }
                            >
                                {(h) => (
                                <PaperTable>
                                    <tbody>
                                        <tr>
                                            <th>Gateway status</th>
                                            <td>{connected() ? "Connected" : "Disconnected"}</td>
                                        </tr>
                                        <tr>
                                            <th>Gateway latency</th>
                                            <td>{pingText()}</td>
                                        </tr>
                                        <tr>
                                            <th>Uptime</th>
                                            <td>{uptimeText()}</td>
                                        </tr>
                                        <tr>
                                            <th>Servers</th>
                                            <td>{h().guildCount}</td>
                                        </tr>
                                        <tr>
                                            <th>Cached users / channels</th>
                                            <td>
                                                {h().cachedUsers} /{" "}
                                                {h().cachedChannels}
                                            </td>
                                        </tr>
                                        <tr>
                                            <th>Commands received</th>
                                            <td>{h().commandsReceived}</td>
                                        </tr>
                                        <tr>
                                            <th>Pending replies</th>
                                            <td>{h().pendingInteractions}</td>
                                        </tr>
                                    </tbody>
                                </PaperTable>
                                )}
                            </Show>

                            <Show when={health()?.commandSyncError}>
                                <PaperQuote
                                    variant="warning"
                                    icon="warning"
                                    title="Command sync"
                                >
                                    {health()!.commandSyncError}
                                </PaperQuote>
                            </Show>
                </PaperFlex>
            </PaperCard>

            <Show when={recent().length > 0}>
                <PaperCard>
                    <PaperFlex direction="column" gap="half" padding="full">
                        <PaperText preset="heading">
                            Recent messages
                        </PaperText>
                        <For each={recent()}>
                            {(msg) => (
                                <PaperText preset="text">
                                    <PaperText as="span" preset="text" color="text-subtle">
                                        {msg.author}:
                                    </PaperText>{" "}
                                    {msg.content || "(no text)"}
                                </PaperText>
                            )}
                        </For>
                    </PaperFlex>
                </PaperCard>
            </Show>
        </>
    );
}
