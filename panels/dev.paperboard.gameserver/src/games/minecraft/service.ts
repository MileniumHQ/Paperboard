import { minecraftSoftware } from "./index";
import { initialServerState } from "../../service/initialState";
import { files as fileApi } from "../../service/api";
import { PANEL_ID } from "../../service/types";
import { settleInterruptedWork } from "../../service/recovery";
import { stopLeftoverInstaller } from "../../service/installerProcess";
import { setPlayerNamesChangedHandler } from "../../service/players";
import { readServerIcon } from "../../service/serverIcon";
import { processApi } from "../../service/api";
import type { GameService } from "../serviceTypes";
import { loadConfigAndProperties } from "./config";
import { prepareLaunch } from "./launch";
import { isInstallRunning } from "./softwareInstall";
import { commandLine, observeLine, sendChatMessage } from "./observe";
import { portSpecs, portNames } from "./ports";
import { withSavingPaused, pauseSavingForBackup, recoverPausedSaving } from "./saving";

export const minecraftService: GameService = {
    primaryProcessId: "mc-server",
    customTypes: async () => (await import("./actions")).customTypes,
    initialState: initialServerState,
    actions: async () => {
        const { panelActions, panelEventActions } = await import("./actions");
        return [...panelActions, ...panelEventActions];
    },
    async initialize(ctx, running) {
        if (!running) await settleInterruptedWork(ctx);
        await recoverPausedSaving();
        const { scheduleRepublishDynamicActions, republishDynamicActions } = await import("./actions");
        setPlayerNamesChangedHandler(() => scheduleRepublishDynamicActions(ctx));
        await republishDynamicActions(ctx);
    },
    async beforeRemove() { await stopLeftoverInstaller(); },
    async dispose() {
        const { cancelDynamicActions } = await import("./actions");
        cancelDynamicActions();
        setPlayerNamesChangedHandler(null);
    },
    readIcon: () => readServerIcon({ serverDir: () => fileApi.getPath("", PANEL_ID) }),
    processIds: ["mc-server", "mc-installer"],
    loadOptions: loadConfigAndProperties,
    prepareLaunch,
    isMutating: isInstallRunning,
    stopEntry: "stop",
    stop: () => processApi.write("mc-server", "stop\n"),
    commandLine,
    sendChat: sendChatMessage,
    observeLine,
    portNames,
    ports: (ctx, deps) => portSpecs(minecraftSoftware(ctx.state.serverSoftware), deps),
    backup: {
        mode: "quiesce",
        before: pauseSavingForBackup,
        recover: recoverPausedSaving,
        withConsistentData: withSavingPaused,
    },
};
