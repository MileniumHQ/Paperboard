// Bot Creator's service: every bot the panel runs, each with its own
// session and its own Blocks project. A bot's
// Discord blocks and events live in its project ("<bot>/command.send-message"), so
// two bots share nothing in a flow; the builders that never touch Discord
// (embeds, buttons, menus) are global. The panel's own controls reach the
// service through calls that name the bot.
import type { Client } from "discord.js";
import { loadDiscord } from "./discord";
import { InteractionOps, MessageOps, permissionNames } from "./discordOps";
import {
    definePanelService,
    secretsApi,
    blocksApi,
    config,
    type BlocksProjectHandle,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import {
    blockEvent,
    botBlocks,
    botStatus,
    commandEvent,
    commandEventId,
    panelBlocks,
    valueChanges,
    type BotBlocksHost,
    type BotsBlocksHost,
} from "./blocks";
import { randomUUID } from "node:crypto";
import {
    DEFAULT_SELECTED_PERMISSIONS,
    extractApplicationIdFromToken,
    GLOBAL_SCOPE,
    MAX_COMMANDS_PER_SCOPE,
    MAX_COMMAND_OPTIONS,
    SNOWFLAKE_PATTERN,
    MEMBER_SEARCH_LIMIT,
    describeCommandProblem,
    describeCommandOptionProblem,
    normalizeCommandName,
    errorToMessage,
    type SlashCommandDefinition,
    type SlashCommandOption,
    type CommandOptionType,
    type CommandMutationResult,
} from "./types";
import {
    BOTS_VERSION,
    LEGACY_TOKEN_NAME,
    MAX_BOTS,
    PANEL_ID,
    byCreation,
    createBotId,
    isBotId,
    readBotsConfig,
    tokenName,
    type BotSummary,
    type BotsServiceState,
    type StoredBot,
} from "./bots";
import {
    BotSession,
    buildGuildDetail,
    buildMemberSummaries,
} from "./session";

export {
    PRESENCE_STATUSES,
    validatePresenceStatus,
    channelPermissionChanges,
    scheduledEventOptions,
    type PresenceStatus,
} from "./botOps";

export {
    BotSession,
    buildGuildDetail,
    buildMemberSummaries,
    commandPayload,
    describeChannelKind,
    syncSlashCommands,
} from "./session";

export async function buildInviteUrl(appId: string, permissions: string[]): Promise<string> {
    if (!appId) {
        throw new Error("Cannot build an invite URL: no application ID is known.");
    }
    // typo'd permission names must fail loud, never silently vanish
    const names = await permissionNames(permissions);
    const { PermissionsBitField } = await loadDiscord();
    const bitfield = new PermissionsBitField(names);
    // applications.commands is requested because the panel now registers
    // slash commands (see syncSlashCommands); an invite without it produces
    // a bot that registers commands it can never receive interactions for
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${bitfield.bitfield.toString()}`;
}

// User installs carry no bot permissions: the link authorizes
// applications.commands for the user's own account. It only works once
// User Install is enabled for the app in the Discord developer portal.
export function buildUserInstallUrl(appId: string): string {
    if (!appId) {
        throw new Error("Cannot build a user-install URL: no application ID is known.");
    }
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`;
}

// ---------------------------------------------------------------------------
// the bots
// ---------------------------------------------------------------------------

interface BotEntry {
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

const bots = new Map<string, BotEntry>();
// the config as read, so fields this version doesn't know are written back
let savedExtras: Record<string, unknown> = {};
// why the saved bots couldn't be read; nothing is written over them meanwhile
let botsError: string | null = null;
// why the panel's Blocks types and builders couldn't be registered; no bot's blocks can be then
let panelBlocksError: string | null = null;
// the panel's own blocks are registered, so its events can fire
let panelBlocksReady = false;
let serviceCtx: ServiceContext<BotsServiceState> | null = null;

function summary(entry: BotEntry): BotSummary {
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
        createdAt: stored.createdAt,
    };
}

function publish(): void {
    serviceCtx?.setState({ bots: [...bots.values()].map(summary), botsError });
}

function requireReadable(): void {
    if (botsError) throw new Error(`Bot Creator couldn't read its saved bots, so nothing is changed: ${botsError}`);
}

function requireBot(id: unknown): BotEntry {
    const entry = typeof id === "string" ? bots.get(id) : undefined;
    if (!entry) throw new Error(isBotId(id) ? "This bot was deleted from Bot Creator." : "A bot id is required.");
    return entry;
}

// writes run one after another, each saving the list as it is then, so an
// older write never lands after a newer one
let writing: Promise<void> = Promise.resolve();

function saveBots(): Promise<void> {
    const write = writing.then(async () => {
        const document = {
            ...savedExtras,
            version: BOTS_VERSION,
            bots: [...bots.values()].map((entry) => entry.stored),
        };
        try {
            await config.set(document, PANEL_ID);
        } catch (err) {
            throw new Error(`Could not save the bots: ${errorToMessage(err)}`);
        }
    });
    // the caller hears of a failed write; the chain moves on to the next
    writing = write.catch(logFailure("saving the bots failed"));
    return write;
}

function logFailure(what: string) {
    return (err: unknown) => console.error(`[DiscordService] ${what}:`, errorToMessage(err));
}

function sessionHost(id: string, entry: () => BotEntry) {
    return {
        emit(trigger: string, output: unknown) {
            // a bot's Overview shows its messages live
            if (trigger === "on-message") serviceCtx?.emit("message", { bot: id, ...(output as object) });
            fireBlocksEvent(entry(), trigger, output).catch(logFailure(`Blocks event ${id}/${trigger} failed`));
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

/** One of the panel's own Blocks events, once the panel's blocks are registered. */
function firePanelEvent(event: string, payload: Record<string, unknown>): void {
    if (!panelBlocksReady) return;
    blocksApi.panel(PANEL_ID).fire(event, payload).catch(logFailure(`Blocks event ${event} failed`));
}

/** Tells Blocks the list of bots changed. */
function botsChanged(): void {
    if (!panelBlocksReady) return;
    blocksApi.panel(PANEL_ID).changed("bots").catch(logFailure("the change to the bot list did not reach Blocks"));
}

/** Fires When a Bot Goes Online or Offline, when the bot did since Blocks last heard. */
function noteOnline(entry: BotEntry): void {
    const online = entry.session.connected();
    if (online === entry.online) return;
    entry.online = online;
    if (online) firePanelEvent("bot-online", { bot: entry.stored.id });
    else firePanelEvent("bot-offline", { bot: entry.stored.id, error: entry.session.status().error ?? null });
}

/** The trigger as the bot's Blocks event, once the bot's blocks are registered. */
async function fireBlocksEvent(entry: BotEntry, trigger: string, output: unknown): Promise<void> {
    if (!entry.blocks) return;
    const { event, payload } = blockEvent(trigger, output, entry.stored.commands);
    await entry.blocks.fire(event, payload);
}

// the bot's name and avatar are Discord's: kept as of the last login, so the
// home screen and Blocks name an offline bot the way it was last seen
function noteIdentity(entry: BotEntry): void {
    const user = entry.session.client?.user;
    if (!user) return;
    const name = user.username;
    const avatar = user.displayAvatarURL();
    if (name === entry.stored.name && avatar === entry.stored.avatar && user.id === entry.stored.applicationId) return;
    const renamed = name !== entry.stored.name;
    entry.stored = { ...entry.stored, name, avatar, applicationId: user.id };
    saveBots().catch(logFailure(`saving ${name}'s identity failed`));
    if (renamed && entry.blocks) {
        entry.blocks.update({ name, icon: "smart_toy" }).catch(logFailure(`renaming ${name}'s Blocks project failed`));
    }
}

function createEntry(stored: StoredBot, hasToken: boolean): BotEntry {
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
            const id = entry.session.client?.user?.id || entry.stored.applicationId;
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
async function registerBlocks(entry: BotEntry): Promise<void> {
    if (panelBlocksError) throw new Error(`Bot Creator's types aren't in Blocks: ${panelBlocksError}`);
    const blocks = await blocksApi.defineProject({ id: entry.stored.id, name: entry.stored.name, icon: "smart_toy" }, PANEL_ID);
    entry.blocks = blocks;
    await blocks.register(botBlocks(blocksHost(entry)));
    if (entry.stored.commands.length) await blocks.register({ events: entry.stored.commands.map(commandEvent) });
    entry.blocksChanged = valueChanges(blocks, blocksHost(entry), entry.stored.name);
    entry.blocksError = null;
}

async function readToken(id: string): Promise<string | null> {
    const stored = await secretsApi.get(tokenName(id), PANEL_ID);
    return stored.found && stored.value ? stored.value : null;
}

/** Connects a saved bot with its vault token; the reason it can't is the bot's error. */
async function connect(entry: BotEntry): Promise<void> {
    const token = await readToken(entry.stored.id);
    entry.hasToken = Boolean(token);
    if (!token) {
        const message = "No token is saved for this bot. Replace its token in Configuration.";
        entry.session.fail(message);
        throw new Error(message);
    }
    await entry.session.start(token);
}

async function setEnabled(entry: BotEntry, enabled: boolean): Promise<void> {
    if (entry.stored.enabled !== enabled) {
        entry.stored = { ...entry.stored, enabled };
        await saveBots();
        publish();
    }
    if (enabled) await connect(entry);
    else await entry.session.stop();
}

// The one bot from before several bots becomes the first of them: its
// token moves to its own vault name, its commands come along, and flows
// that used it keep running through the deprecated forwarders.
async function migrateLegacyBot(saved: Record<string, unknown>, legacy: { applicationId: string; commands: SlashCommandDefinition[] }): Promise<void> {
    const old = await secretsApi.get(LEGACY_TOKEN_NAME, PANEL_ID);
    const token = old.found && old.value ? old.value : null;
    const id = createBotId();
    if (token) await secretsApi.set(tokenName(id), token, PANEL_ID);
    const { configured: _configured, applicationId: _applicationId, commands: _commands, ...extras } = saved;
    savedExtras = extras;
    const stored: StoredBot = {
        id,
        name: "Discord bot",
        avatar: "",
        applicationId: legacy.applicationId || (token ? extractApplicationIdFromToken(token) ?? "" : ""),
        enabled: true,
        commands: legacy.commands,
        createdAt: Date.now(),
    };
    bots.set(id, createEntry(stored, Boolean(token)));
    await saveBots();
    if (token) await secretsApi.delete(LEGACY_TOKEN_NAME, PANEL_ID);
    console.log(`[DiscordService] moved the bot from before several bots into ${id}`);
}

async function loadBots(): Promise<void> {
    const saved = await config.get<unknown>(PANEL_ID);
    const read = readBotsConfig(saved);
    if (read.kind === "legacy") {
        await migrateLegacyBot(saved as Record<string, unknown>, read);
        return;
    }
    // legacyBot named the bot the old action forwarders ran against; it is dropped from the saved config
    const { bots: _bots, version: _version, legacyBot: _legacyBot, ...extras } = (saved ?? {}) as Record<string, unknown>;
    savedExtras = extras;
    for (const stored of read.config.bots) bots.set(stored.id, createEntry(stored, false));
}

// a bot's blocks, then its connection: one bot failing never holds back another
/** Adds a saved bot's blocks to Blocks. The daemon is local, so this is quick, and it's done before the service is
 * ready: a flow that runs at startup finds the bot's blocks registered. */
async function registerEntry(entry: BotEntry): Promise<void> {
    try {
        await registerBlocks(entry);
    } catch (err) {
        entry.blocksError = `Its blocks couldn't be added to Blocks: ${errorToMessage(err)}`;
        console.error(`[DiscordService] ${entry.stored.name}:`, entry.blocksError);
    }
}

/** Logs a saved bot in to Discord, which can stall on a rate limit, so it runs after the service is ready. */
async function connectEntry(entry: BotEntry): Promise<void> {
    try {
        entry.hasToken = Boolean(await readToken(entry.stored.id));
        if (!entry.hasToken) entry.session.fail("No token is saved for this bot. Replace its token in Configuration.");
        else if (entry.stored.enabled) await connect(entry);
    } catch (err) {
        // the reason is the bot's error, on its card and in its Overview
        console.error(`[DiscordService] ${entry.stored.name} didn't connect:`, errorToMessage(err));
    }
    publish();
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async function setCommands(entry: BotEntry, commands: SlashCommandDefinition[]): Promise<void> {
    const before = entry.stored;
    entry.stored = { ...entry.stored, commands };
    try {
        await saveBots();
    } catch (err) {
        entry.stored = before;
        throw err;
    }
    entry.session.commands = commands;
}

// one event action per command: registering is part of creating the
// command, so a command whose event action is missing is reported, never
// quietly half-created
async function registerCommandTrigger(entry: BotEntry, command: SlashCommandDefinition): Promise<string | null> {
    try {
        if (!entry.blocks) throw new Error(entry.blocksError ?? "the bot's project is not in Blocks");
        await entry.blocks.register({ events: [commandEvent(command)] });
        return null;
    } catch (err) {
        console.error(`[DiscordService] event action registration failed for /${command.name}:`, err);
        return `Could not register the trigger for /${command.name}: ${errorToMessage(err)}`;
    }
}

async function unregisterCommandTrigger(entry: BotEntry, command: SlashCommandDefinition): Promise<string | null> {
    try {
        if (entry.blocks) await entry.blocks.unregister("event", commandEventId(command));
        return null;
    } catch (err) {
        console.error(`[DiscordService] event action removal failed for /${command.name}:`, err);
        return `Could not remove the trigger for /${command.name}: ${errorToMessage(err)}`;
    }
}

/** Stores a command, registers its event in the bot's project, and tells Discord. */
async function createCommand(entry: BotEntry, input: any): Promise<CommandMutationResult> {
    requireReadable();
    const name = typeof input?.name === "string" ? normalizeCommandName(input.name) : "";
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    const scope = typeof input?.scope === "string" && input.scope.trim() ? input.scope.trim() : GLOBAL_SCOPE;
    const userInstall = Boolean(input?.userInstall);
    const problem = describeCommandProblem({ name, description });
    if (problem) throw new Error(problem);
    if (scope !== GLOBAL_SCOPE && !SNOWFLAKE_PATTERN.test(scope)) {
        throw new Error(`Unknown command scope "${scope}".`);
    }
    if (userInstall && scope !== GLOBAL_SCOPE) {
        throw new Error(
            "User apps are only available for global commands: Discord ignores installation contexts on server-scoped commands.",
        );
    }
    const options = parseCommandOptions(input?.options);

    const commands = entry.stored.commands;
    if (commands.some((c) => c.scope === scope && c.name === name)) {
        throw new Error(`A command named /${name} already exists in this scope.`);
    }
    if (commands.filter((c) => c.scope === scope).length >= MAX_COMMANDS_PER_SCOPE) {
        throw new Error(`Discord allows at most ${MAX_COMMANDS_PER_SCOPE} commands per scope.`);
    }

    const definition: SlashCommandDefinition = { id: randomUUID(), name, description, scope, options, userInstall };
    await setCommands(entry, [...commands, definition]);
    const triggerError = await registerCommandTrigger(entry, definition);
    const sync = await entry.session.syncAfterMutation();
    return { command: definition, ...sync, triggerError };
}

/** Removes a stored command, its event, and its Discord definition. */
async function deleteCommand(entry: BotEntry, rawId: unknown): Promise<CommandMutationResult> {
    requireReadable();
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) throw new Error("A command id is required.");
    const target = entry.stored.commands.find((c) => c.id === id);
    if (!target) throw new Error(`No command with id ${id} is stored.`);
    const next = entry.stored.commands.filter((c) => c.id !== id);
    // a scope with no commands left cannot be inferred from the list, so it
    // is explicitly cleared on Discord
    const scopesToClear = next.some((c) => c.scope === target.scope) ? [] : [target.scope];
    await setCommands(entry, next);
    const triggerError = await unregisterCommandTrigger(entry, target);
    const sync = await entry.session.syncAfterMutation(scopesToClear);
    return { command: target, ...sync, triggerError };
}

// ---------------------------------------------------------------------------
// the panel's own controls
// ---------------------------------------------------------------------------

function parseCommandOptions(raw: unknown): SlashCommandOption[] {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_COMMAND_OPTIONS) {
        throw new Error(
            `Discord allows at most ${MAX_COMMAND_OPTIONS} parameters per command.`,
        );
    }
    const candidates = list.map((option: any) => ({
        id:
            typeof option?.id === "string" && option.id
                ? option.id
                : randomUUID(),
        name:
            typeof option?.name === "string"
                ? normalizeCommandName(option.name)
                : "",
        description:
            typeof option?.description === "string"
                ? option.description.trim()
                : "",
        type: typeof option?.type === "string" ? option.type : "",
        required: Boolean(option?.required),
    }));
    for (let index = 0; index < candidates.length; index++) {
        const problem = describeCommandOptionProblem(
            candidates[index],
            candidates,
            index,
        );
        if (problem) {
            throw new Error(`Parameter ${index + 1}: ${problem}`);
        }
    }
    return candidates.map((candidate) => ({
        ...candidate,
        type: candidate.type as CommandOptionType,
    }));
}

/**
 * Adds a bot whose token the panel saved in the vault under its id, once it
 * logs in. A bot that doesn't log in is forgotten, token and all.
 */
async function addBot(id: unknown): Promise<BotSummary> {
    requireReadable();
    if (!isBotId(id)) throw new Error("A bot id is required.");
    if (bots.has(id)) throw new Error("This bot is already added.");
    if (bots.size >= MAX_BOTS) throw new Error(`Bot Creator runs at most ${MAX_BOTS} bots.`);
    const saved = await readToken(id);
    if (!saved) throw new Error("No token was saved for the new bot.");
    const forget = () => secretsApi.delete(tokenName(id), PANEL_ID).catch(logFailure("forgetting the refused token failed"));
    const applicationId = extractApplicationIdFromToken(saved);
    if (!applicationId) {
        await forget();
        throw new Error("That isn't a Discord bot token.");
    }
    const twin = [...bots.values()].find((entry) => entry.stored.applicationId === applicationId);
    if (twin) {
        await forget();
        throw new Error(`${twin.stored.name} already uses this bot. One bot can only run once.`);
    }
    const entry = createEntry({
        id,
        name: "Discord bot",
        avatar: "",
        applicationId,
        enabled: true,
        commands: [],
        createdAt: Date.now(),
    }, true);
    // the project first, so the bot's first events have somewhere to go
    try {
        await registerBlocks(entry);
        await entry.session.start(saved);
        bots.set(id, entry);
        noteIdentity(entry);
        await saveBots();
    } catch (err) {
        bots.delete(id);
        await entry.session.stop();
        if (entry.blocks) await entry.blocks.remove().catch(logFailure("removing the refused bot's Blocks project failed"));
        await forget();
        throw err;
    }
    publish();
    botsChanged();
    firePanelEvent("bot-added", { bot: id });
    noteOnline(entry);
    return summary(entry);
}

/** Reconnects a bot that's on with the new token the panel saved in the vault. */
async function replaceToken(entry: BotEntry): Promise<void> {
    requireReadable();
    const saved = await readToken(entry.stored.id);
    if (!saved) throw new Error("No token was saved for this bot.");
    entry.hasToken = true;
    if (entry.stored.enabled) await connect(entry);
    else publish();
}

/** Stops a bot and removes it, its token, its commands, and its Blocks project; gives its id. */
async function deleteBot(entry: BotEntry): Promise<string> {
    requireReadable();
    const id = entry.stored.id;
    // each step lands before the next, so a retry picks up where a
    // failed one stopped
    let step = "stop the bot";
    try {
        await entry.session.stop();
        step = "remove its blocks from Blocks";
        if (entry.blocks) {
            await entry.blocks.remove();
            entry.blocks = null;
            entry.blocksChanged = null;
        }
        step = "delete its token";
        await secretsApi.delete(tokenName(id), PANEL_ID);
        step = "save the bot list";
        bots.delete(id);
        try {
            await saveBots();
        } catch (err) {
            bots.set(id, entry);
            throw err;
        }
    } catch (err) {
        publish();
        throw new Error(`Couldn't ${step}: ${errorToMessage(err)}`);
    }
    publish();
    botsChanged();
    firePanelEvent("bot-deleted", { name: entry.stored.name });
    return id;
}

// a widget with no bot chosen can't say which one to show
function widgetBot(id: unknown): BotEntry {
    if (id === undefined || id === "") throw new Error("No bot is chosen for this widget. Remove it and add it again to pick one.");
    return requireBot(id);
}

function requireGuild(entry: BotEntry, guildId: unknown) {
    const id = typeof guildId === "string" ? guildId.trim() : "";
    if (!id) throw new Error("A guild id is required.");
    const guild = entry.session.requireClient().guilds.cache.get(id);
    if (!guild) throw new Error(`Guild ${id} is not available to this bot.`);
    return guild;
}

/**
 * What the panel's own page and widgets ask the service (serviceApi.call). Each takes the bot's id in its input, and
 * none of them is a block: what a person automates is in blocks.ts.
 */
export const serviceCalls = {
    /** Identity and recent messages, for a bot's Overview. */
    getBotInfo: (_ctx: unknown, input: any) => requireBot(input?.bot).session.info(),

    /** Identity, connection and server count, for the home widget. */
    getWidgetStatus: (_ctx: unknown, input: any) => {
        const entry = widgetBot(input?.bot);
        return entry.session.widgetStatus(entry.hasToken, entry.stored);
    },

    /** Slash commands run per hour over the last day, for the home widget. */
    getCommandActivity: (_ctx: unknown, input: any) => widgetBot(input?.bot).session.activity.snapshot(),

    /** The invite URL for the chosen permissions. */
    getInviteUrl: (_ctx: unknown, input: any) => {
        const entry = requireBot(input?.bot);
        const permissions = Array.isArray(input?.permissions) ? input.permissions : [];
        return buildInviteUrl(entry.session.client?.user?.id || entry.stored.applicationId, permissions);
    },

    /** The account-install URL for user-app commands. */
    getUserInstallUrl: (_ctx: unknown, input: any) => {
        const entry = requireBot(input?.bot);
        return buildUserInstallUrl(entry.session.client?.user?.id || entry.stored.applicationId);
    },

    /** Adds a bot whose token the page saved in the vault under the bot's id, once it logs in. */
    addBot: (_ctx: unknown, input: any): Promise<BotSummary> => addBot(input?.bot),

    /** Turns a bot on with its vault token. Never accepts a token over the wire. */
    connectBot: async (_ctx: unknown, input: any) => {
        requireReadable();
        await setEnabled(widgetBot(input?.bot), true);
        return true;
    },

    /** Turns a bot off. */
    disconnectBot: async (_ctx: unknown, input: any) => {
        requireReadable();
        await setEnabled(requireBot(input?.bot), false);
        return true;
    },

    /** The page saved a new token for the same bot in the vault; reconnects with it when the bot is on. */
    replaceToken: async (_ctx: unknown, input: any) => {
        await replaceToken(requireBot(input?.bot));
        return true;
    },

    /** Stops a bot and removes it, its token, its commands and its Blocks project. */
    deleteBot: async (_ctx: unknown, input: any) => ({ deleted: await deleteBot(requireBot(input?.bot)) }),

    /** Gateway, cache and memory health. */
    getHealth: (_ctx: unknown, input: any) => requireBot(input?.bot).session.health(),

    /** Server summaries from the client cache. */
    listGuilds: (_ctx: unknown, input: any) => requireBot(input?.bot).session.guildSummaries(),

    /** Channels and roles, for the server explorer. */
    getGuildDetail: (_ctx: unknown, input: any) => buildGuildDetail(requireGuild(requireBot(input?.bot), input?.guildId)),

    /** One bounded member-search page. */
    searchGuildMembers: async (_ctx: unknown, input: any) => {
        const guild = requireGuild(requireBot(input?.bot), input?.guildId);
        const query = typeof input?.query === "string" ? input.query.trim() : "";
        // one bounded page; member search is a gateway request, never a
        // full member download
        const members = await guild.members.fetch({ query: query || undefined, limit: MEMBER_SEARCH_LIMIT });
        return buildMemberSummaries(members.values());
    },

    /** A bot's saved slash commands. */
    listCommands: (_ctx: unknown, input: any) => requireBot(input?.bot).stored.commands,

    /** Stores a command and registers its event and Discord definition. */
    createCommand: (_ctx: unknown, input: any) => createCommand(requireBot(input?.bot), input),

    /** Removes a stored command, its event and its Discord definition. */
    deleteCommand: (_ctx: unknown, input: any) => deleteCommand(requireBot(input?.bot), input?.id),

    /** Sends a message as the bot, from the server explorer. */
    sendMessage: (_ctx: unknown, input: any) =>
        new MessageOps(requireBot(input?.bot).session.requireClient()).send(String(input?.channel ?? ""), { content: input?.content }),
};

// what a widget's "Bot" dropdown offers in Home's gallery
const botChoices = () =>
    [...bots.values()]
        .sort((a, b) => a.stored.createdAt - b.stored.createdAt)
        .map((entry) => ({ value: entry.stored.id, label: entry.stored.name }));

/** A bot a Blocks block names, or why it can't be found. */
function blocksBot(id: unknown): BotEntry {
    const entry = typeof id === "string" ? bots.get(id) : undefined;
    if (entry) return entry;
    if (typeof id !== "string" || !id.trim()) throw new Error("Pick a bot with the Bot block.");
    throw new Error(`There's no bot "${id}" in Bot Creator: it was deleted, or that isn't a bot. Pick one with the Bot block.`);
}

/** What the panel's own bot blocks run: the same code as Bot Creator's home screen. */
const blocksBots: BotsBlocksHost = {
    ids: () => byCreation([...bots.values()].map(summary)).map((bot) => bot.id),
    bot: (id) => {
        const entry = blocksBot(id);
        const client = entry.session.connected() ? entry.session.client : null;
        return {
            summary: summary(entry),
            servers: client ? [...client.guilds.cache.keys()] : [],
            commands: entry.stored.commands,
            uptime: entry.session.health().uptimeMs,
        };
    },
    remove: async (id) => {
        await deleteBot(blocksBot(id));
    },
    setOn: async (id, on) => {
        requireReadable();
        await setEnabled(blocksBot(id), on);
    },
    restart: async (id) => {
        requireReadable();
        const entry = blocksBot(id);
        if (!entry.stored.enabled) throw new Error(`${entry.stored.name} is turned off. Turn it on instead.`);
        await connect(entry);
    },
    createCommand: (id, input) => createCommand(blocksBot(id), input),
    deleteCommand: (id, commandId) => deleteCommand(blocksBot(id), commandId),
    inviteLink: (id, permissions) => {
        const entry = blocksBot(id);
        return buildInviteUrl(entry.session.client?.user?.id || entry.stored.applicationId, permissions ?? DEFAULT_SELECTED_PERMISSIONS);
    },
    userInstallLink: (id) => {
        const entry = blocksBot(id);
        return buildUserInstallUrl(entry.session.client?.user?.id || entry.stored.applicationId);
    },
};

/**
 * Starts each bot without waiting for it. Logging in to Discord (and syncing commands after) can stall for minutes on a
 * rate limit; the service is ready before then, and a bot still connecting says so on its card.
 */
export function startBots<T>(entries: Iterable<T>, start: (entry: T) => Promise<void>): void {
    for (const entry of entries) {
        start(entry).catch((err) => console.error("[DiscordService] starting a bot failed:", errorToMessage(err)));
    }
}

export const botService = definePanelService({
    id: PANEL_ID,
    state: { bots: [], botsError: null } as BotsServiceState,
    calls: serviceCalls,
    widgetChoices: {
        "bot-status": { bot: botChoices },
        "command-activity": { bot: botChoices },
    },
    async onInit(ctx: ServiceContext<BotsServiceState>) {
        serviceCtx = ctx;
        try {
            await loadBots();
        } catch (err) {
            botsError = errorToMessage(err);
            console.error("[DiscordService] reading the saved bots failed:", botsError);
        }
        // the types first: every bot's blocks use them
        try {
            await blocksApi.panel(PANEL_ID).register(panelBlocks(connectedClients, blocksBots));
            panelBlocksReady = true;
        } catch (err) {
            panelBlocksError = errorToMessage(err);
            console.error("[DiscordService] registering the Blocks types failed:", panelBlocksError);
        }
        for (const entry of bots.values()) await registerEntry(entry);
        publish();
        startBots(bots.values(), connectEntry);
        console.log(`[DiscordService] Ready with ${bots.size} bot(s); connecting them to Discord.`);
    },
});

export default botService;
