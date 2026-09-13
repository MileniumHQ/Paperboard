import { definePanelService, processApi } from "@paperboard-dev/paperapi";
import { SERVER_PROC_ID, type GameServerState } from "./service/types";
import { loadConfigAndProperties } from "./service/config";
import { handleProcessData, handleProcessExit } from "./service/lifecycle";
import { panelActions, panelTriggers, customTypes } from "./service/actions";

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
    activeIssue: null,
};

export const gameServerService = definePanelService({
    id: "dev.paperboard.gameserver",
    state: initialState,
    types: customTypes,
    actions: panelActions,
    triggers: panelTriggers,
    async onInit(ctx) {
        await loadConfigAndProperties(ctx);

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
