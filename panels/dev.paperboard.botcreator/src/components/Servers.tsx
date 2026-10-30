import { createSignal, onMount, Show, For } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperAvatar,
    PaperButton,
    PaperCard,
    PaperIcon,
    PaperBadge,
    PaperInput,
    PaperPageHeader,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSwatch,
    PaperTable,
    PaperCopyButton,
} from "@mileniumhq/paperui";
import { actionsApi, projectActionId } from "@mileniumhq/paperapi";
import { PANEL_ID, type BotSummary } from "../bots";
import {
    CHANNEL_KIND_LABELS,
    errorToMessage,
    type DiscordChannelKind,
    type GuildChannel,
    type GuildDetail,
    type GuildSummary,
    type Health,
    type MemberSummary,
} from "../types";


const CHANNEL_KIND_ICONS: Record<DiscordChannelKind, string> = {
    text: "tag",
    voice: "volume_up",
    category: "folder",
    announcement: "campaign",
    stage: "mic",
    forum: "forum",
    media: "perm_media",
    other: "drafts",
};

function formatJoined(iso: string | null): string {
    if (!iso) return "join date unknown";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "join date unknown";
    return `joined ${date.toLocaleDateString()}`;
}

function formatCreated(iso: string): string {
    if (!iso) return "unknown";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "unknown";
    return date.toLocaleDateString();
}

function roleColor(color: number): string | undefined {
    // 0 is Discord's "no colour": the swatch shows its neutral tone
    if (!color) return undefined;
    return `#${color.toString(16).padStart(6, "0")}`;
}

interface ChannelGroup {
    id: string;
    name: string;
    channels: GuildChannel[];
}

export default function Servers(props: { bot: () => BotSummary }) {
    const bot = () => props.bot().id;
    const [guilds, setGuilds] = createSignal<GuildSummary[]>([]);
    // null until the first health read answers: unknown is not offline
    const [connected, setConnected] = createSignal<boolean | null>(null);
    const [healthError, setHealthError] = createSignal("");
    const [listError, setListError] = createSignal("");
    const [loadingList, setLoadingList] = createSignal(true);

    const [selectedId, setSelectedId] = createSignal<string | null>(null);
    const [detail, setDetail] = createSignal<GuildDetail | null>(null);
    const [detailLoading, setDetailLoading] = createSignal(false);
    const [detailError, setDetailError] = createSignal("");

    const [memberQuery, setMemberQuery] = createSignal("");
    const [members, setMembers] = createSignal<MemberSummary[] | null>(null);
    const [membersLoading, setMembersLoading] = createSignal(false);
    const [membersError, setMembersError] = createSignal("");

    const [channelId, setChannelId] = createSignal("");
    const [content, setContent] = createSignal("Hello from Paperboard!");
    const [sending, setSending] = createSignal(false);
    const [sendError, setSendError] = createSignal("");
    const [sentTo, setSentTo] = createSignal("");

    const loadGuilds = async () => {
        setLoadingList(true);
        setListError("");
        try {
            const list = await actionsApi.call<GuildSummary[]>(PANEL_ID, "list-guilds", { bot: bot() });
            if (!Array.isArray(list)) throw new Error("list-guilds returned no server list");
            setGuilds(list);
        } catch (err) {
            console.error("[Servers] guild list read failed:", err);
            setListError(errorToMessage(err));
        } finally {
            setLoadingList(false);
        }

        setHealthError("");
        try {
            const health = await actionsApi.call<Health>(PANEL_ID, "get-health", { bot: bot() });
            if (!health || typeof health !== "object") {
                throw new Error("get-health returned no health payload");
            }
            setConnected(Boolean(health.connected));
        } catch (err) {
            console.error("[Servers] health read failed:", err);
            setHealthError(errorToMessage(err));
        }
    };

    onMount(() => {
        void loadGuilds();
    });

    const textChannels = () =>
        (detail()?.channels ?? []).filter(
            (channel) => channel.kind === "text" || channel.kind === "announcement",
        );

    const selectGuild = async (guildId: string) => {
        setSelectedId(guildId);
        setDetail(null);
        setDetailError("");
        setMembers(null);
        setMembersError("");
        setMemberQuery("");
        setSendError("");
        setSentTo("");
        setDetailLoading(true);
        try {
            const next = await actionsApi.call<GuildDetail>(
                PANEL_ID,
                "get-guild-detail",
                { bot: bot(), guildId },
            );
            setDetail(next);
            setChannelId(textChannels()[0]?.id ?? "");
        } catch (err) {
            console.error("[Servers] guild detail read failed:", err);
            setDetailError(errorToMessage(err));
        } finally {
            setDetailLoading(false);
        }
    };

    const refresh = async () => {
        await loadGuilds();
        const id = selectedId();
        if (id) await selectGuild(id);
    };

    const searchMembers = async () => {
        const id = selectedId();
        if (!id) return;
        setMembersLoading(true);
        setMembersError("");
        try {
            const found = await actionsApi.call<MemberSummary[]>(
                PANEL_ID,
                "search-guild-members",
                { bot: bot(), guildId: id, query: memberQuery() },
            );
            if (!Array.isArray(found)) throw new Error("search-guild-members returned no member list");
            setMembers(found);
        } catch (err) {
            console.error("[Servers] member search failed:", err);
            setMembers(null);
            setMembersError(errorToMessage(err));
        } finally {
            setMembersLoading(false);
        }
    };

    const sendTest = async () => {
        setSendError("");
        setSentTo("");
        if (!channelId()) {
            setSendError("Pick a channel first.");
            return;
        }
        if (!content().trim()) {
            setSendError("Write a message first.");
            return;
        }
        setSending(true);
        try {
            await actionsApi.call(PANEL_ID, projectActionId(bot(), "send-message"), {
                channel: channelId(),
                content: content().trim(),
            });
            const channel = textChannels().find((c) => c.id === channelId());
            setSentTo(channel ? `#${channel.name}` : "the channel");
        } catch (err) {
            console.error("[Servers] test message send failed:", err);
            setSendError(errorToMessage(err));
        } finally {
            setSending(false);
        }
    };

    const channelGroups = (): ChannelGroup[] => {
        const d = detail();
        if (!d) return [];
        const categoryIds = new Set(
            d.channels.filter((c) => c.kind === "category").map((c) => c.id),
        );
        const groups: ChannelGroup[] = d.channels
            .filter((c) => c.kind === "category")
            .map((category) => ({
                id: category.id,
                name: category.name,
                channels: d.channels.filter(
                    (c) => c.kind !== "category" && c.parentId === category.id,
                ),
            }))
            .filter((group) => group.channels.length > 0);

        const orphaned = d.channels.filter(
            (c) =>
                c.kind !== "category" &&
                (c.parentId === null || !categoryIds.has(c.parentId)),
        );
        if (orphaned.length > 0) {
            groups.push({ id: "__none", name: "No category", channels: orphaned });
        }
        return groups;
    };

    return (
        <>
                    <PaperPageHeader
                        icon="dns"
                        title="Servers"
                        subtitle={
                            selectedId()
                                ? detail()?.name ?? "Loading server…"
                                : `${guilds().length} server${guilds().length === 1 ? "" : "s"}`
                        }
                    >
                        <Show when={selectedId()}>
                            <PaperButton
                                onClick={() => {
                                    setSelectedId(null);
                                    setDetail(null);
                                    setMembers(null);
                                }}>
                                <PaperIcon>arrow_back</PaperIcon>
                                All servers
                            </PaperButton>
                        </Show>
                        <PaperButton disabled={loadingList()} onClick={() => void refresh()}>
                            <PaperIcon>refresh</PaperIcon>
                            Refresh
                        </PaperButton>
                    </PaperPageHeader>

                    <Show when={connected() === false}>
                        <PaperQuote variant="warning" icon="cloud_off" title="Bot offline">
                            Servers appear here while the bot is connected.
                        </PaperQuote>
                    </Show>

                    <Show when={healthError()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't check the bot's connection">
                            {healthError()}
                        </PaperQuote>
                    </Show>

                    <Show when={listError()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't list the servers">
                            {listError()}
                        </PaperQuote>
                    </Show>

                    <Show when={!selectedId()}>
                        <Show
                            when={guilds().length > 0 || listError()}
                            fallback={
                                <PaperCard>
                                    <PaperFlex padding="double" center direction="column" gap="half">
                                        <PaperText size={4} weight={600}>
                                            {loadingList() ? "Loading servers…" : "No servers"}
                                        </PaperText>
                                        <PaperText size={2} color="text-subtle">
                                            Invite the bot to a server from the Invite tab and
                                            it will show up here.
                                        </PaperText>
                                    </PaperFlex>
                                </PaperCard>
                            }
                        >
                            <PaperMediaCardGroup>
                                <For each={guilds()}>
                                    {(guild) => (
                                        <PaperMediaCard
                                            icon={guild.icon || "dns"}
                                            title={guild.name}
                                            subtitle={`${guild.memberCount} member${guild.memberCount === 1 ? "" : "s"}`}
                                            description={`${guild.channelCount} channels · ${guild.roleCount} roles`}
                                            onClick={() => void selectGuild(guild.id)}
                                        />
                                    )}
                                </For>
                            </PaperMediaCardGroup>
                        </Show>
                    </Show>

                    <Show when={selectedId()}>
                        <Show when={detailLoading()}>
                            <PaperCard>
                                <PaperFlex padding="double" center>
                                    <PaperText size={3} color="text-subtle">
                                        Loading server…
                                    </PaperText>
                                </PaperFlex>
                            </PaperCard>
                        </Show>

                        <Show when={detailError()}>
                            <PaperQuote variant="danger" icon="warning" title="Couldn't load this server">
                                {detailError()}
                            </PaperQuote>
                        </Show>

                        <Show when={detail()}>
                            {(guild) => (
                                <>
                                    <PaperCard>
                                        <PaperFlex direction="row" padding="full" gap="full" align="center">
                                            <PaperAvatar
                                                src={guild().icon}
                                                fallbackIcon="dns"
                                                size="xlarge"
                                            />

                                            <PaperFlex direction="column" gap="half" flex minWidth={0}>
                                                <PaperText weight={700} size={6}>
                                                    {guild().name}
                                                </PaperText>
                                                <PaperFlex direction="row" gap="half" align="center" wrap>
                                                    <PaperText size={2} color="text-subtle" family="code">
                                                        {guild().id}
                                                    </PaperText>
                                                    <PaperCopyButton text={guild().id} title="Copy server ID" />
                                                </PaperFlex>
                                                <PaperFlex direction="row" gap="half" wrap>
                                                    <PaperBadge>
                                                        {guild().memberCount} members
                                                    </PaperBadge>
                                                    <PaperBadge>
                                                        {guild().channels.length} channels
                                                    </PaperBadge>
                                                    <PaperBadge>
                                                        {guild().roles.length} roles
                                                    </PaperBadge>
                                                    <PaperBadge>
                                                        Created {formatCreated(guild().createdAt)}
                                                    </PaperBadge>
                                                </PaperFlex>
                                            </PaperFlex>
                                        </PaperFlex>
                                    </PaperCard>

                                    <PaperCard>
                                        <PaperFlex direction="column" gap="half" padding="full">
                                            <PaperText weight={700} size={5}>
                                                Channels
                                            </PaperText>
                                            <For each={channelGroups()}>
                                                {(group) => (
                                                    <PaperFlex direction="column" gap="onefourth">
                                                        <PaperText as="h3" preset="section">
                                                            {group.name}
                                                        </PaperText>
                                                        <For each={group.channels}>
                                                            {(channel) => (
                                                                <PaperFlex
                                                                    direction="row"
                                                                    gap="half"
                                                                    align="center"
                                                                >
                                                                    <PaperIcon>
                                                                        {CHANNEL_KIND_ICONS[channel.kind]}
                                                                    </PaperIcon>
                                                                    <PaperText size={3}>
                                                                        {channel.name}
                                                                    </PaperText>
                                                                    <PaperText size={1} color="text-subtle">
                                                                        {CHANNEL_KIND_LABELS[channel.kind]}
                                                                    </PaperText>
                                                                </PaperFlex>
                                                            )}
                                                        </For>
                                                    </PaperFlex>
                                                )}
                                            </For>
                                        </PaperFlex>
                                    </PaperCard>

                                    <PaperCard>
                                        <PaperFlex direction="column" gap="half" padding="full">
                                            <PaperText weight={700} size={5}>
                                                Roles
                                            </PaperText>
                                            <PaperTable>
                                                <tbody>
                                                    <For each={guild().roles}>
                                                        {(role) => (
                                                            <tr>
                                                                <th>
                                                                    <PaperFlex
                                                                        direction="row"
                                                                        gap="half"
                                                                        align="center"
                                                                    >
                                                                        <PaperSwatch color={roleColor(role.color)} />
                                                                        {role.name}
                                                                    </PaperFlex>
                                                                </th>
                                                                <td>
                                                                    <Show when={role.managed}>
                                                                        <PaperBadge variant="primary">
                                                                            Managed
                                                                        </PaperBadge>
                                                                    </Show>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </For>
                                                </tbody>
                                            </PaperTable>
                                        </PaperFlex>
                                    </PaperCard>

                                    <PaperCard>
                                        <PaperFlex direction="column" gap="half" padding="full">
                                            <PaperText weight={700} size={5}>
                                                Members
                                            </PaperText>
                                            <PaperFlex direction="row" gap="half" align="center">
                                                <PaperFlex flex minWidth={0}>
                                                    <PaperInput
                                                        fullWidth
                                                        icon="search"
                                                        placeholder="Search members"
                                                        value={memberQuery()}
                                                        onInput={(e) =>
                                                            setMemberQuery(e.currentTarget.value)
                                                        }
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") void searchMembers();
                                                        }}
                                                    />
                                                </PaperFlex>
                                                <PaperButton
                                                    disabled={membersLoading()}
                                                    onClick={() => void searchMembers()}>
                                                    <PaperIcon>search</PaperIcon>
                                                    {membersLoading() ? "Searching…" : "Search"}
                                                </PaperButton>
                                            </PaperFlex>

                                            <Show when={membersError()}>
                                                <PaperQuote variant="danger" icon="warning" title="Search failed">
                                                    {membersError()}
                                                </PaperQuote>
                                            </Show>

                                            <Show when={members() !== null}>
                                                <Show
                                                    when={members()!.length > 0}
                                                    fallback={
                                                        <PaperText size={2} color="text-subtle">
                                                            No members matched.
                                                        </PaperText>
                                                    }
                                                >
                                                    <PaperFlex direction="column" gap="half">
                                                        <For each={members()}>
                                                            {(member) => (
                                                                <PaperFlex
                                                                    direction="row"
                                                                    gap="half"
                                                                    align="center"
                                                                    fullWidth
                                                                >
                                                                    <PaperAvatar src={member.avatar} size="medium" fallbackIcon="person" />
                                                                    <PaperFlex direction="column" gap="onefourth" flex minWidth={0}>
                                                                        <PaperFlex
                                                                            direction="row"
                                                                            gap="half"
                                                                            align="center"
                                                                        >
                                                                            <PaperText size={3} weight={600}>
                                                                                {member.displayName}
                                                                            </PaperText>
                                                                            <Show when={member.bot}>
                                                                                <PaperBadge variant="primary">
                                                                                    Bot
                                                                                </PaperBadge>
                                                                            </Show>
                                                                        </PaperFlex>
                                                                        <PaperText size={1} color="text-subtle">
                                                                            @{member.username} ·{" "}
                                                                            {formatJoined(member.joinedAt)}
                                                                        </PaperText>
                                                                    </PaperFlex>
                                                                </PaperFlex>
                                                            )}
                                                        </For>
                                                    </PaperFlex>
                                                </Show>
                                            </Show>
                                        </PaperFlex>
                                    </PaperCard>

                                    <Show when={textChannels().length > 0}>
                                        <PaperCard>
                                            <PaperFlex direction="column" gap="half" padding="full">
                                                <PaperText weight={700} size={5}>
                                                    Send a message
                                                </PaperText>
                                                <PaperSelectMenu
                                                    name="testChannel"
                                                    fullWidth
                                                    value={channelId()}
                                                    onValueChange={(val) => setChannelId(String(val))}
                                                >
                                                    <For each={textChannels()}>
                                                        {(channel) => (
                                                            <PaperSelectMenuItem
                                                                value={channel.id}
                                                                icon={CHANNEL_KIND_ICONS[channel.kind]}
                                                            >
                                                                #{channel.name}
                                                            </PaperSelectMenuItem>
                                                        )}
                                                    </For>
                                                </PaperSelectMenu>
                                                <PaperFlex direction="row" gap="half" align="center">
                                                    <PaperFlex flex minWidth={0}>
                                                        <PaperInput
                                                            fullWidth
                                                            placeholder="Message"
                                                            value={content()}
                                                            onInput={(e) =>
                                                                setContent(e.currentTarget.value)
                                                            }
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter") void sendTest();
                                                            }}
                                                        />
                                                    </PaperFlex>
                                                    <PaperButton
                                                        variant="success"
                                                        disabled={sending()}
                                                        onClick={() => void sendTest()}>
                                                        <PaperIcon>send</PaperIcon>
                                                        {sending() ? "Sending…" : "Send"}
                                                    </PaperButton>
                                                </PaperFlex>
                                                <Show when={sendError()}>
                                                    <PaperQuote variant="danger" icon="warning" title="Message not sent">
                                                        {sendError()}
                                                    </PaperQuote>
                                                </Show>
                                                <Show when={sentTo()}>
                                                    <PaperQuote variant="success" icon="check_circle" title="Message sent">
                                                        Posted to {sentTo()}.
                                                    </PaperQuote>
                                                </Show>
                                            </PaperFlex>
                                        </PaperCard>
                                    </Show>
                                </>
                            )}
                        </Show>
                    </Show>
        </>
    );
}

export { Servers };
