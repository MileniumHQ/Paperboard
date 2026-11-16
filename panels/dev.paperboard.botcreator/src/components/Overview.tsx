import { createEffect, on, Show, For } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperError,
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
    createRead,
    dismissToast,
    showError,
} from "@mileniumhq/paperui";
import type { BotSummary } from "../bots";
import { botCreator } from "../client";
import {
    appendCapped,
    formatDuration,
    RECENT_MESSAGE_CAP,
    type Health,
} from "../types";
import { DiscordAvatar } from "../picture";

const HEALTH_POLL_MS = 10000;

interface OverviewProps {
    bot: () => BotSummary;
    /** turns the bot on or off; rejects with the reason it couldn't */
    onSetEnabled: (enabled: boolean) => Promise<unknown>;
}

export default function Overview(props: OverviewProps) {
    // the bot's name, avatar and connection are the service's, kept live
    const connected = () => props.bot().connected;
    // the bot's tag and the messages its session last received, oldest
    // first; reconciled by message id, so a reread keeps the rows already
    // shown. Each message the service emits shows at once, and joins a read
    // still out too: its snapshot may have been taken before it
    const info = createRead(
        () => botCreator.calls.getBotInfo({ bot: props.bot().id }).then(({ tag, recentMessages }) => ({ tag, recentMessages })),
        {
            key: "messageId",
            follow: (land) =>
                botCreator.events.message(({ bot, ...heard }) => {
                    if (bot !== props.bot().id) return;
                    // heard before the first read answered: no tag is known yet
                    land(({ tag, recentMessages } = { tag: "", recentMessages: [] }) =>
                        recentMessages.some((m) => m.messageId === heard.messageId)
                            ? { tag, recentMessages }
                            : { tag, recentMessages: appendCapped(recentMessages, heard, RECENT_MESSAGE_CAP) },
                    );
                }),
        },
    );
    const tag = () => info.value()?.tag ?? "";
    const recent = () => info.value()?.recentMessages ?? [];
    // the last good reading stays on screen under the newest failure, which
    // stands through the polls that fail the same way
    const health = createRead(() => botCreator.calls.getHealth({ bot: props.bot().id }));
    createPolling(health.reload, HEALTH_POLL_MS);

    // a bot that comes online has a tag and a fresh session to show
    createEffect(on(connected, (now, before) => {
        if (now && before === false) {
            void info.reload();
            void health.reload();
        }
    }, { defer: true }));

    // only the newest flip may say it failed, and the next flip takes back
    // what the last one said
    const flipped = createLatest();
    let flipToast: string | undefined;
    const setEnabled = async (enabled: boolean) => {
        const current = flipped();
        if (flipToast) dismissToast(flipToast);
        flipToast = undefined;
        try {
            await props.onSetEnabled(enabled);
        } catch (err) {
            if (current()) flipToast = showError("Couldn't turn the bot on or off", err);
        }
    };

    const pingText = () => {
        const h = health.value();
        if (!h || !h.connected || h.wsPing < 0) return "—";
        return `${h.wsPing} ms`;
    };

    const uptimeText = () => {
        const h = health.value();
        if (!h || !h.connected) return "—";
        return formatDuration(h.uptimeMs);
    };

    return (
        <>
            {/* a connection that failed, or blocks that couldn't be added to Blocks */}
            <Show when={props.bot().lastError}>
                {(why) => <PaperError title="Couldn't run the bot" error={why()} />}
            </Show>
            <Show when={info.error()}>
                {(err) => (
                    <PaperError
                        title="Couldn't read the bot's details"
                        error={err()}
                        action={{ label: "Try again", disabled: info.loading(), onClick: () => void info.reload() }}
                    />
                )}
            </Show>
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

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center">
                        <PaperText preset="heading">Health</PaperText>
                        <PaperText preset="hint">Refreshes every {HEALTH_POLL_MS / 1000}s</PaperText>
                    </PaperFlex>

                    <Show when={health.error()}>
                        {(err) => (
                            <PaperError
                                title="Couldn't check health"
                                error={err()}
                                action={{ label: "Try again", disabled: health.loading(), onClick: () => void health.reload() }}
                            />
                        )}
                    </Show>
                    <Show when={health.value()} fallback={<Show when={!health.error()}><PaperText preset="hint">Checking health…</PaperText></Show>}>
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
