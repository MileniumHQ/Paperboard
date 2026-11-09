import { afterEach, describe, expect, test } from "bun:test";
import { captureServiceBootContext, serviceBootContext } from "../src/boot";
import { grantedComputerId, panelAssetUrl, resolvePanelId } from "../src/identity";

const BOOT_ENV = ["PAPERBOARD_PANEL_ID", "PAPERCRANE_PANEL_TOKEN", "PAPERCRANE_PORT", "PAPERCRANE_TOKEN"];
const g = globalThis as any;

afterEach(() => {
    for (const name of BOOT_ENV) delete process.env[name];
    delete g.__PAPERBOARD_SERVICE_BOOT;
    delete g.__PAPERBOARD_CRANE;
    delete g.window;
    delete g.location;
    // leave no captured context for the next test (or file)
    captureServiceBootContext();
});

function env(values: Record<string, string>): void {
    for (const [k, v] of Object.entries(values)) process.env[k] = v;
}

// Services boot only on their scoped token.
describe("services boot only on their scoped token", () => {
    test("the in-process boot global is read once and removed, and later changes do not move it", () => {
        g.__PAPERBOARD_SERVICE_BOOT = { panelId: "dev.a", token: "pcp_a", port: 4100 };
        expect(captureServiceBootContext()).toEqual({ panelId: "dev.a", token: "pcp_a", port: 4100 });
        expect(g.__PAPERBOARD_SERVICE_BOOT).toBeUndefined();
        env({ PAPERBOARD_PANEL_ID: "dev.b", PAPERCRANE_PANEL_TOKEN: "pcp_b", PAPERCRANE_PORT: "4200" });
        g.__PAPERBOARD_SERVICE_BOOT = { panelId: "dev.c", token: "pcp_c", port: 4300 };
        expect(serviceBootContext()).toEqual({ panelId: "dev.a", token: "pcp_a", port: 4100 });
    });

    test("the spawned-service env boots on the scoped token, which wins over a master token", () => {
        env({ PAPERBOARD_PANEL_ID: "dev.a", PAPERCRANE_PANEL_TOKEN: "pcp_scoped", PAPERCRANE_PORT: "4100", PAPERCRANE_TOKEN: "master" });
        expect(captureServiceBootContext()).toEqual({ panelId: "dev.a", token: "pcp_scoped", port: 4100 });
    });

    test("a master token alone yields no context", () => {
        env({ PAPERBOARD_PANEL_ID: "dev.a", PAPERCRANE_PORT: "4100", PAPERCRANE_TOKEN: "master" });
        expect(captureServiceBootContext()).toBeNull();
        expect(serviceBootContext()).toBeNull();
    });

    test("a malformed boot context fails closed", () => {
        for (const bad of [{ panelId: "", token: "t", port: 1 }, { panelId: "dev.a", token: "", port: 1 }, { panelId: "dev.a", token: "t", port: 0 }, { panelId: "dev.a", token: "t", port: "4100" }, null]) {
            g.__PAPERBOARD_SERVICE_BOOT = bad;
            expect(captureServiceBootContext()).toBeNull();
            expect(g.__PAPERBOARD_SERVICE_BOOT).toBeUndefined();
        }
        env({ PAPERBOARD_PANEL_ID: "dev.a", PAPERCRANE_PANEL_TOKEN: "pcp", PAPERCRANE_PORT: "not-a-port" });
        expect(captureServiceBootContext()).toBeNull();
    });
});

// Panel and computer identity are granted, never inferred.
describe("panel and computer identity are granted, never inferred", () => {
    test("a page gets its identity from host injection, never from its hostname", () => {
        g.window = {};
        g.location = { protocol: "http:", host: "local.dev.spoofed.localhost:5173", hostname: "local.dev.spoofed.localhost" };
        expect(resolvePanelId()).toBe("");
        expect(() => grantedComputerId()).toThrow("Paperboard computer identity was not injected");

        g.__PAPERBOARD_CRANE = { computerId: "c-remote", panelId: "dev.real" };
        expect(resolvePanelId()).toBe("dev.real");
        expect(grantedComputerId()).toBe("c-remote");
    });

    test("a service gets its panel from the granted boot context, and a plain Node process is local with no panel", () => {
        expect(resolvePanelId()).toBe("");
        expect(grantedComputerId()).toBe("local");
        env({ PAPERBOARD_PANEL_ID: "dev.svc", PAPERCRANE_PANEL_TOKEN: "pcp", PAPERCRANE_PORT: "4100" });
        captureServiceBootContext();
        expect(resolvePanelId()).toBe("dev.svc");
    });

    test("panelAssetUrl uses the granted, possibly remote, computer and refuses a malformed panel id", () => {
        expect(panelAssetUrl("dev.icons", "./icon.png")).toBe("panel://local.dev.icons/icon.png");
        g.window = {};
        g.__PAPERBOARD_CRANE = { computerId: "c-remote", panelId: "dev.me" };
        expect(panelAssetUrl("dev.icons", "/icon.png")).toBe("panel://c-remote.dev.icons/icon.png");
        g.location = { protocol: "http:", host: "c-remote.dev.me.paperboard.localhost:5173" };
        expect(panelAssetUrl("dev.icons", "icon.png")).toBe("http://c-remote.dev.icons.paperboard.localhost:5173/icon.png");
        for (const bad of ["../evil", "a.b/c", "", "Upper"]) {
            expect(() => panelAssetUrl(bad, "icon.png")).toThrow("Invalid panel id");
        }
    });
});
