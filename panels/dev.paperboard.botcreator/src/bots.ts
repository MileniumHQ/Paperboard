// Bots: each one a Discord application with its own token, commands and
// Actions project, listed on the Bot Creator home screen. The panel config
// holds the list; each token is its own vault secret. Pure, so the service,
// the panel and their tests share one implementation.
import { normalizeCommandDefinitions, type SlashCommandDefinition } from "./types";

export const PANEL_ID = "dev.paperboard.botcreator";
export const BOTS_VERSION = 2;
/** more than this is not something one computer should run */
export const MAX_BOTS = 50;
/** the one vault token from before several bots; moved to its bot once */
export const LEGACY_TOKEN_NAME = "bot-token";

export interface StoredBot {
    /** stable, never shown; doubles as the bot's project id in the Actions API */
    id: string;
    /** the bot's Discord username, as of its last login */
    name: string;
    /** the bot's Discord avatar URL, as of its last login; empty for the default */
    avatar: string;
    applicationId: string;
    /** whether the bot goes online when Paperboard starts */
    enabled: boolean;
    commands: SlashCommandDefinition[];
    /** epoch ms */
    createdAt: number;
}

export interface BotsConfig {
    version: number;
    bots: StoredBot[];
    /**
     * The bot that was the only one before Bot Creator ran several. Flows
     * from then name its actions without a project; deprecated forwarders
     * keep them running against this bot.
     * TODO(remove after v0.5): with the forwarders.
     */
    legacyBot?: string;
}

/** What every window sees of a bot: its saved identity and its live state. */
export interface BotSummary {
    id: string;
    name: string;
    avatar: string;
    applicationId: string;
    enabled: boolean;
    connected: boolean;
    /** logging in to Discord, not connected yet */
    connecting: boolean;
    /** a token is in the vault; without one the bot can't connect */
    hasToken: boolean;
    lastError: string | null;
    guildCount: number;
    createdAt: number;
}

export interface BotsServiceState {
    bots: BotSummary[];
    /** why the saved bots could not be read; nothing is written over them meanwhile */
    botsError: string | null;
}

// the Actions API's project id rule (papercrane PROJECT_ID_PATTERN)
const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isBotId(id: unknown): id is string {
    return typeof id === "string" && BOT_ID.test(id);
}

export function createBotId(): string {
    return `b-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** The vault secret holding one bot's token. */
export function tokenName(botId: string): string {
    if (!isBotId(botId)) throw new Error(`"${botId}" is not a bot id`);
    return `bot-token.${botId}`;
}

/** Reads one stored bot, refusing anything that is not one. */
function readStoredBot(raw: any, index: number): StoredBot {
    if (!raw || typeof raw !== "object" || !isBotId(raw.id)) {
        throw new Error(`bot ${index + 1} in the saved list is damaged`);
    }
    return {
        id: raw.id,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Discord bot",
        avatar: typeof raw.avatar === "string" ? raw.avatar : "",
        applicationId: typeof raw.applicationId === "string" ? raw.applicationId : "",
        enabled: raw.enabled !== false,
        commands: normalizeCommandDefinitions(raw.commands),
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    };
}

/**
 * Reads the saved config. Nothing saved is no bots. A config from before
 * several bots (`configured`, `applicationId`, `commands`) comes back as
 * `legacy`, for the service to move into a bot; one written by a newer Bot
 * Creator, or that is not a bot list, is refused.
 */
export function readBotsConfig(saved: unknown):
    | { kind: "bots"; config: BotsConfig }
    | { kind: "legacy"; applicationId: string; commands: SlashCommandDefinition[] } {
    if (saved === null || saved === undefined) return { kind: "bots", config: { version: BOTS_VERSION, bots: [] } };
    if (typeof saved !== "object" || Array.isArray(saved)) throw new Error("the saved bots are damaged");
    const config = saved as Record<string, any>;
    if (config.bots === undefined) {
        if (config.configured === true) {
            return {
                kind: "legacy",
                applicationId: typeof config.applicationId === "string" ? config.applicationId : "",
                commands: normalizeCommandDefinitions(config.commands),
            };
        }
        // never set up, or reset before several bots: nothing to run
        return { kind: "bots", config: { version: BOTS_VERSION, bots: [] } };
    }
    if (typeof config.version === "number" && config.version > BOTS_VERSION) {
        throw new Error(`they were saved by a newer version of Bot Creator (bots version ${config.version}); update Bot Creator to open them`);
    }
    if (!Array.isArray(config.bots)) throw new Error("the saved bots are damaged");
    const seen = new Set<string>();
    const bots = config.bots.map((raw: unknown, i: number) => {
        const bot = readStoredBot(raw, i);
        if (seen.has(bot.id)) throw new Error(`bot ${i + 1} in the saved list is damaged`);
        seen.add(bot.id);
        return bot;
    });
    return {
        kind: "bots",
        config: {
            version: BOTS_VERSION,
            bots,
            ...(isBotId(config.legacyBot) && seen.has(config.legacyBot) ? { legacyBot: config.legacyBot } : {}),
        },
    };
}

/** Oldest first, the order bots were added in. */
export function byCreation(bots: readonly BotSummary[]): BotSummary[] {
    return [...bots].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
}
