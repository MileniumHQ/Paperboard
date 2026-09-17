// identity resolution: injected > hostname > granted boot context
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { grantedComputerId, resolvePanelId, resolveDefaultPanelId } from "../src/identity";
import { captureServiceBootContext } from "../src/boot";

describe("resolvePanelId", () => {
    const savedWindow = (globalThis as any).window;
    const savedCrane = (globalThis as any).__PAPERBOARD_CRANE;
    const savedEnv = process.env.PAPERBOARD_PANEL_ID;

    function setWindowHostname(hostname: string): void {
        (globalThis as any).window = {
            location: { hostname },
        };
    }

    beforeEach(() => {
        delete process.env.PAPERBOARD_PANEL_ID;
        (globalThis as any).__PAPERBOARD_CRANE = undefined;
        (globalThis as any).window = undefined;
        captureServiceBootContext();
    });

    afterEach(() => {
        (globalThis as any).window = savedWindow;
        (globalThis as any).__PAPERBOARD_CRANE = savedCrane;
        if (savedEnv === undefined) delete process.env.PAPERBOARD_PANEL_ID;
        else process.env.PAPERBOARD_PANEL_ID = savedEnv;
        captureServiceBootContext();
    });

    test("explicitly injected panelId wins over hostname and boot context", () => {
        setWindowHostname("panel.myhost.local");
        (globalThis as any).__PAPERBOARD_CRANE = { panelId: "panel.injected" };
        process.env.PAPERBOARD_PANEL_ID = "panel.env";
        captureServiceBootContext();
        expect(resolvePanelId()).toBe("panel.injected");
    });

    test("a hostname never grants panel identity", () => {
        setWindowHostname("panel.myhost.local");
        const id = resolvePanelId();
        expect(id).toBe("");
        expect(typeof id).toBe("string");
    });

    test("the granted boot context is used only outside a document context", () => {
        (globalThis as any).window = undefined;
        process.env.PAPERBOARD_PANEL_ID = "panel.env";
        process.env.PAPERCRANE_PORT = "999";
        process.env.PAPERCRANE_PANEL_TOKEN = "pcp_x";
        captureServiceBootContext();
        expect(resolvePanelId()).toBe("panel.env");
    });

    test("returns empty string when no identity source exists", () => {
        (globalThis as any).window = undefined;
        expect(resolvePanelId()).toBe("");
    });

    test("resolveDefaultPanelId prefers the transport panelId", () => {
        setWindowHostname("panel.myhost.local");
        expect(resolveDefaultPanelId("transport.panel")).toBe("transport.panel");
        expect(resolveDefaultPanelId(undefined)).toBe("");
    });
});

describe("granted computer identity", () => {
    const savedLocation = (globalThis as any).location;

    afterEach(() => {
        (globalThis as any).location = savedLocation;
    });

    test("computer scope comes from injection, not the hostname prefix", () => {
        (globalThis as any).location = { hostname: "alpha.myhost.local" };
        const previous = (globalThis as any).__PAPERBOARD_CRANE;
        try {
            (globalThis as any).__PAPERBOARD_CRANE = { computerId: "granted" };
            expect(grantedComputerId()).toBe("granted");
        } finally { (globalThis as any).__PAPERBOARD_CRANE = previous; }
    });

    test("falls back to local without a document", () => {
        (globalThis as any).location = undefined;
        expect(grantedComputerId()).toBe("local");
    });
});
