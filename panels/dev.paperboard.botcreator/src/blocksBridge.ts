// What a bot's session tells Blocks and every window: its events, as its own
// project's events and the panel's (When a Bot Goes Online), its identity,
// and the project its blocks are registered into.
import type { Client } from "discord.js";
import { blocksApi, errorMessage } from "@mileniumhq/paperapi";
import { InteractionOps } from "./discordOps";
import { botBlocks, valueChanges, type BotBlocksHost } from "./blocks/bot";
import { blockEvent, commandEvent, staticEvents } from "./blocks/events";
import { botStatus, panelBlocks, type BotsBlocksHost } from "./blocks/bots";
import { PANEL_ID, type StoredBot } from "./bots";
import { BotSession } from "./session";
import { appIdOf, bots, logFailure, panel, publish, summary, type BotEntry } from "./registry";
import { saveBots } from "./persistence";

// why the panel's Blocks types and builders couldn't be registered; no bot's blocks can be then
let panelBlocksError: string | null = null;
// the panel's own blocks are registered, so its events can fire
let panelBlocksReady = false;
// the panel's own events by id, as a flow names them
let panelEventNames = new Map<string, string>();

/** Registers the panel's own types, builders and bot blocks; every bot's blocks use them. */
export async function registerPanelBlocks(host: BotsBlocksHost): Promise<void> {
    try {
        const own = panelBlocks(connectedClients, host);
        await blocksApi.panel(PANEL_ID).register(own);
        panelEventNames = new Map((own.events ?? []).map((e) => [e.id, e.name]));
        panelBlocksReady = true;
    } catch (err) {
        panelBlocksError = errorMessage(err);
        console.error("[DiscordService] registering the Blocks types failed:", panelBlocksError);
    }
}

function sessionHost(id: string, entry: () => BotEntry) {
    return {
        emit(trigger: string, output: unknown) {
            // a bot's Overview shows its messages live
            if (trigger === "on-message") panel.ctx?.emit("message", { bot: id, ...(output as object) });
            void fireBlocksEvent(entry(), trigger, output);
            if (trigger === "on-connection-error" && bots.has(id)) {
                firePanelEvent("bot-connection-failed", { bot: id, error: String((output as { error?: unknown } | null)?.error ?? "") });
            }
        },
        changed() {
            const known = bots.get(id);
            if (known) noteIdentity(known);
            publish();
            entry().blocksChanged?.();
            if (known) noteOnline(known);
        },
    };
}

/**
 * One of the panel's own Blocks events, once the panel's blocks are
 * registered. One that fails is in the bot's Overview while the bot is there.
 */
export function firePanelEvent(event: string, payload: Record<string, unknown>): void {
    if (!panelBlocksReady) return;
    blocksApi.panel(PANEL_ID).fire(event, payload).catch((err) => {
        const entry = typeof payload.bot === "string" ? bots.get(payload.bot) : undefined;
        const name = panelEventNames.get(event) ?? event;
        if (entry) entry.session.noteProblem(`${name} didn't run: ${errorMessage(err)}`);
        else logFailure(`${name} didn't run`)(err);
    });
}

/** Tells Blocks the list of bots changed. */
export function botsChanged(): void {
    if (!panelBlocksReady) return;
    blocksApi.panel(PANEL_ID).changed("bots").catch(logFailure("the change to the bot list did not reach Blocks"));
}

/** Fires When a Bot Goes Online or Offline, when the bot did since Blocks last heard. */
export function noteOnline(entry: BotEntry): void {
    const online = entry.session.connected();
    if (online === entry.online) return;
    entry.online = online;
    if (online) firePanelEvent("bot-online", { bot: entry.stored.id });
    else firePanelEvent("bot-offline", { bot: entry.stored.id, error: entry.session.status().error ?? null });
}

/** The trigger as the bot's Blocks event, once the bot's blocks are registered; one that fails is in its Overview. */
async function fireBlocksEvent(entry: BotEntry, trigger: string, output: unknown): Promise<void> {
    if (!entry.blocks) return;
    let event = trigger;
    try {
        const fired = blockEvent(trigger, output, entry.stored.commands);
        event = fired.event;
        await entry.blocks.fire(fired.event, fired.payload);
    } catch (err) {
        const name = [...staticEvents, ...entry.stored.commands.map(commandEvent)].find((e) => e.id === event)?.name ?? event;
        entry.session.noteProblem(`${name} didn't run: ${errorMessage(err)}`);
    }
}

// the bot's name and avatar are Discord's: kept as of the last login, so the
// home screen and Blocks name an offline bot the way it was last seen
export function noteIdentity(entry: BotEntry): void {
    const user = entry.session.client?.user;
    if (!user) return;
    const name = user.username;
    const avatar = user.displayAvatarURL();
    if (name === entry.stored.name && avatar === entry.stored.avatar && user.id === entry.stored.applicationId) return;
    const renamed = name !== entry.stored.name;
    entry.stored = { ...entry.stored, name, avatar, applicationId: user.id };
    saveBots().catch((err) => entry.session.noteProblem(`Its new name and picture weren't saved: ${errorMessage(err)}`));
    if (renamed && entry.blocks) {
        entry.blocks.update({ name, icon: "smart_toy" }).catch((err) => entry.session.noteProblem(`Its Blocks project wasn't renamed to ${name}: ${errorMessage(err)}`));
    }
}

export function createEntry(stored: StoredBot, hasToken: boolean): BotEntry {
    // the session's host reaches the entry it belongs to, made just below
    let entry: BotEntry | null = null;
    const session = new BotSession(stored.id, sessionHost(stored.id, () => entry!));
    session.applicationId = stored.applicationId;
    session.commands = stored.commands;
    entry = { stored, session, hasToken, blocksError: null, blocks: null, blocksChanged: null, online: false };
    return entry;
}

/** What a bot's blocks run against: its live session. */
function blocksHost(entry: BotEntry): BotBlocksHost {
    return {
        client: () => entry.session.requireClient(),
        interactions: () => new InteractionOps((id) => entry.session.takeInteraction(id)),
        connected: () => entry.session.connected(),
        userId: () => {
            const id = appIdOf(entry);
            if (!id) throw new Error("This bot's Discord user isn't known yet. Turn it on in Bot Creator.");
            return id;
        },
        status: () => botStatus(summary(entry)),
        uptime: () => entry.session.health().uptimeMs,
        commands: () => entry.stored.commands,
        activity: () => entry.session.activity.snapshot(),
        commandUses: (command) => entry.session.commandUses.get(command),
    };
}

/** The bots connected now, whose clients a Blocks type's fields look things up with. */
function connectedClients(bot?: string): Client[] {
    const entries = bot === undefined ? [...bots.values()] : [bots.get(bot)].filter((e): e is BotEntry => e !== undefined);
    return entries.flatMap((entry) => (entry.session.connected() && entry.session.client ? [entry.session.client] : []));
}

/** Defines the bot's Blocks project and registers its commands, values and events into it. */
export async function registerBlocks(entry: BotEntry): Promise<void> {
    if (panelBlocksError) throw new Error(`Bot Creator's types aren't in Blocks: ${panelBlocksError}`);
    const blocks = await blocksApi.defineProject({ id: entry.stored.id, name: entry.stored.name, icon: "smart_toy" }, PANEL_ID);
    entry.blocks = blocks;
    await blocks.register(botBlocks(blocksHost(entry)));
    if (entry.stored.commands.length) await blocks.register({ events: entry.stored.commands.map(commandEvent) });
    entry.blocksChanged = valueChanges(blocks, blocksHost(entry), (text) => entry.session.noteProblem(text));
    entry.blocksError = null;
}
