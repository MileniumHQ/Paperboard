// The embed contract: a direct browser load must stay a plain download
// page, and an embedded library must install only through the shell's
// answer. Timers are faked so the bounds are tested, not waited on.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createLibraryBridge, type BridgeHost } from "../src/bridge";

function createFakeHost() {
    const sent: any[] = [];
    let listener: ((data: unknown) => void) | null = null;
    const host: BridgeHost = {
        send(data) {
            sent.push(data);
        },
        listen(callback) {
            listener = callback;
            return () => {
                listener = null;
            };
        },
    };
    return {
        host,
        sent,
        receive(data: unknown) {
            if (!listener) throw new Error("bridge is not listening");
            listener(data);
        },
        isListening: () => listener !== null,
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("createLibraryBridge", () => {
    test("a top-level page is standalone and never installs", async () => {
        const bridge = createLibraryBridge(null);
        expect(bridge.mode()).toBe("standalone");
        expect(await bridge.install("panel.a")).toEqual({
            ok: false,
            error: "Paperboard is not connected",
        });
        bridge.dispose();
    });

    test("hello goes out on creation; connected enables the install round-trip", async () => {
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host, {
            handshakeTimeoutMs: 50,
        });
        expect(fake.sent[0]).toEqual({ type: "paperboard:library-hello" });

        fake.receive({
            type: "paperboard:library-connected",
            theme: "dark",
            installed: [{ id: "panel.a", name: "A", version: "1.0.0" }],
        });
        expect(bridge.mode()).toBe("embedded");
        expect(bridge.theme()).toBe("dark");
        expect(bridge.installed()).toHaveLength(1);

        const result = bridge.install("panel.a");
        const request = fake.sent.find(
            (m) => m.type === "paperboard:library-install",
        );
        expect(request).toMatchObject({
            type: "paperboard:library-install",
            panelId: "panel.a",
        });
        fake.receive({
            type: "paperboard:library-install-result",
            requestId: request.requestId,
            panelId: "panel.a",
            ok: true,
        });
        expect(await result).toEqual({ ok: true, error: undefined });

        bridge.open("panel.a");
        expect(fake.sent).toContainEqual({
            type: "paperboard:library-open",
            panelId: "panel.a",
        });
        bridge.dispose();
    });

    test("no answer before the handshake bound means standalone", () => {
        vi.useFakeTimers();
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host, {
            handshakeTimeoutMs: 50,
        });
        expect(bridge.mode()).toBe("detecting");
        vi.advanceTimersByTime(51);
        expect(bridge.mode()).toBe("standalone");
        bridge.dispose();
    });

    test("a late handshake still wins over the timeout", () => {
        vi.useFakeTimers();
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host, {
            handshakeTimeoutMs: 50,
        });
        vi.advanceTimersByTime(51);
        expect(bridge.mode()).toBe("standalone");
        fake.receive({ type: "paperboard:library-connected" });
        expect(bridge.mode()).toBe("embedded");
        bridge.dispose();
    });

    test("installed state is filtered to valid panel identities; theme follows", () => {
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host);
        fake.receive({
            type: "paperboard:library-installed",
            theme: "dark",
            installed: [
                { id: "panel.a", name: "A" },
                { id: "library", name: "reserved" },
                { id: "no spaces", name: "bad" },
                { id: "panel.b" },
                "nope",
            ],
        });
        expect(bridge.installed().map((p) => p.id)).toEqual(["panel.a"]);
        expect(bridge.theme()).toBe("dark");
        bridge.dispose();
    });

    test("an unanswered install resolves as a typed failure at the bound", async () => {
        vi.useFakeTimers();
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host, {
            installTimeoutMs: 100,
        });
        fake.receive({ type: "paperboard:library-connected" });
        const result = bridge.install("panel.a");
        await vi.advanceTimersByTimeAsync(101);
        expect(await result).toEqual({
            ok: false,
            error: "Paperboard did not answer the install request",
        });
        bridge.dispose();
    });

    test("dispose detaches and answers anything still pending", async () => {
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host);
        fake.receive({ type: "paperboard:library-connected" });
        const result = bridge.install("panel.a");
        bridge.dispose();
        expect(await result).toEqual({
            ok: false,
            error: "The panel library was unloaded",
        });
        expect(fake.isListening()).toBe(false);
    });
});
