// The shell's side of a panel frame's loopback redirect request (bun test):
// only well-formed messages are routed; a panel on this computer, the
// browser shell and a bad address are answered without listening; one wait
// per frame; a canceled or departed frame stops main's listener.
import { describe, expect, it } from "bun:test";
import { createFrameLoopbackRedirects, parseLoopbackRedirectMessage, type LoopbackRedirectHost } from "../src/renderer/src/lib/panelLoopbackRedirect";

// stands in for main across IPC: records calls, and holds each wait open
// until it is canceled or answered
function fakeMain(browser = false) {
    const calls: Array<{ channel: string; args: any }> = [];
    const waits = new Map<string, (result: unknown) => void>();
    const host: LoopbackRedirectHost = {
        browser: () => browser,
        invoke: async <T,>(channel: string, args: any): Promise<T> => {
            calls.push({ channel, args });
            if (channel === "panel-loopback-redirect") return new Promise<T>((resolve) => waits.set(args.requestId, resolve as (r: unknown) => void));
            if (channel === "panel-loopback-redirect-cancel") {
                waits.get(args.requestId)?.({ status: "failed", code: "canceled", message: "canceled" });
                return undefined as T;
            }
            throw new Error(`unexpected channel ${channel}`);
        },
    };
    return { host, calls, waits };
}

const URI = "http://localhost:1455/auth/callback";

describe("panel frame loopback redirect messages", () => {
    it("routes only requests and cancels with a request id", () => {
        expect(parseLoopbackRedirectMessage({ type: "paperboard:ready" })).toBeNull();
        expect(parseLoopbackRedirectMessage({ type: "paperboard:loopback-redirect", redirectUri: URI })).toBeNull();
        expect(parseLoopbackRedirectMessage({ type: "paperboard:loopback-redirect", requestId: "x".repeat(129), redirectUri: URI })).toBeNull();
        expect(parseLoopbackRedirectMessage({ type: "paperboard:loopback-redirect", requestId: "r", redirectUri: URI })).toEqual({ kind: "request", requestId: "r", redirectUri: URI });
        expect(parseLoopbackRedirectMessage({ type: "paperboard:loopback-redirect-cancel", requestId: "r" })).toEqual({ kind: "cancel", requestId: "r" });
    });
});

describe("a frame's loopback redirect", () => {
    it("answers local for a panel on this computer, without listening", async () => {
        const main = fakeMain();
        expect(await createFrameLoopbackRedirects("local", main.host).request("r", URI)).toEqual({ status: "local" });
        expect(main.calls).toHaveLength(0);
    });

    it("is unavailable in the browser shell, even for the host's own computer", async () => {
        const main = fakeMain(true);
        for (const computer of ["local", "crane"]) {
            expect(await createFrameLoopbackRedirects(computer, main.host).request("r", URI)).toMatchObject({ status: "failed", code: "unavailable" });
        }
        expect(main.calls).toHaveLength(0);
    });

    it("refuses an address that is not a loopback redirect", async () => {
        const main = fakeMain();
        const frame = createFrameLoopbackRedirects("crane", main.host);
        for (const bad of ["https://localhost:1455/cb", "http://example.com:1455/cb", "http://localhost/cb", 7]) {
            expect(await frame.request("r", bad)).toMatchObject({ status: "failed", code: "invalid-request" });
        }
        expect(main.calls).toHaveLength(0);
    });

    it("asks main to listen for a panel on another computer, one at a time, and passes on what it caught", async () => {
        const main = fakeMain();
        const frame = createFrameLoopbackRedirects("crane", main.host);
        const first = frame.request("r1", URI);
        expect(main.calls).toEqual([{ channel: "panel-loopback-redirect", args: { requestId: expect.any(String), redirectUri: URI } }]);
        // main's id is the shell's own, not the panel's
        const shellId = main.calls[0]!.args.requestId;
        expect(shellId).not.toBe("r1");
        expect(await frame.request("r2", URI)).toMatchObject({ status: "failed", code: "busy" });
        main.waits.get(shellId)!({ status: "caught", url: `${URI}?code=1` });
        expect(await first).toEqual({ status: "caught", url: `${URI}?code=1` });
        // done: the next one may wait
        const next = frame.request("r3", URI);
        expect(main.calls.filter((c) => c.channel === "panel-loopback-redirect")).toHaveLength(2);
        frame.closeAll();
        expect(await next).toMatchObject({ status: "failed", code: "canceled" });
    });

    it("stops main's listener when the panel cancels, by the shell's id", async () => {
        const main = fakeMain();
        const frame = createFrameLoopbackRedirects("crane", main.host);
        const wait = frame.request("r1", URI);
        frame.cancel("other");
        expect(main.calls).toHaveLength(1);
        frame.cancel("r1");
        expect(main.calls[1]).toEqual({ channel: "panel-loopback-redirect-cancel", args: { requestId: main.calls[0]!.args.requestId } });
        expect(await wait).toMatchObject({ status: "failed", code: "canceled" });
    });

    it("answers a failed IPC call as failed instead of leaving the panel waiting", async () => {
        const host: LoopbackRedirectHost = { browser: () => false, invoke: async () => Promise.reject(new Error("main is gone")) };
        const original = console.error;
        const logged: unknown[][] = [];
        console.error = (...args: unknown[]) => logged.push(args);
        try {
            expect(await createFrameLoopbackRedirects("crane", host).request("r", URI)).toEqual({ status: "failed", code: "failed", message: "main is gone" });
        } finally {
            console.error = original;
        }
        // and says so in the log
        expect(logged).toHaveLength(1);
    });
});
