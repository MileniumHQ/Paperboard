// top-bar insets (bun test): the folder button must stay on screen on every
// platform. On macOS the overlay object exists but is hidden and reports a
// zero rect; reading that rect as geometry reserved the whole window width
// and pushed the button off the left edge.
import { describe, it, expect } from "bun:test";
import {
    leftReserve,
    rightReserve,
    MAC_TRAFFIC_LIGHT_RESERVE,
    WINDOWS_CAPTION_FALLBACK,
} from "../src/renderer/src/components/layout/titlebarInsets";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) Electron";

const hiddenOverlay = { visible: false, getTitlebarAreaRect: () => ({ x: 0, width: 0 }) };

describe("right reserve (caption buttons)", () => {
    it("reserves nothing on macOS, where the overlay is hidden", () => {
        expect(rightReserve(hiddenOverlay, 1100, MAC_UA)).toBe(0);
    });

    it("reserves exactly the caption area when the overlay is visible", () => {
        const wco = { visible: true, getTitlebarAreaRect: () => ({ x: 0, width: 962 }) };
        expect(rightReserve(wco, 1100, LINUX_UA)).toBe(138);
    });

    it("falls back to the Windows caption width without overlay geometry", () => {
        expect(rightReserve(undefined, 1100, WIN_UA)).toBe(WINDOWS_CAPTION_FALLBACK);
        expect(rightReserve(hiddenOverlay, 1100, WIN_UA)).toBe(WINDOWS_CAPTION_FALLBACK);
    });

    it("reserves nothing in a plain browser tab", () => {
        expect(rightReserve(undefined, 1100, LINUX_UA)).toBe(0);
    });

    it("reserves nothing in browser mode on any client platform", () => {
        // browser mode has no OS caption buttons: a Windows/Mac client UA
        // must not leave a 140px / traffic-light margin on the top bar
        expect(rightReserve(undefined, 1100, WIN_UA, true)).toBe(0);
        expect(rightReserve(undefined, 1100, MAC_UA, true)).toBe(0);
        expect(rightReserve(hiddenOverlay, 1100, WIN_UA, true)).toBe(0);
    });
});

describe("left reserve (traffic lights)", () => {
    it("clears the macOS traffic lights when the overlay is hidden", () => {
        expect(leftReserve(hiddenOverlay, MAC_UA)).toBe(MAC_TRAFFIC_LIGHT_RESERVE);
    });

    it("follows a visible overlay that starts right of the edge", () => {
        const wco = { visible: true, getTitlebarAreaRect: () => ({ x: 70, width: 900 }) };
        expect(leftReserve(wco, MAC_UA)).toBe(82);
    });

    it("hugs the edge elsewhere", () => {
        expect(leftReserve(undefined, LINUX_UA)).toBe(12);
    });

    it("hugs the edge in browser mode even on a Mac client", () => {
        expect(leftReserve(hiddenOverlay, MAC_UA, true)).toBe(12);
        expect(leftReserve(undefined, MAC_UA, true)).toBe(12);
    });
});
