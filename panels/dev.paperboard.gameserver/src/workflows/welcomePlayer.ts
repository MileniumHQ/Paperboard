// example welcome flow using the actions api
import { actions } from "@paperboard-dev/paperapi";

export async function registerWelcomeWorkflow() {
    console.log("⚡ [Workflow] Registering Welcome Player Automation Flow...");

    const availableActions = await actions.list("dev.paperboard.gameserver");
    const availableTriggers = await actions.listTriggers("dev.paperboard.gameserver");

    console.log(`📋 Found ${availableActions.length} actions and ${availableTriggers.length} triggers:`);
    for (const act of availableActions) {
        console.log(`  - Action: "${act.schema?.name}" (Template: "${act.schema?.template}")`);
    }

    const unsubscribe = actions.onTrigger("dev.paperboard.gameserver", "player-joined", async (player: string) => {
        console.log(`\n🎉 [Trigger Fired] Player joined: "${player}"`);

        console.log(`  -> Step 1: Sending welcome message...`);
        const messageResult = await actions.call("dev.paperboard.gameserver", "run-command", {
            command: `tellraw @a {"text":"Hello ${player}! Welcome to the server! ✨"}`,
        });
        console.log(`     Message broadcasted:`, messageResult);

        console.log(`  -> Step 2: Granting starter rewards...`);
        const commandResult = await actions.call("dev.paperboard.gameserver", "run-command", {
            command: `give ${player} golden_apple 20`,
        });
        console.log(`     Command output:`, commandResult);

        console.log(`✅ [Workflow Completed] Automated welcome flow executed successfully for ${player}!\n`);
    });

    return unsubscribe;
}

if ((import.meta as any).main) {
    registerWelcomeWorkflow().then(() => {
        console.log("🚀 Welcome workflow is live and listening for players on PaperCrane!");
    });
}
