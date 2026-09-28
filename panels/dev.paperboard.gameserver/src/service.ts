import { definePanelService, processApi } from "@paperboard-dev/paperapi";
import { SERVER_PROC_ID, type GameServerState } from "./service/types";
import { loadConfigAndProperties } from "./service/config";
import { handleProcessData, handleProcessExit } from "./service/lifecycle";
import {
    panelActions,
    panelEventActions,
    customTypes,
    republishDynamicActions,
    scheduleRepublishDynamicActions,
} from "./service/actions";
import { setPlayerNamesChangedHandler } from "./service/players";

export * from "./service/types";
export * from "./service/actions";

const initialState: GameServerState = {
    serverStatus: "offline",
    serverEntries: [],
    chatMessages: [],
    localIp: "127.0.0.1",
    serverPort: "25565",
    serverMotd: "A Minecraft Server",
    serverSoftware: "paper",
    serverVersion: "",
    ramAllocation: 4,
    onlinePlayers: [],
    seenPlayers: [],
    playerStats: {},
    playerPlaytime: {},
    playerPositions: {},
    gamerules: {},
    installProgress: null,
    activeIssue: null,
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

        processApi.onData(SERVER_PROC_ID, (chunk: string) =>
            handleProcessData(ctx, chunk),
        );
        processApi.onExit(SERVER_PROC_ID, () => handleProcessExit(ctx));
    },
});

export default gameServerService;
