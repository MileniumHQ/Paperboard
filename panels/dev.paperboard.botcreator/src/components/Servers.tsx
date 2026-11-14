import { createSignal, onMount, Show, For, type JSX } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperAvatar,
    PaperButton,
    PaperCard,
    PaperEmptyState,
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
    PaperPage,
    PaperSlidePage,
    usePaperPanel,
} from "@mileniumhq/paperui";
import { serviceApi } from "@mileniumhq/paperapi";
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

/** "1 channel", "2 channels" */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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

    // On a phone a server's page slides in over the list and its bar goes
    // back to it; on a computer the page takes the list's place
    const panel = usePaperPanel();
    const compact = () => Boolean(panel?.compact?.());
    // the server open now; null while the list is
    const [selectedId, setSelectedId] = createSignal<string | null>(null);
    // the server the page shows: on a phone it keeps showing it while its
    // page slides away, so nothing changes under the person's eyes
    const [shownId, setShownId] = createSignal<string | null>(null);
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
            const list = await serviceApi.call<GuildSummary[]>(PANEL_ID, "listGuilds", { bot: bot() });
            if (!Array.isArray(list)) throw new Error("listGuilds returned no server list");
            setGuilds(list);
        } catch (err) {
            console.error("[Servers] guild list read failed:", err);
            setListError(errorToMessage(err));
        } finally {
            setLoadingList(false);
        }

        setHealthError("");
        try {
            const health = await serviceApi.call<Health>(PANEL_ID, "getHealth", { bot: bot() });
            if (!health || typeof health !== "object") {
                throw new Error("getHealth returned no health payload");
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

    // only the newest look at a server may land: a slow answer for one server
    // never shows on the page of the one chosen after it
    let detailRequest = 0;
    let memberRequest = 0;

    const selectGuild = async (guildId: string) => {
        const request = ++detailRequest;
        // reloading the server on screen (Refresh) keeps it, and what was typed or found in it, in place
        const reloading = detail()?.id === guildId;
        setSelectedId(guildId);
        setShownId(guildId);
        setDetailError("");
        setSendError("");
        if (!reloading) {
            memberRequest++;
            setMembersLoading(false);
            setDetail(null);
            setMembers(null);
            setMembersError("");
            setMemberQuery("");
            setSentTo("");
        }
        setDetailLoading(true);
        try {
            const next = await serviceApi.call<GuildDetail>(
                PANEL_ID,
                "getGuildDetail",
                { bot: bot(), guildId },
            );
            if (request !== detailRequest) return;
            setDetail(next);
            if (!reloading || !textChannels().some((channel) => channel.id === channelId())) {
                setChannelId(textChannels()[0]?.id ?? "");
            }
        } catch (err) {
            if (request !== detailRequest) return;
            console.error("[Servers] guild detail read failed:", err);
            setDetailError(errorToMessage(err));
        } finally {
            if (request === detailRequest) setDetailLoading(false);
        }
    };

    const refresh = async () => {
        await loadGuilds();
        const id = selectedId();
        if (id) await selectGuild(id);
    };

    // the page is gone: what it showed goes with it
    const clearServer = () => {
        setShownId(null);
        setDetail(null);
        setMembers(null);
    };

    const closeServer = () => {
        // an answer still on its way is for a page that is no longer open
        detailRequest++;
        memberRequest++;
        setDetailLoading(false);
        setMembersLoading(false);
        setSelectedId(null);
        // a phone's page clears once it has slid away (onClosed)
        if (!compact()) clearServer();
    };

    const searchMembers = async () => {
        const id = selectedId();
        if (!id) return;
        const request = ++memberRequest;
        setMembersLoading(true);
        setMembersError("");
        try {
            const found = await serviceApi.call<MemberSummary[]>(
                PANEL_ID,
                "searchGuildMembers",
                { bot: bot(), guildId: id, query: memberQuery() },
            );
            if (request !== memberRequest) return;
            if (!Array.isArray(found)) throw new Error("searchGuildMembers returned no member list");
            setMembers(found);
        } catch (err) {
            if (request !== memberRequest) return;
            console.error("[Servers] member search failed:", err);
            setMembers(null);
            setMembersError(errorToMessage(err));
        } finally {
            if (request === memberRequest) setMembersLoading(false);
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
            await serviceApi.call(PANEL_ID, "sendMessage", {
                bot: bot(),
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

    // the warnings both pages show above what they list
    const status = (): JSX.Element => (
        <>
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
        </>
    );

    const refreshButton = () => (
        <PaperButton disabled={loadingList()} onClick={() => void refresh()}>
            <PaperIcon>refresh</PaperIcon>
            Refresh
        </PaperButton>
    );

    const server = (): JSX.Element => (
        <>
            <PaperPageHeader
                icon="dns"
                // a server's page is titled by the server, once: its card doesn't say the name again
                title={detail()?.name ?? "Loading server…"}
            >
                {/* on a phone the page's bar goes back to the list */}
                <Show when={!compact()}>
                    <PaperButton onClick={closeServer}>
                        <PaperIcon>arrow_back</PaperIcon>
                        All servers
                    </PaperButton>
                </Show>
                {refreshButton()}
            </PaperPageHeader>

            {status()}

            <Show when={detailLoading() && !detail()}>
                <PaperCard>
                    <PaperFlex padding="double" center>
                        <PaperText preset="hint">
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
                                    <PaperFlex direction="row" gap="half" align="center" wrap>
                                        <PaperText preset="hint" family="code">
                                            {guild().id}
                                        </PaperText>
                                        <PaperCopyButton text={guild().id} title="Copy server ID" />
                                    </PaperFlex>
                                    <PaperFlex direction="row" gap="half" wrap>
                                        <PaperBadge>
                                            {count(guild().memberCount, "member")}
                                        </PaperBadge>
                                        <PaperBadge>
                                            {count(guild().channels.length, "channel")}
                                        </PaperBadge>
                                        <PaperBadge>
                                            {count(guild().roles.length, "role")}
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
                                <PaperText preset="heading">
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
                                                        <PaperText preset="text">
                                                            {channel.name}
                                                        </PaperText>
                                                        <PaperText preset="hint">
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
                                <PaperText preset="heading">
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
                                                            <Show when={role.managed}>
                                                                <PaperBadge variant="primary">
                                                                    Managed
                                                                </PaperBadge>
                                                            </Show>
                                                        </PaperFlex>
                                                    </th>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </PaperTable>
                            </PaperFlex>
                        </PaperCard>

                        <PaperCard>
                            <PaperFlex direction="column" gap="half" padding="full">
                                <PaperText preset="heading">
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
                                            <PaperText preset="hint">
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
                                                                <PaperText preset="label">
                                                                    {member.displayName}
                                                                </PaperText>
                                                                <Show when={member.bot}>
                                                                    <PaperBadge variant="primary">
                                                                        Bot
                                                                    </PaperBadge>
                                                                </Show>
                                                            </PaperFlex>
                                                            <PaperText preset="hint">
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
                                    <PaperText preset="heading">
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
        </>
    );

    return (
        <>
            {/* on a phone the list stays under the server's page, as it was left */}
            <Show when={compact() || !selectedId()}>
                <PaperPageHeader icon="dns" title="Servers" subtitle={count(guilds().length, "server")}>
                    {refreshButton()}
                </PaperPageHeader>

                {status()}

                <Show
                    when={guilds().length > 0 || listError()}
                    fallback={
                        <PaperCard>
                            <PaperEmptyState
                                icon="dns"
                                title={loadingList() ? "Loading servers…" : "No servers"}
                                description="Invite the bot to a server from the Invite tab and it will show up here."
                            />
                        </PaperCard>
                    }
                >
                    <PaperMediaCardGroup>
                        <For each={guilds()}>
                            {(guild) => (
                                <PaperMediaCard
                                    icon={guild.icon || "dns"}
                                    title={guild.name}
                                    subtitle={count(guild.memberCount, "member")}
                                    description={`${count(guild.channelCount, "channel")} · ${count(guild.roleCount, "role")}`}
                                    onClick={() => void selectGuild(guild.id)}
                                />
                            )}
                        </For>
                    </PaperMediaCardGroup>
                </Show>
            </Show>
            <PaperSlidePage
                enabled={compact()}
                position="fixed"
                open={selectedId() !== null}
                title={detail()?.name ?? "Loading server…"}
                icon={<PaperAvatar size="small" src={detail()?.icon || undefined} fallbackIcon="dns" />}
                onBack={closeServer}
                onClosed={clearServer}
            >
                <Show when={shownId()}>
                    <Show when={compact()} fallback={server()}>
                        <PaperFlex direction="column" scrollable="y" fullHeight>
                            <PaperPage>{server()}</PaperPage>
                        </PaperFlex>
                    </Show>
                </Show>
            </PaperSlidePage>
        </>
    );
}

export { Servers };
