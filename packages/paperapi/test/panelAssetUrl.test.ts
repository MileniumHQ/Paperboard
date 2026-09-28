// panelAssetUrl: a sibling panel's asset address follows the host the
// document runs in (Electron panel://, browser-mode *.localhost subdomains)
// and the GRANTED computer — a remote computer's panel must not load the
// local machine's icons.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { panelAssetUrl } from "../src/identity";

const saved = { crane: (globalThis as any).__PAPERBOARD_CRANE, window: (globalThis as any).window, location: (globalThis as any).location };

function inject(computerId: string, panelId: string, href: string) {
    (globalThis as any).__PAPERBOARD_CRANE = { computerId, panelId };
    const url = new URL(href);
    (globalThis as any).window = {};
    (globalThis as any).location = { protocol: url.protocol, host: url.host, hostname: url.hostname };
}

describe("panelAssetUrl", () => {
    beforeEach(() => inject("local", "dev.paperboard.actions", "panel://local.dev.paperboard.actions/index.html"));
    afterEach(() => {
        (globalThis as any).__PAPERBOARD_CRANE = saved.crane;
        (globalThis as any).window = saved.window;
        (globalThis as any).location = saved.location;
    });

    test("Electron: panel:// on the granted computer", () => {
        expect(panelAssetUrl("dev.paperboard.gameserver", "./branding/icon.png")).toBe(
            "panel://local.dev.paperboard.gameserver/branding/icon.png",
        );
    });

    test("uses the granted remote computer, not local", () => {
        inject("remote-17-abc", "dev.paperboard.actions", "panel://remote-17-abc.dev.paperboard.actions/");
        expect(panelAssetUrl("dev.paperboard.gameserver", "icon.png")).toBe(
            "panel://remote-17-abc.dev.paperboard.gameserver/icon.png",
        );
    });

    test("browser mode: the sibling's subdomain of the same shell host", () => {
        inject("local", "dev.paperboard.actions", "http://local.dev.paperboard.actions.paperboard.localhost:47811/");
        expect(panelAssetUrl("dev.paperboard.gameserver", "/branding/icon.png")).toBe(
            "http://local.dev.paperboard.gameserver.paperboard.localhost:47811/branding/icon.png",
        );
    });

    test("refuses a malformed panel id instead of building a URL from it", () => {
        expect(() => panelAssetUrl("../evil", "x")).toThrow();
        expect(() => panelAssetUrl("a.b/c", "x")).toThrow();
    });
});
