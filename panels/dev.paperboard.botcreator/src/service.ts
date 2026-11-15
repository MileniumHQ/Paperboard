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
import { definePanelService, type ServiceContext } from "@mileniumhq/paperapi";
import { errorToMessage } from "./types";
import { PANEL_ID, type BotsServiceState } from "./bots";
import { bots, panel, publish } from "./registry";
import { loadBots, rememberGuideSeen } from "./persistence";
import { createEntry, registerPanelBlocks } from "./blocksBridge";
import { connectEntry, registerEntry } from "./lifecycle";
import { blocksBots, botChoices, serviceCalls } from "./calls";

/**
 * Starts each bot without waiting for it. Logging in to Discord (and syncing commands after) can stall for minutes on a
 * rate limit; the service is ready before then, and a bot still connecting says so on its card.
 */
function startBots<T>(entries: Iterable<T>, start: (entry: T) => Promise<void>): void {
    for (const entry of entries) {
        start(entry).catch((err) => console.error("[DiscordService] starting a bot failed:", errorToMessage(err)));
    }
}

export const botService = definePanelService({
    id: PANEL_ID,
    state: { bots: [], botsError: null, setupGuideSeen: true } as BotsServiceState,
    calls: serviceCalls,
    widgetChoices: {
        "bot-status": { bot: botChoices },
        "command-activity": { bot: botChoices },
    },
    async onInit(ctx: ServiceContext<BotsServiceState>) {
        panel.ctx = ctx;
        try {
            await loadBots(createEntry);
        } catch (err) {
            panel.botsError = errorToMessage(err);
            console.error("[DiscordService] reading the saved bots failed:", panel.botsError);
        }
        // the types first: every bot's blocks use them
        await registerPanelBlocks(blocksBots);
        await rememberGuideSeen();
        for (const entry of bots.values()) await registerEntry(entry);
        publish();
        startBots(bots.values(), connectEntry);
        console.log(`[DiscordService] Ready with ${bots.size} bot(s); connecting them to Discord.`);
    },
});

export default botService;
