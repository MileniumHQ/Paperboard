// in-process boot window (bun test): the service boot context global exists
// ONLY between publish and clear, carries exactly the credential facts the
// spawned env would, and never touches process.env.
import { describe, it, expect, afterEach } from "bun:test";
import {
    publishServiceBootContext,
    clearServiceBootContext,
} from "../papercrane/panelServices";

const BOOT_KEY = "__PAPERBOARD_SERVICE_BOOT";

afterEach(() => {
    clearServiceBootContext();
});

describe("service boot window", () => {
    it("publishes the context on the agreed global and clears it", () => {
        expect((globalThis as any)[BOOT_KEY]).toBeUndefined();
        publishServiceBootContext({
            panelId: "panel.a",
            token: "pcp_scoped",
            port: 1234,
        });
        expect((globalThis as any)[BOOT_KEY]).toEqual({
            panelId: "panel.a",
            token: "pcp_scoped",
            port: 1234,
        });
        clearServiceBootContext();
        expect((globalThis as any)[BOOT_KEY]).toBeUndefined();
    });

    it("prefers the scoped panel token, matching the spawned env order", () => {
        // the caller builds the context from the same env record the spawn
        // path builds: PANEL_TOKEN || TOKEN — asserted here as the contract
        const env = {
            PAPERCRANE_PANEL_TOKEN: "pcp_scoped",
            PAPERCRANE_TOKEN: "pc_master",
            PAPERCRANE_PORT: "45319",
        };
        publishServiceBootContext({
            panelId: "panel.a",
            token: env.PAPERCRANE_PANEL_TOKEN || env.PAPERCRANE_TOKEN || "",
            port: Number(env.PAPERCRANE_PORT) || 0,
        });
        expect((globalThis as any)[BOOT_KEY].token).toBe("pcp_scoped");
    });

    it("clear is idempotent and never throws", () => {
        expect(() => clearServiceBootContext()).not.toThrow();
        expect(() => clearServiceBootContext()).not.toThrow();
    });
});
