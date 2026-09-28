// service boot context (bun test): credentials are GRANTED at service start,
// never discovered. The in-process boot window is consume-once; the spawned
// env capture prefers the scoped token; garbage fails closed.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
    serviceBootContext,
    captureServiceBootContext,
    type ServiceBootContext,
} from "../src/boot";
import { resolvePanelId } from "../src/identity";

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
    "PAPERBOARD_PANEL_ID",
    "PAPERCRANE_PANEL_TOKEN",
    "PAPERCRANE_TOKEN",
    "PAPERCRANE_PORT",
];
const savedGlobal = (globalThis as any).__PAPERBOARD_SERVICE_BOOT;

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
    delete (globalThis as any).__PAPERBOARD_SERVICE_BOOT;
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    if (savedGlobal === undefined) delete (globalThis as any).__PAPERBOARD_SERVICE_BOOT;
    else (globalThis as any).__PAPERBOARD_SERVICE_BOOT = savedGlobal;
    (globalThis as any).__PAPERBOARD_SERVICE_BOOT = undefined;
    captureServiceBootContext();
    (globalThis as any).__PAPERBOARD_SERVICE_BOOT = undefined;
});

function publish(context: Partial<ServiceBootContext> | any): void {
    (globalThis as any).__PAPERBOARD_SERVICE_BOOT = context;
}

describe("serviceBootContext", () => {
    test("captures the in-process boot window and consumes the global", () => {
        publish({ panelId: "panel.a", token: "pcp_scoped", port: 1234 });
        const ctx = captureServiceBootContext();
        expect(ctx).toEqual({ panelId: "panel.a", token: "pcp_scoped", port: 1234 });
        // consume-once: the window is closed after capture
        expect((globalThis as any).__PAPERBOARD_SERVICE_BOOT).toBeUndefined();
        expect(serviceBootContext()).toEqual(ctx);
    });

    test("uses the scoped panel token and ignores a master token", () => {
        process.env.PAPERBOARD_PANEL_ID = "panel.b";
        process.env.PAPERCRANE_PANEL_TOKEN = "pcp_scoped";
        process.env.PAPERCRANE_TOKEN = "pc_master";
        process.env.PAPERCRANE_PORT = "999";
        const ctx = captureServiceBootContext();
        expect(ctx?.token).toBe("pcp_scoped");
        expect(ctx?.panelId).toBe("panel.b");
    });

    test("refuses to boot on the master token alone", () => {
        process.env.PAPERBOARD_PANEL_ID = "panel.b";
        process.env.PAPERCRANE_TOKEN = "pc_master";
        process.env.PAPERCRANE_PORT = "999";
        expect(captureServiceBootContext()).toBeNull();
    });

    test("refuses a malformed boot window fail-closed", () => {
        publish({ panelId: "", token: "pcp_x", port: 1234 });
        expect(captureServiceBootContext()).toBeNull();
        expect((globalThis as any).__PAPERBOARD_SERVICE_BOOT).toBeUndefined();
        expect(serviceBootContext()).toBeNull();

        publish({ panelId: "panel.c", token: "pcp_x", port: 0 });
        expect(captureServiceBootContext()).toBeNull();

        publish("garbage");
        expect(captureServiceBootContext()).toBeNull();
    });

    test("returns null when no boot source exists", () => {
        expect(captureServiceBootContext()).toBeNull();
        expect(serviceBootContext()).toBeNull();
    });
});

describe("resolvePanelId via boot context", () => {
    test("identity comes from the granted boot context, not ambient env", () => {
        (globalThis as any).window = undefined;
        publish({ panelId: "panel.granted", token: "pcp_x", port: 1234 });
        captureServiceBootContext();
        expect(resolvePanelId()).toBe("panel.granted");
    });

    test("no boot context means no identity", () => {
        (globalThis as any).window = undefined;
        captureServiceBootContext();
        expect(resolvePanelId()).toBe("");
    });
});
