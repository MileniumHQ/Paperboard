// What Team Fortress 2's server prints about a Workshop item it could not sync reaches the console as a failure,
// through the service's own console line handling (the lines are the ones the dedicated server printed, build 11191711).
import { afterAll, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-source-console-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

mock.module("../src/service/api", () => ({
    ...paperapi,
    files: { getPath: async () => path.join(root, "server") },
    config: { get: async () => ({}), set: async () => true },
    processApi: { exists: async () => false, kill: async () => true, onData: () => () => {}, onExit: () => () => {}, start: async () => true },
}));
mock.module("@mileniumhq/paperapi", () => ({
    ...paperapi,
    fileApi: { getPath: async (...parts: string[]) => path.join(root, ...parts) },
    secretsApi: { get: async () => ({ found: true, value: "rcon-secret" }), set: async () => true, delete: async () => true },
}));
await import("../src/games/service");
const { sourceService } = await import("../src/games/source/service");
const { tf2, TF2 } = await import("../src/games/tf2");
const { inServer } = await import("../src/service/scope");

const service = sourceService(TF2, tf2);
const state: Record<string, unknown> = { serverEntries: [] };
const ctx: any = { state, setState: (patch: any) => Object.assign(state, typeof patch === "function" ? patch(state) : patch), emitTrigger: () => {} };
const scope: any = { server: { id: "s-console", game: TF2.id, directory: "" }, locals: new Map() };

test("what the server prints about a Workshop item that would not sync reaches the console as errors", async () => {
    const lines = ["[TF Workshop] Preparing map ID 148063940", "[TF Workshop] Tracked map 148063940 has no filename and will not sync", "[TF Workshop] Map failed to sync, load will not go well :(", "Unable to change level!"];
    inServer(scope, () => { for (const line of lines) service.observeLine!(ctx, line); });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((state.serverEntries as any[]).map((e) => `${e.type}: ${e.content}`)).toEqual(["info: " + lines[0], "error: " + lines[1], "error: " + lines[2], "error: " + lines[3]]);
});

