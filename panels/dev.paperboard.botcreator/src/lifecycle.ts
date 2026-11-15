// A bot's life in the service: added from a token, started, turned on and
// off, given a new token, and deleted with everything it had.
import { secretsApi } from "@mileniumhq/paperapi";
import { errorToMessage, extractApplicationIdFromToken } from "./types";
import { MAX_BOTS, PANEL_ID, isBotId, tokenName, type BotSummary, type DeleteBotResult } from "./bots";
import { adding, bots, logFailure, publish, requireReadable, summary, type BotEntry } from "./registry";
import { readToken, saveBots, takeNewToken } from "./persistence";
import { tokenUser } from "./session";
import { botsChanged, createEntry, firePanelEvent, noteIdentity, noteOnline, registerBlocks } from "./blocksBridge";

/** Connects a saved bot with its vault token; the reason it can't is the bot's error. */
export async function connect(entry: BotEntry): Promise<void> {
    const token = await readToken(entry.stored.id);
    entry.hasToken = Boolean(token);
    if (!token) {
        const message = "No token is saved for this bot. Replace its token in Configuration.";
        entry.session.fail(message);
        throw new Error(message);
    }
    await entry.session.start(token);
}

export async function setEnabled(entry: BotEntry, enabled: boolean): Promise<void> {
    if (entry.stored.enabled !== enabled) {
        const before = entry.stored;
        entry.stored = { ...entry.stored, enabled };
        try {
            await saveBots();
        } catch (err) {
            // the switch goes back to what is saved, and says why
            entry.stored = before;
            throw err;
        }
        publish();
    }
    if (enabled) await connect(entry);
    else await entry.session.stop();
}

/** Adds a saved bot's blocks to Blocks. The daemon is local, so this is quick, and it's done before the service is
 * ready: a flow that runs at startup finds the bot's blocks registered. */
export async function registerEntry(entry: BotEntry): Promise<void> {
    try {
        await registerBlocks(entry);
    } catch (err) {
        entry.blocksError = `Its blocks couldn't be added to Blocks: ${errorToMessage(err)}`;
        console.error(`[DiscordService] ${entry.stored.name}:`, entry.blocksError);
    }
}

/** Logs a saved bot in to Discord, which can stall on a rate limit, so it runs after the service is ready. */
export async function connectEntry(entry: BotEntry): Promise<void> {
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

/**
 * Adds a bot whose token the panel saved in the vault under its id, once it
 * logs in. A bot that doesn't log in is forgotten, token and all.
 */
export async function addBot(id: unknown): Promise<BotSummary> {
    requireReadable();
    if (!isBotId(id)) throw new Error("A bot id is required.");
    if (bots.has(id)) throw new Error("This bot is already added.");
    const saved = await readToken(id);
    if (!saved) throw new Error("No token was saved for the new bot.");
    const forget = () => secretsApi.delete(tokenName(id), PANEL_ID).catch(logFailure("forgetting the refused token failed"));
    const applicationId = extractApplicationIdFromToken(saved);
    if (!applicationId) {
        await forget();
        throw new Error("That isn't a Discord bot token.");
    }
    const twin = [...bots.values()].find((entry) => entry.stored.applicationId === applicationId);
    if (twin || adding.has(applicationId)) {
        await forget();
        throw new Error(`${twin ? twin.stored.name : "Another bot being added"} already uses this bot. One bot can only run once.`);
    }
    if (bots.size + adding.size >= MAX_BOTS) {
        await forget();
        throw new Error(`Bot Creator runs at most ${MAX_BOTS} bots.`);
    }
    adding.add(applicationId);
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
    } finally {
        adding.delete(applicationId);
    }
    publish();
    botsChanged();
    firePanelEvent("bot-added", { bot: id });
    noteOnline(entry);
    return summary(entry);
}

/**
 * Replaces a bot's token with the new one the panel left in the vault, once
 * Discord takes it as this bot's, and reconnects the bot if it's on. A token
 * Discord refuses, or one for another bot, leaves the saved token as it was.
 */
export async function replaceToken(entry: BotEntry): Promise<void> {
    requireReadable();
    const token = await takeNewToken(entry.stored.id);
    if (!token) throw new Error("No new token was given for this bot.");
    // a token for another application would quietly turn this bot into that one
    const expected = entry.stored.applicationId;
    const other = "That token is for a different bot. Add it as a new bot instead.";
    if (expected && extractApplicationIdFromToken(token) !== expected) throw new Error(other);
    let user: string;
    try {
        user = await tokenUser(token);
    } catch (err) {
        throw new Error(`Discord refused the new token, so the saved one is kept: ${errorToMessage(err)}`);
    }
    if (expected && user !== expected) throw new Error(other);
    await secretsApi.set(tokenName(entry.stored.id), token, PANEL_ID);
    entry.hasToken = true;
    if (entry.stored.enabled) await connect(entry);
    else publish();
}

/** Logs a bot that's on in again, with its saved token. */
export async function restart(entry: BotEntry): Promise<void> {
    if (!entry.stored.enabled) throw new Error(`${entry.stored.name} is turned off. Turn it on instead.`);
    await connect(entry);
}

/**
 * Clears a bot's commands on Discord, stops it and removes it, its token and
 * its Blocks project. When Discord refuses the clear (a reset token, a
 * deleted application) the bot stays and the refusal is given, unless
 * `anyway`: then the clear is skipped and its commands stay on Discord.
 */
export async function deleteBot(entry: BotEntry, anyway = false): Promise<DeleteBotResult> {
    requireReadable();
    const id = entry.stored.id;
    // with its saved token, online or off; a bot with no token has nothing
    // left to reach Discord with
    const token = anyway ? null : await readToken(id);
    if (token) {
        try {
            await entry.session.clearCommands(token);
        } catch (err) {
            return { refused: errorToMessage(err) };
        }
    }
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
    return { deleted: id };
}
