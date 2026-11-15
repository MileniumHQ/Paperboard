// One implementation for every "reach a channel, then operate on a message"
// and "answer a pending interaction" operation, and the server and member
// lookups they need. The blocks in blocks/ stay thin: they parse inputs and
// call these classes; channel resolution and the Discord not-text-based
// errors live here once, not per action. What is sent is built in payloads.ts.
import type {
    Client,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    PermissionsBitField,
    RepliableInteraction,
    Guild,
    GuildMember,
} from "discord.js";
import { loadDiscord } from "./discord";
import { actionRows, buildMessagePayload, buildModalPayload, embedFrom, listInput, modalFieldId, normalizeEmbeds, type MessagePayloadInput } from "./payloads";
import { errorToMessage } from "./types";

export interface ComponentClickData {
    customId: string;
    interactionId: string;
    userId: string;
    username: string;
    channelId: string;
    guildId: string;
    messageId: string;
    /** what a select menu's user picked; empty for a button click */
    values: string[];
    /** the first pick, for single-choice menus; empty for a button click */
    value: string;
}

export function componentClickPayload(
    interaction: MessageComponentInteraction,
): ComponentClickData {
    const values = interaction.isAnySelectMenu() ? [...interaction.values] : [];
    return {
        customId: interaction.customId,
        interactionId: interaction.id,
        userId: interaction.user.id,
        username: interaction.user.username,
        channelId: interaction.channelId ?? "",
        guildId: interaction.guildId ?? "",
        messageId: interaction.message.id,
        values,
        value: values[0] ?? "",
    };
}

export interface ModalSubmitData {
    modalId: string;
    interactionId: string;
    userId: string;
    username: string;
    channelId: string;
    guildId: string;
    /** the message whose button opened the modal; empty for a slash command */
    messageId: string;
    field1: string;
    field2: string;
    field3: string;
    field4: string;
    field5: string;
}

export function modalSubmitPayload(interaction: ModalSubmitInteraction): ModalSubmitData {
    const answer = (index: number): string => {
        const field = interaction.fields.fields.get(modalFieldId(index)) as
            | { value?: unknown }
            | undefined;
        return typeof field?.value === "string" ? field.value : "";
    };
    return {
        modalId: interaction.customId,
        interactionId: interaction.id,
        userId: interaction.user.id,
        username: interaction.user.username,
        channelId: interaction.channelId ?? "",
        guildId: interaction.guildId ?? "",
        messageId: interaction.message?.id ?? "",
        field1: answer(0),
        field2: answer(1),
        field3: answer(2),
        field4: answer(3),
        field5: answer(4),
    };
}

// ─── servers and members ────────────────────────────────────────────────────

// Small bots usually serve one server; member actions then need no explicit
// Server ID. With several servers the id is required — never guess.
export async function resolveGuild(
    bot: Client,
    guildId?: string,
): Promise<Guild> {
    if (guildId && guildId.trim()) {
        return bot.guilds.fetch(guildId.trim());
    }
    const guilds = [...bot.guilds.cache.values()];
    if (guilds.length === 1) return guilds[0];
    throw new Error(
        "This bot is in more than one server; provide the Server ID",
    );
}

/** The most messages Get Recent Messages reads at once: one Discord page. */
export const MAX_RECENT_MESSAGES = 50;

export interface RecentChannelMessage {
    id: string;
    authorId: string;
    author: string;
    content: string;
    attachments: string[];
    sentAt: string;
}

export function clampMessageLimit(limit: unknown): number {
    const n = Number(limit);
    if (limit === undefined || limit === null || limit === "") return 20;
    if (!Number.isFinite(n) || n < 1) throw new Error(`Count is a number from 1 to ${MAX_RECENT_MESSAGES}`);
    return Math.min(Math.floor(n), MAX_RECENT_MESSAGES);
}

export interface FoundMember {
    userId: string;
    username: string;
    displayName: string;
    bot: boolean;
    guildId: string;
    guildName: string;
}

/** The most members Find Member returns. */
export const MAX_FOUND_MEMBERS = 25;

// Discord's member search matches the start of a username or nickname. Each
// server is one bounded gateway request; a person in several servers the bot
// shares is listed once, under the first.
export async function findMembers(bot: Client, query: string, guildId?: string): Promise<FoundMember[]> {
    const q = query.trim().replace(/^@/, "");
    if (!q) throw new Error("Say whose name to look for");
    const guilds = guildId && guildId.trim() ? [await bot.guilds.fetch(guildId.trim())] : [...bot.guilds.cache.values()];
    if (!guilds.length) throw new Error("This bot isn't in any server yet");
    const found = new Map<string, FoundMember>();
    for (const guild of guilds) {
        const members = await guild.members.fetch({ query: q, limit: MAX_FOUND_MEMBERS });
        for (const member of members.values()) {
            if (found.has(member.id)) continue;
            found.set(member.id, {
                userId: member.id,
                username: member.user.username,
                displayName: member.displayName,
                bot: member.user.bot,
                guildId: guild.id,
                guildName: guild.name,
            });
        }
        if (found.size >= MAX_FOUND_MEMBERS) break;
    }
    // an exact name first, so "pxlkt" doesn't lose to "pxlkt2"
    const exact = (m: FoundMember) => (m.username.toLowerCase() === q.toLowerCase() || m.displayName.toLowerCase() === q.toLowerCase() ? 0 : 1);
    return [...found.values()].sort((a, b) => exact(a) - exact(b)).slice(0, MAX_FOUND_MEMBERS);
}

// Server-resolved member fetch: with a Server ID it is one call; without,
// the bot's servers are searched in a bounded loop (guild count).
export async function resolveMember(
    bot: Client,
    userId: string,
    guildId?: string,
): Promise<GuildMember> {
    if (guildId && guildId.trim()) {
        const guild = await resolveGuild(bot, guildId);
        return guild.members.fetch(userId.trim());
    }
    const { RESTJSONErrorCodes } = await loadDiscord();
    for (const guild of bot.guilds.cache.values()) {
        try {
            return await guild.members.fetch(userId.trim());
        } catch (err) {
            // not a member of this server: the search goes on. Anything else
            // (a missing permission, a rate limit) is why it failed
            if ((err as { code?: unknown })?.code !== RESTJSONErrorCodes.UnknownMember) throw err;
        }
    }
    throw new Error(
        `User ${userId} is not a member of any server this bot is in`,
    );
}

// ─── message operations ─────────────────────────────────────────────────────

// Every message action routes through this class instead of re-fetching the
// channel and message inline: one place owns the typed "not text-based"
// errors and the fetch order.
export class MessageOps {
    constructor(private readonly bot: Client) {}

    async textChannel(channelId: string): Promise<any> {
        const channel = await this.bot.channels.fetch(channelId.trim());
        if (!channel || !("messages" in channel)) {
            throw new Error(`Channel ${channelId} not found or not text-based`);
        }
        return channel;
    }

    private async message(channelId: string, messageId: string): Promise<any> {
        const channel = await this.textChannel(channelId);
        return channel.messages.fetch(messageId.trim());
    }

    async send(channelId: string, payload: MessagePayloadInput): Promise<string> {
        return (await this.sendMessage(channelId, payload)).id;
    }

    /** Sends to a channel; the sent message, for a caller that needs more than its id. */
    async sendMessage(channelId: string, payload: MessagePayloadInput): Promise<any> {
        const channel = await this.textChannel(channelId);
        return channel.send(await buildMessagePayload(payload));
    }

    async reply(
        channelId: string,
        replyTo: string,
        payload: MessagePayloadInput,
    ): Promise<string> {
        return (await this.replyMessage(channelId, replyTo, payload)).id;
    }

    async replyMessage(
        channelId: string,
        replyTo: string,
        payload: MessagePayloadInput,
    ): Promise<any> {
        const channel = await this.textChannel(channelId);
        const target = await channel.messages.fetch(replyTo.trim());
        return target.reply(await buildMessagePayload(payload));
    }

    async edit(
        channelId: string,
        messageId: string,
        payload: MessagePayloadInput,
    ): Promise<string> {
        if (
            payload.content === undefined &&
            payload.embeds === undefined &&
            payload.components === undefined
        ) {
            throw new Error("Edit Message needs new content, embeds, or components");
        }
        const message = await this.message(channelId, messageId);
        const lib = await loadDiscord();
        const embeds = normalizeEmbeds(payload.embeds);
        const components = payload.components === undefined
            ? message.components
            : actionRows(lib, payload.components);
        await message.edit({
            content: payload.content ?? message.content,
            embeds: embeds.length > 0 ? embeds.map((data) => embedFrom(lib, data)) : message.embeds,
            ...(components.length > 0 ? { components } : {}),
        });
        return message.id;
    }

    /** The channel's latest messages, oldest first, each as plain fields. */
    async recent(channelId: string, limit: number): Promise<RecentChannelMessage[]> {
        const channel = await this.textChannel(channelId);
        const fetched = await channel.messages.fetch({ limit: clampMessageLimit(limit) });
        return [...fetched.values()]
            .map((message: any) => ({
                id: String(message.id),
                authorId: String(message.author?.id ?? ""),
                author: String(message.author?.username ?? ""),
                content: String(message.content ?? ""),
                attachments: [...(message.attachments?.values?.() ?? [])].map((a: any) => String(a.url)),
                sentAt: message.createdAt ? message.createdAt.toISOString() : "",
            }))
            .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    }

    async dm(userId: string, payload: MessagePayloadInput): Promise<string> {
        return (await this.dmMessage(userId, payload)).id;
    }

    async dmMessage(userId: string, payload: MessagePayloadInput): Promise<any> {
        const user = await this.bot.users.fetch(userId.trim());
        return user.send(await buildMessagePayload(payload));
    }

    async delete(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.delete();
        return true;
    }

    async pin(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.pin();
        return true;
    }

    async unpin(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.unpin();
        return true;
    }

    async crosspost(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.crosspost();
        return true;
    }

    async bulkDelete(channelId: string, count?: number): Promise<number> {
        const channel = await this.textChannel(channelId);
        if (!("bulkDelete" in channel)) {
            throw new Error(`Channel ${channelId} cannot bulk-delete messages`);
        }
        const capped = Math.max(1, Math.min(100, Math.floor(Number(count ?? 10))));
        const deleted = await channel.bulkDelete(capped);
        return deleted.size;
    }

    async react(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.react(emoji);
        return true;
    }

    async removeReaction(
        channelId: string,
        messageId: string,
        emoji: string,
        user?: string,
    ): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        const reaction =
            message.reactions.cache.get(emoji) ?? message.reactions.resolve(emoji);
        if (!reaction) {
            throw new Error(`Reaction ${emoji} not found on that message`);
        }
        if (user && user.trim()) {
            await reaction.users.remove(user.trim());
        } else {
            await reaction.remove();
        }
        return true;
    }

    async startThread(
        channelId: string,
        messageId: string,
        name: string,
    ): Promise<string> {
        const message = await this.message(channelId, messageId);
        const thread = await message.startThread({ name: name.trim() });
        return thread.id;
    }

    async fetchMessage(channelId: string, messageId: string): Promise<any> {
        return this.message(channelId, messageId);
    }

    async fetchChannel(channelId: string): Promise<any> {
        const channel = await this.bot.channels.fetch(channelId.trim());
        if (!channel) {
            throw new Error(`Channel ${channelId} not found`);
        }
        return channel;
    }
}

// ─── interaction responses ──────────────────────────────────────────────────

// Discord fails an interaction nobody answers within 3 seconds, so the bot
// acknowledges on the flow's behalf when it has not answered by this delay.
// Flows never need a Defer step: a later Respond or Follow Up still lands.
export const AUTO_ACK_DELAY_MS = 2_500;

// Every operation on one interaction runs in order, so the automatic
// acknowledgement and a flow's answer can never both claim the first
// response. Keyed weakly: a finished interaction is collected with its chain.
const interactionQueues = new WeakMap<object, Promise<unknown>>();

function serialize<T>(interaction: object, op: () => Promise<T>): Promise<T> {
    const previous = interactionQueues.get(interaction) ?? Promise.resolve();
    const next = previous.then(op, op);
    // the chain only orders work; this op's failure reaches its own caller
    // through `next`, so the next op still runs after a failed one
    interactionQueues.set(
        interaction,
        next.then(
            () => undefined,
            () => undefined,
        ),
    );
    return next;
}

// Interactions whose first response is not an editable reply: a click acked
// with an invisible update, or a deferral replaced to change visibility.
// Their answers arrive as new messages.
const answersAsNewMessage = new WeakSet<object>();
// A follow-up used as Respond's answer is edited through the webhook by id.
const answerMessageIds = new WeakMap<object, string>();

function acknowledgesWithUpdate(interaction: RepliableInteraction): boolean {
    if (interaction.isMessageComponent?.()) return true;
    return Boolean(interaction.isModalSubmit?.() && interaction.isFromMessage());
}

/**
 * The automatic acknowledgement. A button or select click (or a modal opened
 * from one) gets an invisible update ack, so a flow that answers nothing
 * leaves no trace; a slash command or modal gets "thinking…" that the flow's
 * Respond replaces. A no-op once anything answered.
 */
export function autoAcknowledge(interaction: RepliableInteraction): Promise<void> {
    return serialize(interaction, async () => {
        if (interaction.deferred || interaction.replied) return;
        if (acknowledgesWithUpdate(interaction)) {
            await (interaction as MessageComponentInteraction).deferUpdate();
            answersAsNewMessage.add(interaction);
        } else {
            await interaction.deferReply();
        }
    });
}

type MessageBody = Awaited<ReturnType<typeof buildMessagePayload>>;

// One class owns answering pending interactions: the reply / edit / new
// message decision, ephemeral flags, and the pending-map lookup live here,
// not in every responder action.
export class InteractionOps {
    constructor(
        private readonly take: (interactionId: string) => RepliableInteraction,
    ) {}

    // Answers in the one way Discord allows for the interaction's state:
    // the first answer is a reply; after "thinking…" it fills that message
    // in (or replaces it when the visibility asked for differs, since
    // Discord fixes visibility at defer time); after an update ack, or when
    // a new message was asked for, it is a follow-up message.
    private async deliver(
        interaction: RepliableInteraction,
        body: MessageBody,
        ephemeral: boolean,
        asNewMessage: boolean,
    ): Promise<{ messageId: () => Promise<string> }> {
        const answerId = answerMessageIds.get(interaction);
        if (!asNewMessage && answerId) {
            const edited = await interaction.webhook.editMessage(answerId, body);
            return { messageId: async () => edited.id };
        }
        const { MessageFlags } = await loadDiscord();
        const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ ...body, flags });
            return { messageId: async () => (await interaction.fetchReply()).id };
        }
        if (answersAsNewMessage.has(interaction) || (interaction.replied && asNewMessage)) {
            const sent = await interaction.followUp({ ...body, flags });
            if (!asNewMessage) answerMessageIds.set(interaction, sent.id);
            return { messageId: async () => sent.id };
        }
        if (!interaction.replied && Boolean(interaction.ephemeral) !== ephemeral) {
            await interaction.deleteReply();
            answersAsNewMessage.add(interaction);
            const sent = await interaction.followUp({ ...body, flags });
            if (!asNewMessage) answerMessageIds.set(interaction, sent.id);
            return { messageId: async () => sent.id };
        }
        const edited = await interaction.editReply(body);
        return { messageId: async () => edited.id };
    }

    /** The interaction's answer; responding again edits that answer. */
    async respond(
        interactionId: string,
        payload: { content?: string; embeds?: unknown; components?: unknown; ephemeral?: boolean },
    ): Promise<string> {
        const interaction = this.take(interactionId.trim());
        // queued before anything is awaited, so this answer keeps its place
        // ahead of whatever is asked of the interaction next
        return serialize(interaction, async () => {
            const body = await buildMessagePayload(payload);
            await this.deliver(interaction, body, Boolean(payload.ephemeral), false);
            return interaction.id;
        });
    }

    /** Another message after the answer (or the answer, if none was sent yet). */
    async followUp(
        interactionId: string,
        payload: { content?: string; embeds?: unknown; components?: unknown; ephemeral?: boolean },
    ): Promise<string> {
        const interaction = this.take(interactionId.trim());
        // queued before anything is awaited, so this answer keeps its place
        // ahead of whatever is asked of the interaction next
        return serialize(interaction, async () => {
            const body = await buildMessagePayload(payload);
            const sent = await this.deliver(interaction, body, Boolean(payload.ephemeral), true);
            return sent.messageId();
        });
    }

    /** A follow-up, with the channel it was sent in. */
    async followUpMessage(
        interactionId: string,
        payload: { content?: string; embeds?: unknown; components?: unknown; ephemeral?: boolean },
    ): Promise<{ id: string; channelId: string }> {
        const channelId = this.take(interactionId.trim()).channelId;
        if (!channelId) throw new Error(`Interaction ${interactionId} has no channel to follow up in`);
        return { id: await this.followUp(interactionId, payload), channelId };
    }

    /** Opens a modal; only possible as the very first answer. */
    async showModal(
        interactionId: string,
        modal: Awaited<ReturnType<typeof buildModalPayload>>,
    ): Promise<boolean> {
        const interaction = this.take(interactionId.trim()) as RepliableInteraction & {
            showModal?: (modal: unknown) => Promise<unknown>;
        };
        if (typeof interaction.showModal !== "function") {
            throw new Error(
                "A modal can only answer a slash command, a button, or a select menu — not another modal",
            );
        }
        return serialize(interaction, async () => {
            if (interaction.deferred || interaction.replied) {
                throw new Error(
                    "Show Modal must be the first answer to an interaction, within 2.5 seconds. Move it before any Respond or slow step.",
                );
            }
            await interaction.showModal!(modal);
            return true;
        });
    }
}

// ─── permissions, dates and member search ───────────────────────────────────

/** Discord permission names (SendMessages, ViewChannel, ...), each checked; a typo is refused, never dropped. */
export async function permissionNames(value: unknown): Promise<(keyof typeof PermissionsBitField.Flags)[]> {
    const names = listInput(value, true);
    const { PermissionsBitField } = await loadDiscord();
    const unknown = names.filter((n) => !(n in PermissionsBitField.Flags));
    if (unknown.length) throw new Error(`Unknown Discord permission(s): ${unknown.join(", ")}`);
    return names as (keyof typeof PermissionsBitField.Flags)[];
}

/** A moment from a timestamp in milliseconds or a date and time like 2026-11-02T18:00:00Z. */
export function parseMoment(value: unknown, what: string): Date {
    const date = typeof value === "number" ? new Date(value) : new Date(String(value ?? "").trim());
    if (value === undefined || value === "" || Number.isNaN(date.getTime())) {
        throw new Error(`${what} is a date and time like 2026-11-02T18:00:00Z, or a timestamp`);
    }
    return date;
}

/** How long Discord gets to send the members a search asks for; its own wait is two minutes, far past a person's. */
export const MEMBER_SEARCH_TIMEOUT_MS = 10_000;

/** One bounded page of members, asked of the gateway. A page that doesn't arrive says so; any other failure is Discord's own. */
export async function searchMembers(
    guild: { members: { fetch(options: { query?: string; limit: number; time: number }): Promise<{ values(): Iterable<any> }> } },
    query: string,
    limit: number,
    timeoutMs: number = MEMBER_SEARCH_TIMEOUT_MS,
) {
    try {
        // one bounded page; member search is a gateway request, never a full member download
        return await guild.members.fetch({ query: query || undefined, limit, time: timeoutMs });
    } catch (err) {
        // discord.js's code for a page that never came
        if ((err as { code?: unknown } | null)?.code !== "GuildMembersTimeout") throw err;
        throw new Error(`Discord didn't send the members within ${Math.round(timeoutMs / 1000)} seconds. The bot may have lost its connection to Discord; try again.`);
    }
}
