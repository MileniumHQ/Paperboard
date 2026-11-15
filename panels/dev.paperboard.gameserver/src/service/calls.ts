import { assertSingleLine } from "../core/players";
import { files as fileApi, backupApi, type ServiceContext } from "./api";
import type { GameServerState } from "./types";
import { PANEL_ID, type CallName } from "./contract";
import { startServerInstance, stopServerInstance, restartServerInstance, sendServerCommand, sendChatMessage } from "./lifecycle";
import { listServerFiles, readServerFile, writeServerFile } from "./serverFiles";
import { listLogFiles, readLogFile } from "./logs";
import { currentGameService } from "../games/service";
import { loadServerOptions } from "./options";
import { currentServer } from "./scope";
import { automationView, readAutomation, writeAutomation } from "./automation";
const loaderDeps = { serverDir: () => fileApi.getPath("", PANEL_ID) };
/** The current server's backups, as the backup service keeps them. */
export function serverBackups() {
    const server = currentServer();
    if (!server) throw new Error("Choose a server");
    return backupApi.forSource(PANEL_ID, server.server.id);
}
/** Says a message in the game's chat; one line, so it can't carry a second console command. */
export async function sayInChat(ctx: ServiceContext<GameServerState>, message: unknown): Promise<string> {
    const msg = assertSingleLine(String(message ?? "").trim(), "chat message", 500);
    if (!msg) throw new Error("Message is required");
    await sendChatMessage(ctx, msg);
    return msg;
}
/**
 * What a server's game answers of the panel's contract, and what its blocks
 * run: each is handed the server's context and the call's own input, which
 * the contract checked when a page made the call.
 */
export type ServerCall = (ctx: ServiceContext<GameServerState>, input: any) => unknown;
export type ServerCalls = Partial<Record<CallName, ServerCall>>;

export const sharedCalls: ServerCalls = {
    readAutomation: async () => automationView(await readAutomation()),
    writeAutomation: async (ctx: ServiceContext<GameServerState>, input: { patch: Record<string, unknown> }) => {
        if (!input?.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) throw new Error("Give the automation settings to change");
        return automationView(await writeAutomation(ctx, input.patch, restartServerInstance));
    },
    runCommand: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { command: string },
    ) => {
        const cmd = inputs?.command || "";
        await sendServerCommand(ctx, cmd);
        return `Executed: ${cmd}`;
    },
    saveWorld: async (ctx: ServiceContext<GameServerState>) => {
        await currentGameService().saveWorld(ctx);
        return true;
    },
    startServer: async (ctx: ServiceContext<GameServerState>) => {
        await startServerInstance(ctx);
        return true;
    },
    stopServer: async (ctx: ServiceContext<GameServerState>) => {
        await stopServerInstance(ctx);
        return true;
    },
    restartServer: async (ctx: ServiceContext<GameServerState>) => {
        await restartServerInstance(ctx);
        return true;
    },
    loadConfig: async (ctx) => {
        await loadServerOptions(ctx);
        return true;
    },
    sayChat: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { message: string },
    ) => {
        return sayInChat(ctx, inputs?.message);
    },
    listServerFiles: async (_ctx: ServiceContext<GameServerState>, inputs: { path?: string }) =>
        listServerFiles(inputs?.path ?? "", loaderDeps),
    readServerFile: async (_ctx: ServiceContext<GameServerState>, inputs: { path?: string }) =>
        (await currentGameService().assertFileAccess?.(_ctx, inputs?.path, false), readServerFile(inputs?.path, loaderDeps)),
    writeServerFile: async (
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
    listLogFiles: async (ctx: ServiceContext<GameServerState>) => {
        return listLogFiles(ctx);
    },
    readLogFile: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { name: string },
    ) => {
        if (!inputs?.name) throw new Error("Log file name is required");
        return readLogFile(ctx, inputs.name);
    },
};
