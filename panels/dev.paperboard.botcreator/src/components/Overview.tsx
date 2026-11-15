import { createEffect, createSignal, on, onCleanup, Show, For } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperButton,
    PaperBadge,
    PaperCard,
    PaperKeyValue,
    PaperKeyValueList,
    PaperList,
    PaperListItem,
    PaperCopyButton,
    PaperToggle,
    createPolling,
    createLatest,
} from "@mileniumhq/paperui";
import { serviceApi, errorMessage } from "@mileniumhq/paperapi";
import { PANEL_ID, type BotSummary } from "../bots";
import {
    appendCapped,
    formatDuration,
    RECENT_MESSAGE_CAP,
    type Health,
} from "../types";
import type { RecentMessage } from "../session";
import { DiscordAvatar } from "../picture";

const HEALTH_POLL_MS = 10000;

interface OverviewProps {
    bot: () => BotSummary;
    /** turns the bot on or off; rejects with the reason it couldn't */
    onSetEnabled: (enabled: boolean) => Promise<unknown>;
}

export default function Overview(props: OverviewProps) {
    const [tag, setTag] = createSignal("");
    const [infoError, setInfoError] = createSignal("");
    const [healthError, setHealthError] = createSignal("");
    const [toggleError, setToggleError] = createSignal("");
    // the messages the session last received, oldest first; reconciled by
    // message id, so a reread keeps the rows already shown
    const [recentStore, setRecentStore] = createStore<{ list: RecentMessage[] }>({ list: [] });
    const recent = () => recentStore.list;
    const setRecent = (next: RecentMessage[]) => setRecentStore("list", reconcile(next, { key: "messageId" }));
    const [health, setHealth] = createSignal<Health | null>(null);
    // the bot's name, avatar and connection are the service's, kept live
    const connected = () => props.bot().connected;
    const connectionError = () => props.bot().lastError;

    // a poll and a reconnect can overlap: only the newest read is shown
    const infoRead = createLatest();
    const healthRead = createLatest();
    // the messages heard live since the newest getBotInfo was asked: its
    // snapshot may have been taken before them
    let heardSince: RecentMessage[] = [];

    const loadBotInfo = async () => {
        const current = infoRead();
        heardSince = [];
        setInfoError("");
        try {
            const info = await serviceApi.call<any>(PANEL_ID, "getBotInfo", { bot: props.bot().id });
            if (!current()) return;
            if (!info || typeof info !== "object") throw new Error("getBotInfo returned no bot details");
            setTag(typeof info.tag === "string" ? info.tag : "");
            if (Array.isArray(info.recentMessages)) {
                const known = new Set(info.recentMessages.map((m: RecentMessage) => m.messageId));
                setRecent(heardSince.filter((m) => !known.has(m.messageId)).reduce((list, m) => appendCapped(list, m, RECENT_MESSAGE_CAP), info.recentMessages as RecentMessage[]));
            }
        } catch (err) {
            if (!current()) return;
            console.error("[Overview] bot info read failed:", err);
            setInfoError(errorMessage(err));
        }
    };

    const loadHealth = async () => {
        const current = healthRead();
        try {
            const next = await serviceApi.call<Health>(PANEL_ID, "getHealth", { bot: props.bot().id });
            if (!current()) return;
            if (!next || typeof next !== "object") {
                throw new Error("getHealth returned no health payload");
            }
            setHealth(next);
            setHealthError("");
        } catch (err) {
            if (!current()) return;
            // the last good reading stays on screen under the error
            console.error("[Overview] health read failed:", err);
            setHealthError(errorMessage(err));
        }
    };

    void loadBotInfo();
    createPolling(loadHealth, HEALTH_POLL_MS, { immediate: true });

    // a bot that comes online has a tag and a fresh session to show
    createEffect(on(connected, (now, before) => {
        if (now && before === false) {
            void loadBotInfo();
            void loadHealth();
        }
    }, { defer: true }));

    // live session truth: the service emits each message with the bot it
    // came to; the subscription is cleaned up with the component (bounded:
    // no listener outlives it)
    onCleanup(
        serviceApi.on(PANEL_ID, "message", (msg: any) => {
            if (!msg || typeof msg !== "object" || msg.bot !== props.bot().id) return;
            const heard: RecentMessage = {
                content: String(msg.content ?? ""),
                author: String(msg.author ?? ""),
                authorId: String(msg.authorId ?? ""),
                channelId: String(msg.channelId ?? ""),
                guildId: msg.guildId ?? null,
                messageId: String(msg.messageId ?? ""),
            };
            heardSince = appendCapped(heardSince, heard, RECENT_MESSAGE_CAP);
            setRecent(appendCapped(recent(), heard, RECENT_MESSAGE_CAP));
        }),
    );

    // only the newest flip may say it failed
    const flipped = createLatest();
    const setEnabled = async (enabled: boolean) => {
        const current = flipped();
        setToggleError("");
        try {
            await props.onSetEnabled(enabled);
        } catch (err) {
            if (current()) setToggleError(errorMessage(err));
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
                    <DiscordAvatar url={props.bot().avatar} fallbackIcon="smart_toy" alt={props.bot().name} size="xlarge" />
                    <PaperFlex direction="column" gap="onefourth" flex minWidth={0}>
                        {/* the switch shares the name's line, so the id below gets the card's width */}
                        <PaperFlex direction="row" gap="half" align="center">
                            <PaperFlex direction="row" gap="half" align="baseline" wrap flex minWidth={0}>
                                <PaperText preset="title" breakWord>{props.bot().name}</PaperText>
                                <Show when={tag() && tag() !== props.bot().name}>
                                    <PaperText preset="hint" breakWord>@{tag()}</PaperText>
                                </Show>
                                <PaperBadge variant={connected() ? "success" : props.bot().connecting ? "warning" : props.bot().enabled ? "danger" : "monochrome"}>
                                    {connected() ? "Online" : props.bot().connecting ? "Connecting" : "Offline"}
                                </PaperBadge>
                            </PaperFlex>
                            <PaperToggle
                                checked={props.bot().enabled}
                                aria-label={`${props.bot().name} is on`}
                                title={props.bot().enabled ? "On: runs while Paperboard does" : "Off"}
                                // the switch flips once saved; its thump waits for the bot to be on or off
                                onChange={setEnabled}
                            />
                        </PaperFlex>
                        <Show when={props.bot().applicationId}>
                            {(appId) => (
                                <PaperFlex direction="row" gap="half" align="center">
                                    <PaperText preset="hint" family="code" breakWord>{appId()}</PaperText>
                                    <PaperCopyButton text={appId()} title="Copy application ID" />
                                </PaperFlex>
                            )}
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <Show when={infoError()}>
                {(text) => <PaperQuote variant="danger" icon="warning" title="Couldn't read the bot's details">{text()}</PaperQuote>}
            </Show>

            <Show when={toggleError()}>
                {(text) => (
                    <PaperQuote variant="danger" icon="warning" title="Couldn't turn the bot on or off" onDismiss={() => setToggleError("")}>
                        {text()}
                    </PaperQuote>
                )}
            </Show>

            {/* a connection that failed, or blocks that couldn't be added to Blocks */}
            <Show when={connectionError()}>
                {(text) => <PaperQuote variant="danger" icon="warning" title="This bot has a problem">{text()}</PaperQuote>}
            </Show>

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center">
                        <PaperText preset="heading">Health</PaperText>
                        <PaperText preset="hint">Refreshes every {HEALTH_POLL_MS / 1000}s</PaperText>
                    </PaperFlex>

                    <Show when={healthError()}>
                        {(text) => <PaperQuote variant="danger" icon="warning" title="Couldn't check health">{text()}</PaperQuote>}
                    </Show>

                    <Show
                        when={health()}
                        fallback={
                            <Show when={!healthError()}>
                                <PaperText preset="hint">Checking health…</PaperText>
                            </Show>
                        }
                    >
                        {(h) => (
                            <PaperKeyValueList>
                                <PaperKeyValue label="Gateway status">{connected() ? "Connected" : "Disconnected"}</PaperKeyValue>
                                <PaperKeyValue label="Gateway latency">{pingText()}</PaperKeyValue>
                                <PaperKeyValue label="Uptime">{uptimeText()}</PaperKeyValue>
                                <PaperKeyValue label="Servers">{h().guildCount}</PaperKeyValue>
                                <PaperKeyValue label="Cached users / channels">{h().cachedUsers} / {h().cachedChannels}</PaperKeyValue>
                                <PaperKeyValue label="Commands received">{h().commandsReceived}</PaperKeyValue>
                                <PaperKeyValue label="Pending replies">{h().pendingInteractions}</PaperKeyValue>
                            </PaperKeyValueList>
                        )}
                    </Show>

                    <Show when={props.bot().commandSyncError}>
                        {(text) => <PaperQuote variant="warning" icon="warning" title="Command sync">{text()}</PaperQuote>}
                    </Show>
                </PaperFlex>
            </PaperCard>

            <Show when={recent().length > 0}>
                <PaperCard>
                    <PaperFlex direction="column" gap="half" padding="full">
                        <PaperText preset="heading">Recent messages</PaperText>
                        <PaperList selectable={false} fullWidth borderless scrollable={false}>
                            <For each={recent()}>
                                {(msg) => (
                                    <PaperListItem value={msg.messageId} icon="chat" description={msg.content || "(no text)"}>
                                        {msg.author}
                                    </PaperListItem>
                                )}
                            </For>
                        </PaperList>
                    </PaperFlex>
                </PaperCard>
            </Show>
        </>
    );
}
