import type { Server } from "./server";
import { assertSingleLine } from "../core/players";

import type { CallInput, CallOutput } from "@mileniumhq/paperapi";
import type { CallName, gameServerContract } from "./contract";
import { startServerInstance, stopServerInstance, restartServerInstance, sendServerCommand, sendChatMessage } from "./lifecycle";
import { listServerFiles, readServerFile, writeServerFile } from "./serverFiles";
import { listLogFiles, readLogFile } from "./logs";
import { loadServerOptions } from "./options";
import { automationView, readAutomation, writeAutomation } from "./automation";
const loaderDeps = (ctx: Server) => ({ serverDir: () => ctx.root() });
/** Says a message in the game's chat; one line, so it can't carry a second console command. */
export async function sayInChat(ctx: Server, message: unknown): Promise<string> {
    const msg = assertSingleLine(String(message ?? "").trim(), "chat message", 500);
    if (!msg) throw new Error("Message is required");
    await sendChatMessage(ctx, msg);
    return msg;
}
type Calls = (typeof gameServerContract)["calls"];
/**
 * One of the contract's calls, as a server's game answers it and its blocks
 * run it: handed the server and the call's input, which the contract checked
 * when a page made the call, and giving the contract's answer.
 */
export type ServerCall<K extends CallName> = (ctx: Server, input: CallInput<Calls[K]>) => CallOutput<Calls[K]> | Promise<CallOutput<Calls[K]>>;
/** The calls a server's game answers; a call it leaves out is refused for its servers. */
export type ServerCalls = { [K in CallName]?: ServerCall<K> };

export const sharedCalls: ServerCalls = {
    readAutomation: async (ctx) => automationView(ctx, readAutomation(ctx)),
    writeAutomation: async (ctx: Server, input: { patch: Record<string, unknown> }) => {
        if (!input?.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) throw new Error("Give the automation settings to change");
        return automationView(ctx, await writeAutomation(ctx, input.patch, restartServerInstance));
    },
    runCommand: async (
        ctx: Server,
        inputs: { command: string },
    ) => {
        const cmd = inputs?.command || "";
        await sendServerCommand(ctx, cmd);
        return `Executed: ${cmd}`;
    },
    saveWorld: async (ctx: Server) => {
        await ctx.game.saveWorld();
        return true;
    },
    startServer: async (ctx: Server) => {
        await startServerInstance(ctx);
        return true;
    },
    stopServer: async (ctx: Server) => {
        await stopServerInstance(ctx);
        return true;
    },
    restartServer: async (ctx: Server) => {
        await restartServerInstance(ctx);
        return true;
    },
    loadConfig: async (ctx) => {
        await loadServerOptions(ctx);
        return true;
    },
    sayChat: async (
        ctx: Server,
        inputs: { message: string },
    ) => {
        return sayInChat(ctx, inputs?.message);
    },
    listServerFiles: async (ctx: Server, inputs: { path?: string }) =>
        listServerFiles(inputs?.path ?? "", loaderDeps(ctx)),
    readServerFile: async (ctx: Server, inputs: { path?: string }) =>
        (await ctx.game.assertFileAccess?.(inputs?.path, false), readServerFile(inputs?.path, loaderDeps(ctx))),
    writeServerFile: async (
        ctx: Server,
        inputs: { path?: string; text?: string; version?: string },
    ) => {
        if (ctx.game.isMutating()) {
            throw new Error("A server install is running; save files once it finishes.");
        }
        await ctx.game.assertFileAccess?.(inputs?.path, true);
        const running = ctx.state.serverStatus !== "offline";
        return writeServerFile(inputs?.path, inputs?.text, inputs?.version, running, loaderDeps(ctx));
    },
    listLogFiles: async (ctx: Server) => {
        return listLogFiles(ctx);
    },
    readLogFile: async (
        ctx: Server,
        inputs: { name: string },
    ) => {
        if (!inputs?.name) throw new Error("Log file name is required");
        return readLogFile(ctx, inputs.name);
    },
};
