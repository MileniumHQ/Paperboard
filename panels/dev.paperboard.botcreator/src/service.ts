// Bot Creator's service: every bot the panel runs, each with its own
// session and its own Blocks project. A bot's
// Discord blocks and events live in its project ("<bot>/command.send-message"), so
// two bots share nothing in a flow; the builders that never touch Discord
// (embeds, buttons, menus) are global. The panel's own controls reach the
// service through calls that name the bot.
//
// This file starts it all; the work is split by job:
//   registry.ts      the bots and what every window is told of them
//   persistence.ts   the saved list, the vault tokens, the old single bot
//   blocksBridge.ts  a bot's session as Blocks events and a Blocks project
//   commands.ts      making and removing slash commands
//   lifecycle.ts     adding, starting, switching, re-tokening, deleting a bot
//   calls.ts         the page's calls and the panel's bot blocks
import { definePanelService, errorMessage } from "@mileniumhq/paperapi";
import { botCreatorContract } from "./contract";
import { bots, panel, publish, reportFailure } from "./registry";
import { forgetStrayTokens, loadBots, rememberGuideSeen, savesSettled } from "./persistence";
import { createEntry, registerPanelBlocks } from "./blocksBridge";
import { connectEntry, registerEntry } from "./lifecycle";
import { blocksBots, botChoices, serviceCalls } from "./calls";
import type { CallHandlers } from "@mileniumhq/paperapi";

/**
 * Starts each bot without waiting for it. Logging in to Discord (and syncing commands after) can stall for minutes on a
 * rate limit; the service is ready before then, and a bot still connecting says so on its card.
 */
function startBots<T>(entries: Iterable<T>, start: (entry: T) => Promise<void>): void {
    for (const entry of entries) {
        // quiet: connectEntry puts a bot's failure on its card; this only catches a bug in that
        start(entry).catch((err) => console.error("[DiscordService] starting a bot failed:", errorMessage(err)));
    }
}

/**
 * Reads the saved bots again after they couldn't be read, and brings up what the start would have: the bots' blocks and
 * connections. The error clears and the state is announced, or it stays and this throws why. Nothing to do once they are read.
 */
let readingAgain: Promise<void> | null = null;
function readBotsAgain(): Promise<void> {
    readingAgain ??= (async () => {
        if (!panel.botsError) return;
        try {
            await loadBots(createEntry);
        } catch (err) {
            panel.botsError = errorMessage(err);
            throw err;
        }
        panel.botsError = null;
        await rememberGuideSeen();
        await forgetStrayTokens().catch(reportFailure("Tokens no bot holds couldn't be forgotten"));
        for (const entry of bots.values()) await registerEntry(entry);
        publish();
        startBots(bots.values(), connectEntry);
        console.log(`[DiscordService] Read the saved bots again: ${bots.size} bot(s); connecting them to Discord.`);
    })().finally(() => {
        readingAgain = null;
    });
    return readingAgain;
}

const calls: CallHandlers<typeof botCreatorContract> = { ...serviceCalls, readBotsAgain };

export const botService = definePanelService({
    contract: botCreatorContract,
    calls,
    widgetChoices: {
        "bot-status": { bot: botChoices },
        "command-activity": { bot: botChoices },
    },
    async onInit(ctx) {
        panel.ctx = ctx;
        try {
            await loadBots(createEntry);
        } catch (err) {
            panel.botsError = errorMessage(err);
            console.error("[DiscordService] reading the saved bots failed:", panel.botsError);
        }
        // the types first: every bot's blocks use them
        await registerPanelBlocks(blocksBots);
        await rememberGuideSeen();
        await forgetStrayTokens().catch(reportFailure("Tokens no bot holds couldn't be forgotten"));
        for (const entry of bots.values()) await registerEntry(entry);
        publish();
        startBots(bots.values(), connectEntry);
        console.log(`[DiscordService] Ready with ${bots.size} bot(s); connecting them to Discord.`);
    },
});

// The daemon stops a service with SIGTERM and gives it a few seconds. A save
// already made lands first: dying mid-save would lose the newer list, or let
// the daemon write it after the next start has read the older one.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void savesSettled().finally(() => process.exit(0)));
}

export default botService;
