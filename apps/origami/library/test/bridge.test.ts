import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createLibraryBridge } from "../src/bridge";
import { shell, type Shell } from "./helpers/shell";

let host: Shell;

beforeEach(() => {
    vi.useFakeTimers();
    host = shell();
});

afterEach(() => {
    vi.useRealTimers();
});

// Only an embedding Paperboard can install, and only valid identities count as installed.
describe("only an embedding Paperboard can install, and only valid identities count as installed", () => {
    test("with no host the library is standalone and an install is refused", async () => {
        const bridge = createLibraryBridge(null);
        expect(bridge.mode()).toBe("standalone");
        expect(await bridge.install("dev.example.clock")).toEqual({ ok: false, error: "Paperboard is not connected" });
        bridge.dispose();
    });

    test("a host that never answers leaves the library standalone, and installs are refused", async () => {
        const bridge = createLibraryBridge(host, { handshakeTimeoutMs: 2_000 });
        expect(host.sent).toEqual([{ type: "paperboard:library-hello", ready: true }]);
        expect(bridge.mode()).toBe("detecting");
        expect((await bridge.install("dev.example.clock")).ok).toBe(false);
        vi.advanceTimersByTime(2_000);
        expect(bridge.mode()).toBe("standalone");
        expect((await bridge.install("dev.example.clock")).ok).toBe(false);
        // nothing but the hello ever reached the host
        expect(host.sent).toHaveLength(1);
        bridge.dispose();
    });

    test("a connected answer switches to embedded, even after the handshake timeout fell back", () => {
        const bridge = createLibraryBridge(host, { handshakeTimeoutMs: 2_000 });
        vi.advanceTimersByTime(2_000);
        expect(bridge.mode()).toBe("standalone");
        host.reply({ type: "paperboard:library-connected", theme: "dark", installed: [] });
        expect(bridge.mode()).toBe("embedded");
        expect(bridge.theme()).toBe("dark");
        bridge.dispose();
    });

    test("malformed, reserved and invalid installed entries are dropped", () => {
        const bridge = createLibraryBridge(host);
        host.reply({
            type: "paperboard:library-connected",
            installed: [
                { id: "dev.example.clock", name: "Clock" },
                { id: "library", name: "The library itself" },
                { id: "settings", name: "Settings" },
                { id: "shell-sidebar", name: "Shell" },
                { id: "../escape", name: "Escape" },
                { id: "Dev.Upper", name: "Upper" },
                { id: "dev.example.noname" },
                { id: 42, name: "Numeric" },
                null,
                "dev.example.string",
                { name: "No id" },
            ],
        });
        expect(bridge.installed().map((p) => p.id)).toEqual(["dev.example.clock"]);
        // a later list replaces it under the same rules
        host.reply({ type: "paperboard:library-installed", installed: [{ id: "library", name: "x" }, { id: "dev.example.notes", name: "Notes" }] });
        expect(bridge.installed().map((p) => p.id)).toEqual(["dev.example.notes"]);
        bridge.dispose();
    });

    test("an invalid panel id is never sent to the shell", async () => {
        const bridge = createLibraryBridge(host);
        host.reply({ type: "paperboard:library-connected", installed: [] });
        expect(await bridge.install("../../etc")).toEqual({ ok: false, error: "Invalid panel id" });
        expect(await bridge.install("library")).toEqual({ ok: false, error: "Invalid panel id" });
        expect(host.sent.filter((m) => m.type === "paperboard:library-install")).toEqual([]);
        bridge.dispose();
    });
});

// Installs round-trip through the shell, with a bound, and failures are shown.
describe("installs round-trip through the shell, with a bound", () => {
    function embedded(installTimeoutMs?: number) {
        const bridge = createLibraryBridge(host, { installTimeoutMs });
        host.reply({ type: "paperboard:library-connected", installed: [] });
        return bridge;
    }

    test("an install resolves on the result that matches its request", async () => {
        const bridge = embedded();
        const first = bridge.install("dev.example.clock");
        const second = bridge.install("dev.example.notes");
        const [a, b] = host.sent.filter((m) => m.type === "paperboard:library-install");
        expect(a).toMatchObject({ panelId: "dev.example.clock" });
        expect(b).toMatchObject({ panelId: "dev.example.notes" });
        expect(a!.requestId).not.toBe(b!.requestId);

        // an answer for nobody, and a malformed one, settle nothing
        host.reply({ type: "paperboard:library-install-result", requestId: "install-unknown", ok: true });
        host.reply({ type: "paperboard:library-install-result", ok: true });
        host.reply({ type: "paperboard:library-install-result", requestId: b!.requestId, ok: false, error: "Disk full" });
        host.reply({ type: "paperboard:library-install-result", requestId: a!.requestId, ok: true });
        expect(await first).toEqual({ ok: true, error: undefined });
        expect(await second).toEqual({ ok: false, error: "Disk full" });
        bridge.dispose();
    });

    test("an unanswered install resolves as unanswered after its bound", async () => {
        const bridge = embedded(60_000);
        const pending = bridge.install("dev.example.clock");
        let settled = false;
        void pending.then(() => (settled = true));
        await vi.advanceTimersByTimeAsync(59_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toEqual({ ok: false, error: "Paperboard did not answer the install request" });
        bridge.dispose();
    });

    test("disposing the library answers a pending install as unloaded", async () => {
        const bridge = embedded();
        const pending = bridge.install("dev.example.clock");
        bridge.dispose();
        expect(await pending).toEqual({ ok: false, error: "The panel library was unloaded" });
        expect(host.listening()).toBe(false);
    });
});

