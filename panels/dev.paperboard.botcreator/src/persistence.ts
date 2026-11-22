// What the service keeps between runs: the bot list in the panel config and
// each bot's token in the vault.
import { config, secretsApi, errorMessage, SerialQueue } from "@mileniumhq/paperapi";
import {
    BOTS_VERSION,
    PANEL_ID,
    SETUP_GUIDE_FIELD,
    newTokenName,
    readBotsConfig,
    tokenName,
    tokenOwner,
    type StoredBot,
} from "./bots";
import { bots, logFailure, panel, publish, reportFailure, requireReadable, type BotEntry } from "./registry";

/** Makes the entry for a saved bot: its session and its host. */
type CreateEntry = (stored: StoredBot, hasToken: boolean) => BotEntry;

// writes run one after another, each saving the list as it is then, so an
// older write never lands after a newer one
const writing = new SerialQueue();

export function saveBots(): Promise<void> {
    const write = writing.run(async () => {
        const document = {
            ...panel.savedExtras,
            // a computer with a bot has been through the setup guide
            ...(bots.size > 0 ? { [SETUP_GUIDE_FIELD]: true } : {}),
            version: BOTS_VERSION,
            bots: [...bots.values()].map((entry) => entry.stored),
        };
        try {
            await config.set(document, PANEL_ID);
        } catch (err) {
            throw new Error(`Could not save the bots: ${errorMessage(err)}`);
        }
    });
    // the caller hears of a failed write, and the log too
    write.catch(logFailure("saving the bots failed"));
    return write;
}

/** Resolves once every save made so far has been answered: the daemon has written it. */
export function savesSettled(): Promise<void> {
    return writing.settled();
}

export async function readToken(id: string): Promise<string | null> {
    const stored = await secretsApi.get(tokenName(id), PANEL_ID);
    return stored.found && stored.value ? stored.value : null;
}

/** The new token the page left for a bot, taken out of the vault: it is saved again only once it has been checked. */
export async function takeNewToken(id: string): Promise<string | null> {
    const left = await secretsApi.get(newTokenName(id), PANEL_ID);
    await secretsApi.delete(newTokenName(id), PANEL_ID);
    return left.found && left.value ? left.value : null;
}

/**
 * Tokens no saved bot holds: a new token never checked, or one the page saved
 * for a bot whose add never reached the service. Nothing is forgotten while
 * the saved bots can't be read.
 */
export async function forgetStrayTokens(): Promise<void> {
    if (panel.botsError) return;
    for (const name of await secretsApi.list(PANEL_ID)) {
        const owner = tokenOwner(name);
        if (!owner || (owner.kind === "token" && bots.has(owner.bot))) continue;
        await secretsApi.delete(name, PANEL_ID);
        console.log(`[DiscordService] forgot ${owner.kind === "new" ? "an unchecked new token" : "the token of a bot that was never added"} (${owner.bot})`);
    }
}

/** Reads the saved bots into the registry; throws why they can't be read. */
export async function loadBots(create: CreateEntry): Promise<void> {
    const saved = await config.get<unknown>(PANEL_ID);
    const read = readBotsConfig(saved);
    const { bots: _bots, version: _version, ...extras } = (saved ?? {}) as Record<string, unknown>;
    panel.savedExtras = extras;
    for (const stored of read.bots) bots.set(stored.id, create(stored, false));
}

/** The setup guide was finished or skipped: it never shows again. Saved with the bots. */
export async function markSetupGuideSeen(): Promise<void> {
    requireReadable();
    const before = panel.savedExtras;
    panel.savedExtras = { ...panel.savedExtras, [SETUP_GUIDE_FIELD]: true };
    try {
        await saveBots();
    } catch (err) {
        // the guide stays, as it is saved, and the page says why
        panel.savedExtras = before;
        throw err;
    }
    publish();
}

/** Bots saved before the guide existed: remember that they have been through it. */
export async function rememberGuideSeen(): Promise<void> {
    if (panel.botsError || bots.size === 0 || panel.savedExtras[SETUP_GUIDE_FIELD] === true) return;
    panel.savedExtras = { ...panel.savedExtras, [SETUP_GUIDE_FIELD]: true };
    await saveBots().catch(reportFailure("Bot Creator couldn't save that its setup guide is done"));
}
