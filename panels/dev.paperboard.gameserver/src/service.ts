import { definePanelService, processApi } from "@mileniumhq/paperapi";
import { SERVER_PROC_ID, appendCapped, type GameServerState } from "./service/types";
import { recoverInterruptedInstall } from "./service/softwareInstall";
import { liveRecoveryDeps } from "./service/softwareInstallDeps";
import { recoverInterruptedModpack } from "./service/modpacks";
import { liveModpackRecoveryDeps } from "./service/modpackDeps";
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
import { recoverPausedSaving } from "./service/saving";

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
        // an install the previous service run never finished is settled
        // before anything reads the server folder
        try {
            const recovered = await recoverInterruptedInstall(liveRecoveryDeps());
            if (recovered.committed.length || recovered.rolledBack.length || recovered.discarded.length) {
                console.log("[gameserver] settled interrupted install:", JSON.stringify(recovered));
            }
        } catch (err) {
            console.error("[gameserver] interrupted install could not be settled:", String(err));
            ctx.setState({
                serverEntries: appendCapped(ctx.state.serverEntries, {
                    type: "error",
                    content: `[Server] An interrupted install could not be cleaned up: ${err instanceof Error ? err.message : String(err)}`,
                }),
            });
        }
        // then a modpack change, which may have been waiting on that install
        try {
            const recovered = await recoverInterruptedModpack(liveModpackRecoveryDeps());
            if (recovered.committed.length || recovered.rolledBack.length || recovered.discarded.length) {
                console.log("[gameserver] settled interrupted modpack change:", JSON.stringify(recovered));
            }
        } catch (err) {
            console.error("[gameserver] interrupted modpack change could not be settled:", String(err));
            ctx.setState({
                serverEntries: appendCapped(ctx.state.serverEntries, {
                    type: "error",
                    content: `[Server] An interrupted modpack change could not be cleaned up: ${err instanceof Error ? err.message : String(err)}`,
                }),
            });
        }
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

        processApi.onData(SERVER_PROC_ID, (chunk: string) =>
            handleProcessData(ctx, chunk),
        );
        processApi.onExit(SERVER_PROC_ID, () => handleProcessExit(ctx));
    },
});

export default gameServerService;
