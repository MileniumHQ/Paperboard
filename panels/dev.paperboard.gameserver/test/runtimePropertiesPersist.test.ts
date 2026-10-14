// offline runtime edits are parked in panel config: an unreadable config must
// fail the apply, never be treated as empty and overwritten
import { describe, expect, mock, test } from "bun:test";

let readError: Error | null = null;
let savedConfig: Record<string, unknown> | null = null;
const configSets: Record<string, unknown>[] = [];

mock.module("@mileniumhq/paperapi", () => ({
    config: {
        get: async () => {
            if (readError) throw readError;
            return savedConfig;
        },
        set: async (value: Record<string, unknown>) => {
            configSets.push(value);
            savedConfig = value;
            return true;
        },
    },
    processApi: { write: async () => {} },
}));

const { applyRuntimeProperties } = await import("../src/service/runtimeProperties");
const offline = { state: { serverStatus: "offline" } } as any;

describe("applyRuntimeProperties offline", () => {
    test("an unreadable config fails the apply and is not overwritten", async () => {
        readError = new Error("EACCES");
        configSets.length = 0;
        await expect(applyRuntimeProperties(offline, { difficulty: "hard" })).rejects.toThrow("EACCES");
        expect(configSets).toEqual([]);
    });

    test("a missing config is created with the pending edit before the apply resolves", async () => {
        readError = null;
        savedConfig = null;
        configSets.length = 0;
        await applyRuntimeProperties(offline, { difficulty: "hard" });
        expect(configSets).toEqual([{ pendingProperties: { difficulty: "hard" } }]);
    });
});
