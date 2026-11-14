import { createEffect, createSignal, on, Show, For, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
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
import { picture } from "../picture";
import {
    CHANNEL_KIND_LABELS,
    errorToMessage,
    type DiscordChannelKind,
    type GuildChannel,
    type GuildDetail,
    type GuildSummary,
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
    // its rows keep their place
    const [view, setView] = createStore<{ detail: GuildDetail | null; members: MemberSummary[] | null }>({ detail: null, members: null });
    const detail = () => view.detail;
    const setDetail = (next: GuildDetail | null) => setView("detail", reconcile(next, { key: "id" }));
    const members = () => view.members;
    const setMembers = (next: MemberSummary[] | null) => setView("members", reconcile(next, { key: "id" }));
    const [detailLoading, setDetailLoading] = createSignal(false);
    const [detailError, setDetailError] = createSignal("");

    const [memberQuery, setMemberQuery] = createSignal("");
    const [membersLoading, setMembersLoading] = createSignal(false);
    const [membersError, setMembersError] = createSignal("");

    const [channelId, setChannelId] = createSignal("");
    const [content, setContent] = createSignal("Hello from Paperboard!");
    const [sending, setSending] = createSignal(false);
    const [sendError, setSendError] = createSignal("");
    const [sentTo, setSentTo] = createSignal("");

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

    const refresh = () => {
        const id = selectedId();
        if (id) void selectGuild(id);
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
        if (now) void selectGuild(selectedId()!);
        else closeServer();
    }, { defer: true }));

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
        <PaperFlex direction="column" gap="onefourth">
            <PaperText as="h3" preset="section">
                {title}
            </PaperText>
            <For each={channels()}>
                {(channel) => (
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperIcon>{CHANNEL_KIND_ICONS[channel.kind]}</PaperIcon>
                        <PaperText preset="text">{channel.name}</PaperText>
                        <PaperText preset="hint">{CHANNEL_KIND_LABELS[channel.kind]}</PaperText>
                    </PaperFlex>
                )}
            </For>
        </PaperFlex>
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
                <PaperButton disabled={detailLoading()} onClick={refresh}>
                    <PaperIcon>refresh</PaperIcon>
                    Refresh
                </PaperButton>
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
                                    src={picture(guild().icon)}
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
                                <For each={categories()}>
                                    {(category) => channelSection(category.name, () => channelsIn(category.id))}
                                </For>
                                <Show when={uncategorized().length > 0}>
                                    {channelSection("No category", uncategorized)}
                                </Show>
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
                                                        <PaperAvatar src={picture(member.avatar)} size="medium" fallbackIcon="person" />
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
                                    icon={picture(guild.icon) ?? "dns"}
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
                icon={<PaperAvatar size="small" src={picture(detail()?.icon)} fallbackIcon="dns" />}
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

