// catchLoopbackRedirect (bun test): the panel side of the shell catching a
// sign-in redirect, against a stand-in window. A bad address is refused
// before asking; the shell's answer resolves or rejects with its code; an
// abort or the page going away tells the shell to stop, for this request.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { catchLoopbackRedirect, LoopbackRedirectError } from "../src/loopback";
import { setFrameSession } from "../src/frameSession";

type Listener = (event: { source: unknown; data: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
const posted: any[] = [];
const parent = { postMessage: (message: unknown) => posted.push(message) };
const savedWindow = (globalThis as any).window;
const URI = "http://localhost:1455/auth/callback";

function fire(type: string, event: { source: unknown; data: unknown } = { source: null, data: null }) {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
}
const reply = (data: unknown, source: unknown = parent) => fire("message", { source, data });

async function rejection(promise: Promise<unknown>): Promise<LoopbackRedirectError> {
    try {
        await promise;
    } catch (err) {
        if (err instanceof LoopbackRedirectError) return err;
        throw err;
    }
    throw new Error("expected a rejection");
}

beforeEach(() => {
    listeners.clear();
    posted.length = 0;
    (globalThis as any).window = {
        parent,
        addEventListener: (type: string, fn: Listener) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
        },
        removeEventListener: (type: string, fn: Listener) => listeners.get(type)?.delete(fn),
    };
    setFrameSession({ generation: "gen-1", widget: false, computerName: null });
});

afterEach(() => {
    (globalThis as any).window = savedWindow;
});

const open = () => (listeners.get("message")?.size ?? 0) + (listeners.get("pagehide")?.size ?? 0);

describe("catching a loopback redirect", () => {
    it("asks the shell with this frame's generation and resolves what it caught", async () => {
        const result = catchLoopbackRedirect(URI);
        expect(posted).toHaveLength(1);
        const { requestId } = posted[0];
        expect(typeof requestId).toBe("string");
        expect(posted[0]).toEqual({ type: "paperboard:loopback-redirect", generation: "gen-1", requestId, redirectUri: URI });
        // only this request's answer, from the parent, for this generation
        reply({ type: "paperboard:loopback-redirect-result", generation: "gen-1", requestId: "other", result: { status: "local" } });
        reply({ type: "paperboard:loopback-redirect-result", generation: "gen-0", requestId, result: { status: "local" } });
        reply({ type: "paperboard:loopback-redirect-result", generation: "gen-1", requestId, result: { status: "local" } }, {});
        reply({ type: "paperboard:loopback-redirect-result", generation: "gen-1", requestId, result: { status: "caught", url: `${URI}?code=1&state=s` } });
        expect(await result).toEqual({ status: "caught", url: `${URI}?code=1&state=s` });
        expect(open()).toBe(0);
    });

    it("resolves local when the panel runs on this device", async () => {
        const result = catchLoopbackRedirect(URI);
        reply({ type: "paperboard:loopback-redirect-result", generation: "gen-1", requestId: posted[0].requestId, result: { status: "local" } });
        expect(await result).toEqual({ status: "local" });
    });

    it("rejects with the shell's code and message, and a malformed answer as failed", async () => {
        for (const code of ["unavailable", "in-use", "busy", "canceled", "timeout", "failed", "invalid-request"] as const) {
            posted.length = 0;
            const result = catchLoopbackRedirect(URI);
            reply({ type: "paperboard:loopback-redirect-result", generation: "gen-1", requestId: posted[0].requestId, result: { status: "failed", code, message: `m-${code}` } });
            const err = await rejection(result);
            expect([err.code, err.message]).toEqual([code, `m-${code}`]);
        }
        for (const bad of [{ status: "caught" }, { status: "failed", code: "weird", message: "x" }, null]) {
            posted.length = 0;
            const result = catchLoopbackRedirect(URI);
            reply({ type: "paperboard:loopback-redirect-result", generation: "gen-1", requestId: posted[0].requestId, result: bad });
            expect((await rejection(result)).code).toBe("failed");
        }
    });

    it("refuses an address that is not a loopback redirect without asking", async () => {
        for (const bad of ["https://localhost:1455/cb", "http://example.com:1455/cb", "http://localhost/cb", "http://localhost:80/cb", "http://localhost:1455/cb#x", ""]) {
            expect((await rejection(catchLoopbackRedirect(bad))).code).toBe("invalid-request");
        }
        expect(posted).toHaveLength(0);
    });

    it("tells the shell to stop when the signal aborts, and rejects canceled", async () => {
        const controller = new AbortController();
        const result = catchLoopbackRedirect(URI, { signal: controller.signal });
        controller.abort();
        expect((await rejection(result)).code).toBe("canceled");
        expect(posted[1]).toEqual({ type: "paperboard:loopback-redirect-cancel", generation: "gen-1", requestId: posted[0].requestId });
        expect(open()).toBe(0);
        // an already aborted signal never asks
        posted.length = 0;
        expect((await rejection(catchLoopbackRedirect(URI, { signal: controller.signal }))).code).toBe("canceled");
        expect(posted).toHaveLength(0);
    });

    it("tells the shell to stop when the page goes away", () => {
        // the page is gone, so nothing is left to settle for
        void catchLoopbackRedirect(URI);
        fire("pagehide");
        expect(posted[1]).toEqual({ type: "paperboard:loopback-redirect-cancel", generation: "gen-1", requestId: posted[0].requestId });
        expect(open()).toBe(0);
    });

    it("waits for one redirect at a time, and is unavailable in a widget", async () => {
        const controller = new AbortController();
        const first = catchLoopbackRedirect(URI, { signal: controller.signal });
        expect((await rejection(catchLoopbackRedirect(URI))).code).toBe("busy");
        controller.abort();
        await rejection(first);
        setFrameSession({ generation: "gen-1", widget: true, computerName: null });
        expect((await rejection(catchLoopbackRedirect(URI))).code).toBe("unavailable");
    });
});
