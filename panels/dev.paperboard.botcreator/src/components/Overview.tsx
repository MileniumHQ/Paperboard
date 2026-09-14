import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import {
    PaperFlex,
    PaperContainer,
    PaperText,
    PaperQuote,
    PaperCenteredInterface,
    PaperButton,
    PaperInput,
    PaperSelectMenu,
    PaperSelectMenuItem,
} from "@paperboard-dev/paperui";
import { actionsApi, config } from "@paperboard-dev/paperapi";
import {
    appendCapped,
    DEFAULT_DISCORD_AVATAR,
    errorToMessage,
    RECENT_MESSAGE_CAP,
} from "../types";

interface GuildInfo {
    id: string;
    name: string;
    channels: { id: string; name: string }[];
}

interface RecentMessage {
    content: string;
    author: string;
    channelId: string;
    guildId: string | null;
    messageId: string;
}

const PANEL_ID = "dev.paperboard.botcreator";

export default function Overview() {
    const [name, setName] = createSignal("Discord Bot");
    const [tag, setTag] = createSignal("");
    const [avatar, setAvatar] = createSignal(DEFAULT_DISCORD_AVATAR);
    const [appId, setAppId] = createSignal("");
    const [servers, setServers] = createSignal(0);
    const [connected, setConnected] = createSignal(false);
    // the recorded gateway error: an Offline badge with no reason is the
    // same dead-end the old always-online lie was
    const [connectionError, setConnectionError] = createSignal<string | null>(null);
    const [guilds, setGuilds] = createSignal<GuildInfo[]>([]);
    const [recent, setRecent] = createSignal<RecentMessage[]>([]);

    const [guildId, setGuildId] = createSignal("");
    const [channelId, setChannelId] = createSignal("");
    const [testContent, setTestContent] = createSignal("Hello from Paperboard!");
    const [sending, setSending] = createSignal(false);
    const [sendNote, setSendNote] = createSignal("");
    const [sendError, setSendError] = createSignal("");

    const loadBotInfo = async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved?.applicationId) setAppId(saved.applicationId);
        } catch (err) { console.error('[Overview] bot info read failed:', err); }

        try {
            const info = await actionsApi.call<any>(
                PANEL_ID,
                "get-bot-info",
            );
            if (info) {
                if (info.name) setName(info.name);
                if (info.tag) setTag(info.tag);
                if (info.avatar) setAvatar(info.avatar);
                if (info.applicationId) setAppId(info.applicationId);
                if (typeof info.guildCount === "number") setServers(info.guildCount);
                if (typeof info.connected === "boolean") setConnected(info.connected);
                if (typeof info.lastError === "string") setConnectionError(info.lastError);
                else if (info.connected) setConnectionError(null);
                if (Array.isArray(info.guilds)) {
                    setGuilds(info.guilds);
                    if (!guildId() && info.guilds.length > 0) {
                        pickGuild(info.guilds[0].id, info.guilds);
                    }
                }
                if (Array.isArray(info.recentMessages)) setRecent(info.recentMessages);
            }
        } catch (err) { console.error('[Overview] bot info read failed:', err); }
    };

    const pickGuild = (id: string, list: GuildInfo[] = guilds()) => {
        setGuildId(id);
        const guild = list.find((g) => g.id === id);
        setChannelId(guild?.channels[0]?.id ?? "");
    };

    const sendTest = async () => {
        setSendNote("");
        setSendError("");
        if (!channelId()) {
            setSendError("Pick a server and channel first.");
            return;
        }
        if (!testContent().trim()) {
            setSendError("Write a message first.");
            return;
        }
        setSending(true);
        try {
            // one call to the existing registered send-message action
            await actionsApi.call(PANEL_ID, "send-message", {
                channel: channelId(),
                content: testContent().trim(),
            });
            setSendNote("Test message sent.");
        } catch (err) {
            console.error('[Overview] test message send failed:', err);
            setSendError(errorToMessage(err));
        } finally {
            setSending(false);
        }
    };

    onMount(() => {
        loadBotInfo();
    });

    // live session truth: the service already emits these triggers — the
    // UI just never listened. Each subscription returns its own
    // unsubscriber, registered for cleanup (bounded: no listener outlives
    // the component).
    onCleanup(
        actionsApi.onTrigger(PANEL_ID, "on-message", (msg: any) => {
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
            // a gateway-delivered message is live connectivity evidence:
            // flip the badge back online and clear the stale error
            setConnected(true);
            setConnectionError(null);
        }),
    );

    onCleanup(
        actionsApi.onTrigger<{ error?: string }>(
            PANEL_ID,
            "on-connection-error",
            (payload) => {
                setConnected(false);
                setConnectionError(payload?.error ? String(payload.error) : "Connection error");
            },
        ),
    );

    return (
        <PaperCenteredInterface size="large">
            <PaperFlex fullWidth gap="full" direction="column">
                <PaperContainer>
                    <PaperFlex fullWidth padding="double" gap="full" align="center" direction="row">
                        <img
                            src={avatar() || DEFAULT_DISCORD_AVATAR}
                            alt={name()}
                            style={{
                                width: "72px",
                                height: "72px",
                                "border-radius": "50%",
                                "object-fit": "cover",
                                border: "1px solid var(--paper-medium-border)",
                            }}
                        />

                        <PaperFlex direction="column" gap="onefourth" style={{ flex: 1, "min-width": 0 }}>
                            <PaperFlex direction="row" gap="half" align="baseline">
                                <PaperText weight={700} size={7}>
                                    {name()}
                                </PaperText>
                                <Show when={tag() && tag() !== name()}>
                                    <PaperText size={3} color="light-text">
                                        @{tag()}
                                    </PaperText>
                                </Show>
                            </PaperFlex>

                            <PaperFlex direction="row" gap="full" align="center" style={{ "margin-top": "0.25rem" }}>
                                <Show when={appId()}>
                                    <PaperText size={2} color="light-text">
                                        Application ID: {appId()}
                                    </PaperText>
                                </Show>
                                <PaperText size={2} color="light-text">
                                    {servers()} {servers() === 1 ? "server" : "servers"}
                                </PaperText>
                                <Show
                                    when={connected()}
                                    fallback={
                                        <>
                                            <PaperText size={2} color="red">
                                                Offline
                                            </PaperText>
                                            <Show when={connectionError()}>
                                                <PaperText size={2} color="red">
                                                    {connectionError()}
                                                </PaperText>
                                            </Show>
                                        </>
                                    }
                                >
                                    <PaperText size={2} color="light-text">
                                        Online
                                    </PaperText>
                                </Show>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperFlex>
                </PaperContainer>

                <Show when={connected() && guilds().length > 0}>
                    <PaperContainer>
                        <PaperFlex fullWidth padding="double" gap="half" direction="column">
                            <PaperText weight={700} size={5}>
                                Servers
                            </PaperText>
                            <For each={guilds()}>
                                {(guild) => (
                                    <PaperText size={3}>
                                        {guild.name}, {guild.channels.length}{" "}
                                        {guild.channels.length === 1 ? "channel" : "channels"}
                                    </PaperText>
                                )}
                            </For>
                        </PaperFlex>
                    </PaperContainer>

                    <PaperContainer>
                        <PaperFlex fullWidth padding="double" gap="half" direction="column">
                            <PaperText weight={700} size={5}>
                                Send test message
                            </PaperText>
                            <PaperSelectMenu
                                name="guild"
                                value={guildId()}
                                onValueChange={(val) => pickGuild(String(val))}
                            >
                                <For each={guilds()}>
                                    {(guild) => (
                                        <PaperSelectMenuItem value={guild.id}>
                                            {guild.name}
                                        </PaperSelectMenuItem>
                                    )}
                                </For>
                            </PaperSelectMenu>
                            <PaperSelectMenu
                                name="channel"
                                value={channelId()}
                                onValueChange={(val) => setChannelId(String(val))}
                            >
                                <For each={guilds().find((g) => g.id === guildId())?.channels ?? []}>
                                    {(channel) => (
                                        <PaperSelectMenuItem value={channel.id}>
                                            #{channel.name}
                                        </PaperSelectMenuItem>
                                    )}
                                </For>
                            </PaperSelectMenu>
                            <PaperInput
                                fullWidth
                                placeholder="Test message"
                                value={testContent()}
                                onInput={(e) => setTestContent(e.currentTarget.value)}
                            />
                            <PaperButton
                                variant="green"
                                disabled={sending()}
                                onClick={() => void sendTest()}
                            >
                                {sending() ? "Sending…" : "Send test message"}
                            </PaperButton>
                            <Show when={sendNote()}>
                                <PaperQuote variant="green" icon="check" title="Sent">
                                    {sendNote()}
                                </PaperQuote>
                            </Show>
                            <Show when={sendError()}>
                                <PaperQuote variant="red" icon="warning" title="Error">
                                    {sendError()}
                                </PaperQuote>
                            </Show>
                        </PaperFlex>
                    </PaperContainer>
                </Show>

                <Show when={recent().length > 0}>
                    <PaperContainer>
                        <PaperFlex fullWidth padding="double" gap="half" direction="column">
                            <PaperText weight={700} size={5}>
                                Recent messages
                            </PaperText>
                            <For each={recent()}>
                                {(msg) => (
                                    <PaperText size={3}>
                                        {msg.author}: {msg.content || "(no text)"}
                                    </PaperText>
                                )}
                            </For>
                        </PaperFlex>
                    </PaperContainer>
                </Show>

                <PaperQuote variant="brand" icon="extension" title="Note">
                    Install Actions from the Panel Library to do more with the bot.
                </PaperQuote>
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

export { Overview };
