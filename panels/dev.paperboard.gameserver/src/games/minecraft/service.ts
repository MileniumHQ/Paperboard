import type { Server } from "../../service/server";
import { minecraftSoftware } from "./index";
import { initialServerState } from "../../service/initialState";
import { SERVER_PROC_ID } from "../../service/types";
import { settleInterruptedWork } from "../../service/recovery";
import { INSTALLER_PROC_ID, stopLeftoverInstaller } from "../../service/installerProcess";
import { readServerIcon } from "../../service/serverIcon";
import type { GameService } from "../serviceTypes";
import { loadConfigAndProperties } from "./config";
import { prepareLaunch } from "./launch";
import { isInstallRunning } from "./softwareInstall";
import { commandLine, observeLine, onReady, sendChatMessage } from "./observe";
import { portSpecs, portNames } from "./ports";
import { withSavingPaused, pauseSavingForBackup, recoverPausedSaving, saveWorld } from "./saving";
import { minecraftState, type MinecraftState } from "./state";

/** A Minecraft server's part of its game: its install lock, saving pause, console and roster are its own. */
export function minecraftService(server: Server): GameService & { minecraft: MinecraftState } {
    return {
        minecraft: minecraftState(),
        primaryProcessId: SERVER_PROC_ID,
        initialState: initialServerState,
        calls: async () => (await import("./calls")).minecraftCalls,
        blocks: async () => (await import("./blocks")).minecraftBlocks(server),
        async initialize(running) {
            if (!running) await settleInterruptedWork(server);
            await recoverPausedSaving(server);
            // a server adopted from the last service answers who is on and its
            // live rules again; nothing else asks until it next starts
            if (running) onReady(server);
        },
        async beforeRemove() { await stopLeftoverInstaller(server.process); },
        async dispose() {},
        readIcon: () => readServerIcon({ serverDir: () => server.root() }),
        processIds: [SERVER_PROC_ID, INSTALLER_PROC_ID],
        // the running server locks each world's, and Windows won't let a locked file be read
        backupSkip: ["session.lock"],
        loadOptions: () => loadConfigAndProperties(server),
        prepareLaunch: () => prepareLaunch(server),
        isMutating: () => isInstallRunning(server),
        saveWorld: () => saveWorld(server),
        stopEntry: "stop",
        stop: () => server.process.write(SERVER_PROC_ID, "stop\n"),
        commandLine: (command) => commandLine(server, command),
        sendChat: (message) => sendChatMessage(server, message),
        observeLine: (line, final) => observeLine(server, line, final),
        portNames,
        ports: (deps) => portSpecs(minecraftSoftware(server.state.serverSoftware), deps),
        backup: {
            mode: "quiesce",
            before: () => pauseSavingForBackup(server),
            recover: () => recoverPausedSaving(server),
            withConsistentData: (work) => withSavingPaused(server, work),
        },
    };
}
