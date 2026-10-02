// The shell accepts installs from a REMOTE iframe, so the message boundary
// is security-relevant: sender window, origin, and panel identity are all
// checked before a request can reach the daemon install path.
import { describe, it, expect } from "bun:test";
import { libraryFramePhase, parseLibraryMessage } from "../src/renderer/src/lib/libraryFrame";

const ORIGIN = "https://origami.ariapis.com";
const sourceWindow = {} as Window;
const identity = { sourceWindow, origin: ORIGIN };

function event(overrides: Record<string, unknown> = {}) {
    return { source: sourceWindow, origin: ORIGIN, data: null, ...overrides };
}

describe("library frame message boundary", () => {
    it("accepts hello from its own frame and origin, carrying the ready capability", () => {
        expect(
            parseLibraryMessage(
                event({ data: { type: "paperboard:library-hello" } }),
                identity,
            ),
        ).toEqual({ type: "paperboard:library-hello", ready: false });
        expect(
            parseLibraryMessage(
                event({ data: { type: "paperboard:library-hello", ready: true } }),
                identity,
            ),
        ).toEqual({ type: "paperboard:library-hello", ready: true });
    });

    it("accepts library-ready only from its own frame and origin", () => {
        expect(
            parseLibraryMessage(
                event({ data: { type: "paperboard:library-ready" } }),
                identity,
            ),
        ).toEqual({ type: "paperboard:library-ready" });
        const other = {} as Window;
        expect(
            parseLibraryMessage(
                event({ source: other, data: { type: "paperboard:library-ready" } }),
                identity,
            ),
        ).toBeNull();
    });

    it("refuses a message from another window", () => {
        const other = {} as Window;
        expect(
            parseLibraryMessage(
                event({
                    source: other,
                    data: { type: "paperboard:library-install", requestId: "r", panelId: "panel.a" },
                }),
                identity,
            ),
        ).toBeNull();
    });

    it("refuses a message from another origin", () => {
        expect(
            parseLibraryMessage(
                event({
                    origin: "https://evil.example",
                    data: { type: "paperboard:library-install", requestId: "r", panelId: "panel.a" },
                }),
                identity,
            ),
        ).toBeNull();
    });

    it("refuses an install with an invalid or reserved panel id", () => {
        for (const panelId of ["library", "settings", "landing", "UPPER", "a..b", ""]) {
            expect(
                parseLibraryMessage(
                    event({
                        data: { type: "paperboard:library-install", requestId: "r", panelId },
                    }),
                    identity,
                ),
            ).toBeNull();
        }
    });

    it("refuses an install without a request id", () => {
        expect(
            parseLibraryMessage(
                event({ data: { type: "paperboard:library-install", panelId: "panel.a" } }),
                identity,
            ),
        ).toBeNull();
    });

    it("accepts first-party dotted ids for install and open", () => {
        expect(
            parseLibraryMessage(
                event({
                    data: {
                        type: "paperboard:library-install",
                        requestId: "r-1",
                        panelId: "dev.paperboard.terminal",
                    },
                }),
                identity,
            ),
        ).toEqual({
            type: "paperboard:library-install",
            requestId: "r-1",
            panelId: "dev.paperboard.terminal",
        });
        expect(
            parseLibraryMessage(
                event({
                    data: { type: "paperboard:library-open", panelId: "dev.paperboard.ai" },
                }),
                identity,
            ),
        ).toEqual({ type: "paperboard:library-open", panelId: "dev.paperboard.ai" });
    });

    it("ignores unknown message types and malformed payloads", () => {
        expect(parseLibraryMessage(event({ data: { type: "paperboard:run-anything" } }), identity)).toBeNull();
        expect(parseLibraryMessage(event({ data: "hello" }), identity)).toBeNull();
        expect(parseLibraryMessage(event(), identity)).toBeNull();
    });
});

describe("library media requests", () => {
    it("accepts a media request by panel id only, never by path", () => {
        expect(
            parseLibraryMessage(
                event({
                    data: {
                        type: "paperboard:library-media",
                        requestId: "m1",
                        panelId: "dev.paperboard.ai",
                        full: true,
                        path: "../../etc/passwd",
                    },
                }),
                identity,
            ),
        ).toEqual({
            type: "paperboard:library-media",
            requestId: "m1",
            panelId: "dev.paperboard.ai",
            full: true,
        });
        expect(
            parseLibraryMessage(
                event({ data: { type: "paperboard:library-media", requestId: "m2", panelId: "../x" } }),
                identity,
            ),
        ).toBeNull();
        expect(
            parseLibraryMessage(
                event({ data: { type: "paperboard:library-media", panelId: "dev.paperboard.ai" } }),
                identity,
            ),
        ).toBeNull();
    });
});

describe("library frame reveal gate", () => {
    it("covers the frame until a capable library is connected AND ready", () => {
        // nothing yet: the library has not even said hello
        expect(
            libraryFramePhase({ connected: false, ready: false, readyCapable: true, failure: false }),
        ).toBe("loading");
        // connected is not loaded; the library is still reading its registry
        expect(
            libraryFramePhase({ connected: true, ready: false, readyCapable: true, failure: false }),
        ).toBe("loading");
        // both: the only state that reveals the iframe
        expect(
            libraryFramePhase({ connected: true, ready: true, readyCapable: true, failure: false }),
        ).toBe("ready");
    });

    it("reveals a legacy library on connect, since it promises no ready signal", () => {
        expect(
            libraryFramePhase({ connected: true, ready: false, readyCapable: false, failure: false }),
        ).toBe("ready");
        expect(
            libraryFramePhase({ connected: false, ready: false, readyCapable: false, failure: false }),
        ).toBe("loading");
    });

    it("a failure wins over any loading or ready state", () => {
        expect(
            libraryFramePhase({ connected: true, ready: true, readyCapable: true, failure: true }),
        ).toBe("failed");
        expect(
            libraryFramePhase({ connected: true, ready: false, readyCapable: true, failure: true }),
        ).toBe("failed");
    });
});
