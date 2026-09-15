import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperButton,
    PaperAvatar,
    PaperBadge,
    PaperIcon,
    PaperTable,
    PaperCard, getVarCss } from "@paperboard-dev/paperui";
import { actionsApi, config } from "@paperboard-dev/paperapi";
import {
    appendCapped,
    DEFAULT_DISCORD_AVATAR,
    formatBytes,
    formatDuration,
    RECENT_MESSAGE_CAP,
} from "../types";

const PANEL_ID = "dev.paperboard.botcreator";
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
    memoryRss: number;
    memoryHeapUsed: number;
    commandsReceived: number;
    pendingInteractions: number;
    commandSyncError: string | null;
}

export default function Overview() {
    const [name, setName] = createSignal("Discord Bot");
    const [tag, setTag] = createSignal("");
    const [avatar, setAvatar] = createSignal(DEFAULT_DISCORD_AVATAR);
    const [appId, setAppId] = createSignal("");
    const [connected, setConnected] = createSignal(false);
    const [connectionError, setConnectionError] = createSignal<string | null>(null);
    const [copied, setCopied] = createSignal(false);
    const [recent, setRecent] = createSignal<RecentMessage[]>([]);
    const [health, setHealth] = createSignal<Health | null>(null);

    const loadBotInfo = async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved?.applicationId) setAppId(saved.applicationId);
        } catch (err) {
            console.error("[Overview] saved application id read failed:", err);
        }

        try {
            const info = await actionsApi.call<any>(PANEL_ID, "get-bot-info");
            if (info) {
                if (info.name) setName(info.name);
                if (info.tag) setTag(info.tag);
                if (info.avatar) setAvatar(info.avatar);
                if (info.applicationId) setAppId(info.applicationId);
                if (typeof info.connected === "boolean") setConnected(info.connected);
                if (typeof info.lastError === "string") setConnectionError(info.lastError);
                else if (info.connected) setConnectionError(null);
                if (Array.isArray(info.recentMessages)) setRecent(info.recentMessages);
            }
        } catch (err) {
            console.error("[Overview] bot info read failed:", err);
        }
    };

    const loadHealth = async () => {
        try {
            const next = await actionsApi.call<Health>(PANEL_ID, "get-health");
            if (!next || typeof next !== "object") {
                throw new Error("get-health returned no health payload");
            }
            setHealth(next);
        } catch (err) {
            console.error("[Overview] health read failed:", err);
        }
    };

    const copyAppId = async () => {
        if (!appId()) return;
        try {
            await navigator.clipboard.writeText(appId());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            // a failed copy must not falsely claim "Copied"
            console.error("[Overview] clipboard copy failed:", err);
        }
    };

    onMount(() => {
        void loadBotInfo();
        void loadHealth();
        const poll = setInterval(() => void loadHealth(), HEALTH_POLL_MS);
        onCleanup(() => clearInterval(poll));
    });

    // live session truth: the service already emits these triggers — each
    // subscription is cleaned up with the component (bounded: no listener
    // outlives it).
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
                                src={avatar() || DEFAULT_DISCORD_AVATAR}
                                alt={name()}
                                size="xlarge"
                            />

                            <PaperFlex
                                direction="column"
                                gap="onefourth"
                                style={{ flex: 1, "min-width": 0 }}
                            >
                                <PaperFlex direction="row" gap="half" align="baseline" wrap>
                                    <PaperText weight={700} size={6}>
                                        {name()}
                                    </PaperText>
                                    <Show when={tag() && tag() !== name()}>
                                        <PaperText size={3} color="text-subtle">
                                            @{tag()}
                                        </PaperText>
                                    </Show>
                                    <PaperBadge variant={connected() ? "success" : "danger"}>
                                        {connected() ? "Online" : "Offline"}
                                    </PaperBadge>
                                </PaperFlex>

                                <Show when={appId()}>
                                    <PaperFlex direction="row" gap="half" align="center">
                                        <PaperText size={2} color="text-subtle" family="code">
                                            {appId()}
                                        </PaperText>
                                        <PaperButton size="tiny"
                                            icon
                                            onClick={() => void copyAppId()}
                                            title={copied() ? "Copied!" : "Copy application ID"}>
                                            <PaperIcon>
                                                {copied() ? "check" : "content_copy"}
                                            </PaperIcon>
                                        </PaperButton>
                                    </PaperFlex>
                                </Show>
                            </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <Show when={connectionError()}>
                        <PaperQuote variant="danger" icon="warning" title="Connection error">
                            {connectionError()}
                        </PaperQuote>
                    </Show>

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center">
                                <PaperText weight={700} size={5}>
                                    Health
                                </PaperText>
                                <PaperText size={2} color="text-subtle">
                                    Refreshes every {HEALTH_POLL_MS / 1000}s
                                </PaperText>
                            </PaperFlex>

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
                                        <td>{health()?.guildCount ?? 0}</td>
                                    </tr>
                                    <tr>
                                        <th>Cached users / channels</th>
                                        <td>
                                            {health()?.cachedUsers ?? 0} /{" "}
                                            {health()?.cachedChannels ?? 0}
                                        </td>
                                    </tr>
                                    <tr>
                                        <th>Memory</th>
                                        <td>
                                            {health()
                                                ? `${formatBytes(health()!.memoryRss)} RSS · ${formatBytes(health()!.memoryHeapUsed)} heap`
                                                : "—"}
                                        </td>
                                    </tr>
                                    <tr>
                                        <th>Commands received</th>
                                        <td>{health()?.commandsReceived ?? 0}</td>
                                    </tr>
                                    <tr>
                                        <th>Pending replies</th>
                                        <td>{health()?.pendingInteractions ?? 0}</td>
                                    </tr>
                                </tbody>
                            </PaperTable>

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
                        <PaperText weight={700} size={5}>
                            Recent messages
                        </PaperText>
                        <For each={recent()}>
                            {(msg) => (
                                <PaperText size={3}>
                                    <span style={{ color: `${getVarCss("text-subtle")}` }}>
                                        {msg.author}:
                                    </span>{" "}
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

export { Overview };
