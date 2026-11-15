import { createEffect, createSignal, on, Show, For, type JSX } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
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
    PaperList,
    PaperListItem,
    PaperListLabel,
    PaperCopyButton,
    PaperPage,
    PaperSlidePage,
    usePaperPanel,
    createLatest,
    createRead,
} from "@mileniumhq/paperui";
import { errorMessage } from "@mileniumhq/paperapi";
import type { BotSummary } from "../bots";
import { botCreator } from "../client";
import { DiscordAvatar, pictureIcon } from "../picture";
import {
    CHANNEL_KIND_LABELS,
    count,
    type DiscordChannelKind,
    type GuildChannel,
    type GuildSummary,
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

export default function Servers(props: { bot: () => BotSummary }) {
    const bot = () => props.bot().id;
    // the bot's servers and its connection are announced with it, kept live
    // in the panel's store and reconciled by server id: a server it joins,
    // leaves or renames shows at once, and a card that didn't change stays
    const guilds = (): readonly GuildSummary[] => props.bot().guilds;
    const connected = () => props.bot().connected;

    // On a phone a server's page slides in over the list and its bar goes
    // back to it; on a computer the page takes the list's place
    const panel = usePaperPanel();
    const compact = () => Boolean(panel?.compact?.());
    // the server open now; null while the list is
    const [selectedId, setSelectedId] = createSignal<string | null>(null);
    // the server the page shows: on a phone it keeps showing it while its
    // page slides away, so nothing changes under the person's eyes
    const [shownId, setShownId] = createSignal<string | null>(null);
    // what was read of the open server, reconciled by id on every reload so
    // its rows keep their place; only the newest look at a server lands, so a
    // slow answer for one server never shows on the page of the one chosen after it
    const detailRead = createRead((guildId) => botCreator.calls.getGuildDetail({ bot: bot(), guildId }), { source: selectedId });
    const detail = () => detailRead.value();
    // a read again hides the last one's failure, as it did before it was asked
    const detailError = () => (detailRead.loading() ? null : detailRead.error());

    const [memberQuery, setMemberQuery] = createSignal("");
    // a search is asked by pressing Search: each press is a new one
    const [search, setSearch] = createSignal<{ guildId: string; query: string } | null>(null);
    const membersRead = createRead((asked) => botCreator.calls.searchGuildMembers({ bot: bot(), ...asked }), { source: search });
    const membersError = () => (membersRead.loading() ? null : membersRead.error());
    const members = () => (membersRead.error() ? undefined : membersRead.value());

    // the channel picked to send to; the server's first until one is picked
    const [pickedChannel, setPickedChannel] = createSignal("");
    const [content, setContent] = createSignal("Hello from Paperboard!");
    const [sending, setSending] = createSignal(false);
    const [sendError, setSendError] = createSignal("");
    const [sentTo, setSentTo] = createSignal("");

    const textChannels = () =>
        (detail()?.channels ?? []).filter(
            (channel) => channel.kind === "text" || channel.kind === "announcement",
        );
    const channelId = () =>
        textChannels().some((channel) => channel.id === pickedChannel()) ? pickedChannel() : textChannels()[0]?.id ?? "";

    // a message sent from one server's page is never confirmed on another's:
    // sending is an action, not a read
    const sendRead = createLatest();
    const dropSend = () => {
        sendRead.cancel();
        setSending(false);
        setSendError("");
        setSentTo("");
    };

    const selectGuild = (guildId: string) => {
        // a server's page opened again keeps what was typed or found in it
        if (detail()?.id !== guildId) {
            detailRead.set(undefined);
            setSearch(null);
            membersRead.set(undefined);
            setMemberQuery("");
            dropSend();
        }
        setShownId(guildId);
        setSelectedId(guildId);
    };

    // the open server follows what is announced of it: read again when it
    // changes (a rename, a member joining), closed once the bot is no longer in it
    const announced = () => {
        const id = selectedId();
        const guild = id ? guilds().find((g) => g.id === id) : undefined;
        return guild ? JSON.stringify(guild) : null;
    };
    createEffect(on(announced, (now, before) => {
        if (!before) return;
        if (now) void detailRead.reload();
        else closeServer();
    }, { defer: true }));

    // the page is gone: what it showed goes with it
    const clearServer = () => {
        setShownId(null);
        detailRead.set(undefined);
        membersRead.set(undefined);
    };

    const closeServer = () => {
        // an answer still on its way is for a page that is no longer open
        setSelectedId(null);
        setSearch(null);
        dropSend();
        // a phone's page clears once it has slid away (onClosed)
        if (!compact()) clearServer();
    };

    const searchMembers = () => {
        const guildId = selectedId();
        if (guildId) setSearch({ guildId, query: memberQuery() });
    };

    const sendTest = async () => {
        // Enter in the message field while one is on its way: the button is off then too
        if (sending()) return;
        const current = sendRead();
        setSendError("");
        setSentTo("");
        const channel = textChannels().find((c) => c.id === channelId());
        if (!channel) {
            setSendError("Pick a channel first.");
            return;
        }
        if (!content().trim()) {
            setSendError("Write a message first.");
            return;
        }
        setSending(true);
        try {
            await botCreator.calls.sendMessage({
                bot: bot(),
                channel: channel.id,
                content: content().trim(),
            });
            if (current()) setSentTo(`#${channel.name}`);
        } catch (err) {
            console.error("[Servers] test message send failed:", err);
            if (current()) setSendError(errorMessage(err));
        } finally {
            if (current()) setSending(false);
        }
    };

    // channels by category, each category's in Discord's order; the rows are
    // the store's own channels, so a reload keeps them in place
    const channelsIn = (parentId: string | null) =>
        (detail()?.channels ?? []).filter((c) => c.kind !== "category" && c.parentId === parentId);
    const categories = () =>
        (detail()?.channels ?? []).filter((c) => c.kind === "category" && channelsIn(c.id).length > 0);
    const uncategorized = () => {
        const all = detail()?.channels ?? [];
        const categoryIds = new Set(all.filter((c) => c.kind === "category").map((c) => c.id));
        return all.filter((c) => c.kind !== "category" && (c.parentId === null || !categoryIds.has(c.parentId)));
    };

    // the warnings both pages show above what they list
    const status = (): JSX.Element => (
        <>
            <Show when={!connected()}>
                <PaperQuote variant="warning" icon="cloud_off" title={props.bot().connecting ? "Bot connecting" : "Bot offline"}>
                    Servers appear here while the bot is connected.
                </PaperQuote>
            </Show>
        </>
    );

    const channelSection = (title: string, channels: () => GuildChannel[]): JSX.Element => (
        <>
            <PaperListLabel as="h3">{title}</PaperListLabel>
            <For each={channels()}>
                {(channel) => (
                    <PaperListItem value={channel.id} icon={CHANNEL_KIND_ICONS[channel.kind]} description={CHANNEL_KIND_LABELS[channel.kind]}>
                        {channel.name}
                    </PaperListItem>
                )}
            </For>
        </>
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
                <PaperButton disabled={detailRead.loading()} onClick={() => void detailRead.reload()}>
                    <PaperIcon>refresh</PaperIcon>
                    Refresh
                </PaperButton>
            </PaperPageHeader>

            {status()}

            <Show when={detailRead.loading() && !detail()}>
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
                                <DiscordAvatar url={guild().icon} fallbackIcon="dns" size="xlarge" />

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
                                <PaperList selectable={false} fullWidth borderless scrollable={false}>
                                    <For each={categories()}>
                                        {(category) => channelSection(category.name, () => channelsIn(category.id))}
                                    </For>
                                    <Show when={uncategorized().length > 0}>
                                        {channelSection("No category", uncategorized)}
                                    </Show>
                                </PaperList>
                            </PaperFlex>
                        </PaperCard>

                        <PaperCard>
                            <PaperFlex direction="column" gap="half" padding="full">
                                <PaperText preset="heading">
                                    Roles
                                </PaperText>
                                <PaperList selectable={false} fullWidth borderless scrollable={false}>
                                    <For each={guild().roles}>
                                        {(role) => (
                                            <PaperListItem
                                                value={role.id}
                                                icon={<PaperSwatch color={roleColor(role.color)} />}
                                                actions={
                                                    <Show when={role.managed}>
                                                        <PaperBadge variant="primary">Managed</PaperBadge>
                                                    </Show>
                                                }
                                            >
                                                {role.name}
                                            </PaperListItem>
                                        )}
                                    </For>
                                </PaperList>
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
                                                if (e.key === "Enter") searchMembers();
                                            }}
                                        />
                                    </PaperFlex>
                                    <PaperButton
                                        disabled={membersRead.loading()}
                                        onClick={searchMembers}>
                                        <PaperIcon>search</PaperIcon>
                                        {membersRead.loading() ? "Searching…" : "Search"}
                                    </PaperButton>
                                </PaperFlex>

                                <Show when={membersError()}>
                                    <PaperQuote variant="danger" icon="warning" title="Search failed">
                                        {membersError()}
                                    </PaperQuote>
                                </Show>

                                <Show when={members()}>
                                    <Show
                                        when={members()!.length > 0}
                                        fallback={
                                            <PaperText preset="hint">
                                                No members matched.
                                            </PaperText>
                                        }
                                    >
                                        <PaperList selectable={false} fullWidth borderless scrollable={false}>
                                            <For each={members()}>
                                                {(member) => (
                                                    <PaperListItem
                                                        value={member.id}
                                                        icon={<DiscordAvatar url={member.avatar} size="medium" fallbackIcon="person" />}
                                                        description={`@${member.username} · ${formatJoined(member.joinedAt)}`}
                                                        actions={
                                                            <Show when={member.bot}>
                                                                <PaperBadge variant="primary">Bot</PaperBadge>
                                                            </Show>
                                                        }
                                                    >
                                                        {member.displayName}
                                                    </PaperListItem>
                                                )}
                                            </For>
                                        </PaperList>
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
                                        onValueChange={(val) => setPickedChannel(String(val))}
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
                <PaperPageHeader icon="dns" title="Servers" subtitle={count(guilds().length, "server")} />

                {status()}

                <Show
                    when={guilds().length > 0}
                    fallback={
                        <Show when={connected()}>
                            <PaperCard>
                                <PaperEmptyState
                                    icon="dns"
                                    title="No servers"
                                    description="Invite the bot to a server from the Invite tab and it will show up here."
                                />
                            </PaperCard>
                        </Show>
                    }
                >
                    <PaperMediaCardGroup>
                        <For each={guilds()}>
                            {(guild) => (
                                <PaperMediaCard
                                    icon={pictureIcon(guild.icon, "dns")}
                                    title={guild.name}
                                    subtitle={count(guild.memberCount, "member")}
                                    description={`${count(guild.channelCount, "channel")} · ${count(guild.roleCount, "role")}`}
                                    onClick={() => selectGuild(guild.id)}
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
                icon={<DiscordAvatar size="small" url={detail()?.icon} fallbackIcon="dns" />}
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

