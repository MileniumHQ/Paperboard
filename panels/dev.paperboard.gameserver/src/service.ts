import { definePanelService, processApi } from "@mileniumhq/paperapi";
import { SERVER_PROC_ID, appendCapped, type GameServerState } from "./service/types";
import { settleInterruptedWork } from "./service/recovery";
import { loadConfigAndProperties } from "./service/config";
import { DEFAULT_MOTD } from "./core/motd";
import { handleProcessData, handleProcessExit } from "./service/lifecycle";
import {
    panelActions,
    panelEventActions,
    customTypes,
    republishDynamicActions,
    scheduleRepublishDynamicActions,
} from "./service/actions";
import { setPlayerNamesChangedHandler } from "./service/players";
import { pauseSavingForBackup, recoverPausedSaving } from "./service/saving";

export * from "./service/types";
export * from "./service/actions";

const initialState: GameServerState = {
    serverStatus: "offline",
    serverEntries: [],
    chatMessages: [],
    localIp: "127.0.0.1",
    serverPort: "25565",
    serverMotd: DEFAULT_MOTD,
    serverSoftware: "paper",
    serverVersion: "",
    ramAllocation: 4,
    onlinePlayers: [],
    maxPlayers: null,
    seenPlayers: [],
    playerStats: {},
    playerPlaytime: {},
    playerPositions: {},
    gamerules: {},
    installProgress: null,
    modpackProgress: null,
    activeIssue: null,
    recoveryBlock: null,
};

export const gameServerService = definePanelService({
    id: "dev.paperboard.gameserver",
    state: initialState,
    types: customTypes,
    categories: [
        { name: "Server", icon: "dns", order: 1 },
        { name: "Players", icon: "group", order: 2 },
        { name: "Worlds", icon: "public", order: 3 },
        { name: "Game Rules", icon: "rule", order: 4 },
        { name: "Plugins", icon: "extension", order: 5 },
        { name: "Logs", icon: "receipt_long", order: 6 },
        { name: "Events", icon: "bolt", order: 7 },
    ],
    actions: [...panelActions, ...panelEventActions],
    async onInit(ctx) {
        await loadConfigAndProperties(ctx);
        // an install or modpack change the previous service run never
        // finished is settled before anything reads the server folder; when
        // it cannot be, starting and installing stay blocked (recovery.ts)
        await settleInterruptedWork(ctx);
        // a newly seen player name must reach the join/leave triggers'
        // dropdowns without a restart
        setPlayerNamesChangedHandler(() => scheduleRepublishDynamicActions(ctx));
        // the world, gamerule and player dropdowns are registered from state
        // that only exists after the config loads
        await republishDynamicActions(ctx);

        try {
            const isRunning = await processApi.exists(SERVER_PROC_ID);
            if (isRunning) {
                ctx.setState({ serverStatus: "online" });
            }
        } catch (err) {
            console.error("[gameserver] process-exists probe failed:", String(err));
        }
        // listening comes first: recovering a paused world waits for the
        // server's own confirmation line
        processApi.onData(SERVER_PROC_ID, (chunk: string) =>
            handleProcessData(ctx, chunk),
        );
        processApi.onExit(SERVER_PROC_ID, () => handleProcessExit(ctx));
        // a world copy the last service left unfinished kept saving off
        try {
            if (await recoverPausedSaving()) {
                console.warn("[gameserver] saving was left paused by an interrupted world copy; turned it back on");
            }
        } catch (err) {
            ctx.setState({
                serverEntries: appendCapped(ctx.state.serverEntries, {
                    type: "error",
                    content: `[Server] Saving may still be paused from an interrupted world copy; run save-on: ${err instanceof Error ? err.message : String(err)}`,
                }),
            });
        }
    },
    // a backup copies the server folder; the world must not change under it
    beforeBackup: (ctx) => pauseSavingForBackup(ctx),
});

export default gameServerService;
