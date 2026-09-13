// shell/panel IPC origin boundary (bun test): shell channels answer only
// shell origins; panel:// origins get a typed refusal, never an answer
import { describe, it, expect } from "bun:test";
import {
    isPanelOrigin,
    isRefusedFrame,
    assertShellFrame,
    PANEL_IPC_REFUSED,
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

    it("answers shell origins (file:// and dev localhost)", () => {
        expect(() =>
            assertShellFrame(panelEvent("file:///app/renderer/index.html"), "computer-pair"),
        ).not.toThrow();
        expect(() =>
            assertShellFrame(panelEvent("http://localhost:5173/"), "computers-list"),
        ).not.toThrow();
        // DENY-BY-DEFAULT: an unreadable origin (no frame / no url) is
        // refused the same as a panel origin — the old fail-open default
        // ("missing frame = shell") inverted every privileged channel's
        // polarity and is refused now
        expect(() => assertShellFrame({}, "app-version")).toThrow(PANEL_IPC_REFUSED);
        expect(() => assertShellFrame({ senderFrame: null }, "app-version")).toThrow(PANEL_IPC_REFUSED);
        expect(() => assertShellFrame({ senderFrame: {} }, "app-version")).toThrow(PANEL_IPC_REFUSED);
        expect(isRefusedFrame({})).toBe(true);
        expect(isRefusedFrame({ senderFrame: {} })).toBe(true);
        expect(isRefusedFrame(panelEvent("file:///app/renderer/index.html"))).toBe(false);
    });
});
