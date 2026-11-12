import { assertSingleLine } from "../core/players";
import { files as fileApi, backupApi, type ServiceContext } from "./api";
import type { GameServerState } from "./types";
import { CALLS, PANEL_ID } from "./contract";
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
/** What a server's calls are: the page asks by name, and each is handed the server's context and the rest of the input. */
export type ServerCall = (ctx: ServiceContext<GameServerState>, input: any) => unknown;
export type ServerCalls = Record<string, ServerCall>;

export const sharedCalls: ServerCalls = {
    [CALLS.readAutomation]: async () => automationView(await readAutomation()),
    [CALLS.writeAutomation]: async (ctx: ServiceContext<GameServerState>, input: { patch: Record<string, unknown> }) => {
        if (!input?.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) throw new Error("Give the automation settings to change");
        return automationView(await writeAutomation(ctx, input.patch, restartServerInstance));
    },
    [CALLS.runCommand]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { command: string },
    ) => {
        const cmd = inputs?.command || "";
        await sendServerCommand(ctx, cmd);
        return `Executed: ${cmd}`;
    },
    [CALLS.saveWorld]: async (ctx: ServiceContext<GameServerState>) => {
        await currentGameService().saveWorld(ctx);
        return true;
    },
    [CALLS.startServer]: async (ctx: ServiceContext<GameServerState>) => {
        await startServerInstance(ctx);
        return true;
    },
    [CALLS.stopServer]: async (ctx: ServiceContext<GameServerState>) => {
        await stopServerInstance(ctx);
        return true;
    },
    [CALLS.restartServer]: async (ctx: ServiceContext<GameServerState>) => {
        await restartServerInstance(ctx);
        return true;
    },
    [CALLS.loadConfig]: async (ctx) => {
        await loadServerOptions(ctx);
        return true;
    },
    [CALLS.sayChat]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { message: string },
    ) => {
        return sayInChat(ctx, inputs?.message);
    },
    [CALLS.listServerFiles]: async (_ctx: ServiceContext<GameServerState>, inputs: { path?: string }) =>
        listServerFiles(inputs?.path ?? "", loaderDeps),
    [CALLS.readServerFile]: async (_ctx: ServiceContext<GameServerState>, inputs: { path?: string }) =>
        (await currentGameService().assertFileAccess?.(_ctx, inputs?.path, false), readServerFile(inputs?.path, loaderDeps)),
    [CALLS.writeServerFile]: async (
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
    [CALLS.listLogFiles]: async (ctx: ServiceContext<GameServerState>) => {
        return listLogFiles(ctx);
    },
    [CALLS.readLogFile]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { name: string },
    ) => {
        if (!inputs?.name) throw new Error("Log file name is required");
        return readLogFile(ctx, inputs.name);
    },
};
