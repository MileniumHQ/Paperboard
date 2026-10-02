// shell/panel IPC origin boundary (bun test): shell channels answer only
// shell origins; panel:// origins get a typed refusal, never an answer
import { describe, it, expect } from "bun:test";
import {
    isPanelOrigin,
    isRefusedFrame,
    assertShellFrame,
    PANEL_IPC_REFUSED,
    allowDevShellOrigin,
    keepShellNavigation,
} from "../src/main/communication/shellGuard";

const panelEvent = (url: string) => ({ senderFrame: { url } });

describe("shell IPC origin guard", () => {
    it("recognizes panel origins", () => {
        expect(isPanelOrigin("panel://local.dev.paperboard.actions/")).toBe(true);
        expect(isPanelOrigin("panel://remote-id.dev.paperboard.terminal/index.html")).toBe(true);
        expect(isPanelOrigin("panel://")).toBe(true);
        expect(isPanelOrigin("file:///app/renderer/index.html")).toBe(false);
        expect(isPanelOrigin("http://localhost:5173/")).toBe(false);
        expect(isPanelOrigin(undefined)).toBe(false);
        expect(isPanelOrigin(null)).toBe(false);
    });

    it("refuses a panel-origin frame invoking a shell channel with a typed error", () => {
        const event = panelEvent("panel://local.dev.evil.panel/");
        expect(isRefusedFrame(event)).toBe(true);
        // the audit's case: a panel iframe driving pairing
        expect(() => assertShellFrame(event, "computer-pair")).toThrow(PANEL_IPC_REFUSED);
        expect(() => assertShellFrame(event, "computer-pair")).toThrow(/shell-only/);
    });

    it("answers only the shell's own origin", () => {
        expect(() => assertShellFrame(panelEvent("paperboard://shell/index.html"), "computer-pair")).not.toThrow();
        expect(isRefusedFrame(panelEvent("paperboard://shell"))).toBe(false);
        // file:// was accepted as "the shell" before, but the shell is never
        // served from file://; a dropped or opened local HTML file is
        // exactly what must not reach crane-credentials
        for (const url of [
            "file:///app/renderer/index.html",
            "https://origami.ariapis.com/library/",
            "http://localhost:5173/",
            "paperboard://shellfake/index.html",
            "paperboard://evil/",
        ]) {
            expect(isRefusedFrame(panelEvent(url))).toBe(true);
        }
        // deny-by-default: an unreadable origin is refused like a panel
        expect(() => assertShellFrame({}, "app-version")).toThrow(PANEL_IPC_REFUSED);
        expect(() => assertShellFrame({ senderFrame: null }, "app-version")).toThrow(PANEL_IPC_REFUSED);
        expect(() => assertShellFrame({ senderFrame: {} }, "app-version")).toThrow(PANEL_IPC_REFUSED);
    });

    it("answers the dev renderer origin only once main registers it", () => {
        expect(isRefusedFrame(panelEvent("http://localhost:5199/"))).toBe(true);
        allowDevShellOrigin("http://localhost:5199/");
        expect(isRefusedFrame(panelEvent("http://localhost:5199/index.html"))).toBe(false);
        expect(isRefusedFrame(panelEvent("http://localhost:5200/"))).toBe(true);
    });
});

describe("shell window navigation", () => {
    const attempt = (url: string) => {
        let prevented = false;
        const allowed = keepShellNavigation({ preventDefault: () => { prevented = true; } }, url);
        return { allowed, prevented };
    };

    it("stays on the shell and blocks every other destination", () => {
        expect(attempt("paperboard://shell/index.html")).toEqual({ allowed: true, prevented: false });
        for (const url of ["file:///home/user/Downloads/page.html", "https://example.com/", "panel://local.dev.x/"]) {
            expect(attempt(url)).toEqual({ allowed: false, prevented: true });
        }
    });
});
