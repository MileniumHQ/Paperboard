import { assertSingleLine } from "../core/players";
import { defineAction, files as fileApi, backupApi, type ServiceContext } from "./api";
import type { GameServerState } from "./types";
import { ACTION_IDS, PANEL_ID } from "./contract";
import { startServerInstance, stopServerInstance, restartServerInstance, sendServerCommand, sendChatMessage } from "./lifecycle";
import { listServerFiles, readServerFile, writeServerFile } from "./serverFiles";
import { listLogFiles, readLogFile } from "./logs";
import { currentGameService } from "../games/service";
import { loadServerOptions } from "./options";
import { currentServer } from "./scope";
const loaderDeps = { serverDir: () => fileApi.getPath("", PANEL_ID) };
export const backupAction = defineAction({
    id: "backup-server", name: "Back up server", description: "Create a named server backup at its chosen destination", category: "Server", inputs: {}, output: { type: "object", label: "Backup" },
    run: async () => { const server = currentServer(); if (!server) throw new Error("Choose a server"); return backupApi.forSource(PANEL_ID, server.server.id).create(); },
});
export const sharedActions = [
    defineAction({
        id: ACTION_IDS.runCommand,
        name: "Run Command",
        category: "Server",
        description: "Executes a raw console command on the server instance",
        template: "Execute command {command}",
        inputs: {
            command: {
                type: "string",
                label: "Command",
                placeholder: "Command",
                required: true,
            },
        },
        output: {
            type: "string",
            label: "Command Result",
        },
        quick: false,
        icon: "terminal",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { command: string } | string,
        ) => {
            const cmd = typeof inputs === "string" ? inputs : inputs?.command || "";
            await sendServerCommand(ctx, cmd);
            return `Executed: ${cmd}`;
        },
    }),
    defineAction({
        id: ACTION_IDS.saveWorld,
        name: "Save the world",
        category: "Server",
        description: "Writes the running world to disk and waits for the server to confirm it",
        template: "Save the world",
        writtenOut: "Save the world",
        output: {
            type: "boolean",
            label: "Saved",
        },
        quick: true,
        icon: "save",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await currentGameService().saveWorld(ctx);
            return true;
        },
    }),
    defineAction({
        id: ACTION_IDS.startServer,
        name: "Start the server",
        category: "Server",
        description: "Launches the game server process",
        template: "Start the server",
        writtenOut: "Start the server",
        output: {
            type: "boolean",
            label: "Started",
        },
        quick: true,
        icon: "power",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await startServerInstance(ctx);
            return true;
        },
    }),
    defineAction({
        id: ACTION_IDS.stopServer,
        name: "Stop the server",
        category: "Server",
        description: "Gracefully stops the game server",
        template: "Stop the server",
        writtenOut: "Stop the server",
        output: {
            type: "boolean",
            label: "Stopped",
        },
        quick: true,
        icon: "stop",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await stopServerInstance(ctx);
            return true;
        },
    }),
    defineAction({
        id: ACTION_IDS.restartServer,
        name: "Restart the server",
        category: "Server",
        description: "Restarts the running server",
        template: "Restart the server",
        writtenOut: "Restart the server",
        output: {
            type: "boolean",
            label: "Restarted",
        },
        quick: true,
        icon: "restart_alt",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await restartServerInstance(ctx);
            return true;
        },
    }),
    defineAction({
        id: ACTION_IDS.loadConfig,
        name: "Reload Configuration",
        category: "Server",
        description: "Reloads server properties and panel config",
        internal: true,
        template: "Reload server configuration",
        writtenOut: "Reload server configuration",
        output: { type: "boolean", label: "Success" },
        run: async (ctx) => {
            await loadServerOptions(ctx);
            return true;
        },
    }),
    defineAction({
        id: ACTION_IDS.sayChat,
        name: "Send Chat Message",
        category: "Server",
        description: "Broadcasts a chat message to all players in game",
        template: "Say {message}",
        inputs: {
            message: {
                type: "string",
                label: "Message",
                placeholder: "Message",
                required: true,
            },
        },
        output: {
            type: "string",
            label: "Sent Message",
        },
        quick: false,
        icon: "chat",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { message: string },
        ) => {
            // single-line: a line break would inject a second console command
            const msg = assertSingleLine((inputs?.message || "").trim(), "chat message", 500);
            if (!msg) throw new Error("Message is required");
            await sendChatMessage(ctx, msg);
            return msg;
        },
    }),
    defineAction({
        id: ACTION_IDS.listServerFiles,
        name: "List Server Files",
        category: "Server",
        description: "Lists one folder of the server's files for the Files tab",
        internal: true,
        template: "List server files in {path}",
        inputs: {
            path: { type: "string", label: "Folder", required: false },
        },
        output: { type: "object", label: "Listing" },
        quick: false,
        icon: "folder",
        run: async (_ctx: ServiceContext<GameServerState>, inputs: { path?: string }) =>
            listServerFiles(inputs?.path ?? "", loaderDeps),
    }),
    defineAction({
        id: ACTION_IDS.readServerFile,
        name: "Read Server File",
        category: "Server",
        description: "Reads one of the server's files for the Files tab",
        internal: true,
        template: "Read server file {path}",
        inputs: {
            path: { type: "string", label: "File", required: true },
        },
        output: { type: "object", label: "File" },
        quick: false,
        icon: "draft",
        run: async (_ctx: ServiceContext<GameServerState>, inputs: { path?: string }) =>
            (await currentGameService().assertFileAccess?.(_ctx, inputs?.path, false), readServerFile(inputs?.path, loaderDeps)),
    }),
    defineAction({
        id: ACTION_IDS.writeServerFile,
        name: "Write Server File",
        category: "Server",
        description: "Saves one of the server's text files from the Files tab",
        internal: true,
        template: "Save server file {path}",
        inputs: {
            path: { type: "string", label: "File", required: true },
            text: { type: "string", label: "Contents", required: true },
            version: { type: "string", label: "Version read", required: true },
        },
        output: { type: "object", label: "Saved" },
        quick: false,
        icon: "save",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { path?: string; text?: string; version?: string },
        ) => {
            if (currentGameService().isMutating()) {
                throw new Error("A server install is running; save files once it finishes.");
            }
            await currentGameService().assertFileAccess?.(ctx, inputs?.path, true);
            const running = ctx.state.serverStatus !== "offline";
            return writeServerFile(inputs?.path, inputs?.text, inputs?.version, running, loaderDeps);
        },
    }),
    defineAction({
        id: ACTION_IDS.listLogFiles,
        name: "List Log Files",
        category: "Logs",
        description: "Lists the server's log files, newest first",
        template: "List log files",
        inputs: {},
        output: { type: "object", label: "Log Files" },
        quick: false,
        icon: "description",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return listLogFiles(ctx);
        },
    }),
    defineAction({
        id: ACTION_IDS.readLogFile,
        name: "Read Log File",
        category: "Logs",
        description: "Reads a server log file (tail for plain logs, full for archives)",
        template: "Read log file {name}",
        inputs: {
            name: { type: "string", label: "File Name", required: true },
        },
        output: { type: "object", label: "Log" },
        quick: false,
        icon: "description",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { name: string },
        ) => {
            if (!inputs?.name) throw new Error("Log file name is required");
            return readLogFile(ctx, inputs.name);
        },
    }),
];
