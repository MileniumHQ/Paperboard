// The bots the service runs, and what every window is told of them. Each
// entry pairs a saved bot with its live session; the rest of the service
// (persistence, Blocks, commands, the bot flows, the calls) works on these.
import type { BlocksProjectHandle, ContractContext } from "@mileniumhq/paperapi";
import type { botCreatorContract } from "./contract";
import { isBotId, PANEL_ID, SETUP_GUIDE_FIELD, type BotSummary, type BotsServiceState, type StoredBot } from "./bots";
import type { BotSession } from "./session";
import { errorMessage, problemsApi } from "@mileniumhq/paperapi";

export interface BotEntry {
    stored: StoredBot;
    session: BotSession;
    hasToken: boolean;
    /** why the bot's blocks are not in Blocks, when they aren't */
    blocksError: string | null;
    /** the bot's Blocks project, once defined; null while it isn't */
    blocks: BlocksProjectHandle | null;
    /** tells Blocks which of the bot's values changed, once its project is registered */
    blocksChanged: (() => void) | null;
    /** online as of the last change Blocks heard of, for When a Bot Goes Online and Offline */
    online: boolean;
}

export const bots = new Map<string, BotEntry>();
// the applications of bots still logging in to be added: a second add of the same token is a twin
export const adding = new Set<string>();

export const panel = {
    // the config as read, so fields this version doesn't know are written back
    savedExtras: {} as Record<string, unknown>,
    // why the saved bots couldn't be read; nothing is written over them meanwhile
    botsError: null as string | null,
    ctx: null as ContractContext<typeof botCreatorContract> | null,
};

export function summary(entry: BotEntry): BotSummary {
    const { stored, session } = entry;
    const connected = session.connected();
    return {
        id: stored.id,
        name: stored.name,
        avatar: stored.avatar,
        applicationId: stored.applicationId,
        enabled: stored.enabled,
        connected,
        connecting: session.connecting(),
        hasToken: entry.hasToken,
        lastError: entry.blocksError ?? session.status().error ?? null,
        guildCount: connected ? session.client?.guilds?.cache?.size ?? 0 : 0,
        guilds: connected ? session.guildSummaries() : [],
        createdAt: stored.createdAt,
        commands: stored.commands,
        commandSyncError: session.syncError(),
    };
}

// the setup guide is for someone with no bots yet: a computer that already
// has one has been through it
function setupGuideSeen(): boolean {
    return panel.savedExtras[SETUP_GUIDE_FIELD] === true || bots.size > 0;
}

// what every window was last told: an announcement that changes nothing
// (a member joins a server the windows show no count for) is not sent
let published = "";

export function publish(): void {
    const state: BotsServiceState = { bots: [...bots.values()].map(summary), botsError: panel.botsError, setupGuideSeen: setupGuideSeen() };
    const next = JSON.stringify(state);
    if (!panel.ctx || next === published) return;
    published = next;
    panel.ctx.setState(state);
}

export function requireReadable(): void {
    if (panel.botsError) throw new Error(`Bot Creator couldn't read its saved bots, so nothing is changed: ${panel.botsError}`);
}

export function requireBot(id: unknown): BotEntry {
    const entry = typeof id === "string" ? bots.get(id) : undefined;
    if (!entry) throw new Error(isBotId(id) ? "This bot was deleted from Bot Creator." : "A bot id is required.");
    return entry;
}

/** The bot's Discord user id: its application's, as of the live session or the last login. */
export function appIdOf(entry: BotEntry): string {
    return entry.session.client?.user?.id || entry.stored.applicationId;
}

/** A failure whose caller hears it too: the log keeps the details. */
export function logFailure(what: string) {
    return (err: unknown) => console.error(`[DiscordService] ${what}:`, errorMessage(err));
}

/** A failure no button waits for, told to the person as the panel's problem: `what` is a sentence such as "Saving the bots failed". */
export function reportFailure(what: string) {
    return (err: unknown) => problemsApi.report(PANEL_ID, { key: what, title: what, message: errorMessage(err) });
}

/** Something that went wrong with a bot, no button waiting: a sentence about it, under its name. */
export function reportBotProblem(entry: BotEntry, text: string): void {
    problemsApi.report(PANEL_ID, { key: `${entry.stored.id}:${text.slice(0, 160)}`, title: entry.stored.name, message: text });
}
