// fileApi.exportFile / importFile (bun test): the panel side of the shell's
// file pickers, against a stand-in window. A request carries this frame's
// generation, a reply is taken only from the parent for this request, a
// failure is thrown rather than resolved, and widgets and a second dialog
// are refused without leaving a listener behind.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FileTransferError, fileApi } from "../src/file";
import { setFrameSession } from "../src/frameSession";

type Listener = (event: { source: unknown; data: unknown }) => void;
const listeners = new Set<Listener>();
const posted: any[] = [];
const parent = { postMessage: (message: unknown) => posted.push(message) };
const savedWindow = (globalThis as any).window;
const PANEL = "dev.example.backups";

function reply(data: unknown, source: unknown = parent) {
    for (const listener of [...listeners]) listener({ source, data });
}

beforeEach(() => {
    listeners.clear();
    posted.length = 0;
    (globalThis as any).window = {
        parent,
        addEventListener: (type: string, fn: Listener) => type === "message" && listeners.add(fn),
        removeEventListener: (type: string, fn: Listener) => type === "message" && listeners.delete(fn),
    };
    setFrameSession({ generation: "gen-1", widget: false, computerName: null });
});

afterEach(() => {
    (globalThis as any).window = savedWindow;
});

describe("file export and import", () => {
    it("asks the shell with this frame's generation and resolves its answer", async () => {
        const result = fileApi.exportFile("backups/world.zip", PANEL, { suggestedName: "world.zip" });
        expect(posted).toHaveLength(1);
        const request = posted[0];
        expect(request).toMatchObject({ type: "paperboard:file-transfer", generation: "gen-1", kind: "export", panelId: PANEL, path: "backups/world.zip", suggestedName: "world.zip" });
        // replies for another request, another load, or from another window are ignored
        reply({ type: "paperboard:file-transfer-result", generation: "gen-1", requestId: "other", result: { status: "canceled" } });
        reply({ type: "paperboard:file-transfer-result", generation: "gen-0", requestId: request.requestId, result: { status: "canceled" } });
        reply({ type: "paperboard:file-transfer-result", generation: "gen-1", requestId: request.requestId, result: { status: "canceled" } }, {});
        reply({ type: "paperboard:file-transfer-result", generation: "gen-1", requestId: request.requestId, result: { status: "exported", name: "world.zip", bytes: 3 } });
        expect(await result).toEqual({ status: "exported", name: "world.zip", bytes: 3 });
        expect(listeners.size).toBe(0);
    });

    it("throws a typed error for a failed dialog", async () => {
        const result = fileApi.importFile("imports/restore.zip", PANEL);
        const { requestId } = posted[0];
        reply({ type: "paperboard:file-transfer-result", generation: "gen-1", requestId, result: { status: "failed", code: "too-large", message: "too big" } });
        const err = await result.catch((e) => e);
        expect(err instanceof FileTransferError).toBe(true);
        expect(err.code).toBe("too-large");
    });

    it("refuses a second dialog while one is open", async () => {
        const first = fileApi.importFile("a.txt", PANEL);
        const second = await fileApi.exportFile("b.txt", PANEL).catch((e) => e);
        expect(second.code).toBe("busy");
        expect(posted).toHaveLength(1);
        reply({ type: "paperboard:file-transfer-result", generation: "gen-1", requestId: posted[0].requestId, result: { status: "canceled" } });
        expect(await first).toEqual({ status: "canceled" });
    });

    it("refuses widget frames without asking the shell", async () => {
        setFrameSession({ generation: "gen-2", widget: true, computerName: null });
        expect((await fileApi.exportFile("a.txt", PANEL).catch((e) => e)).code).toBe("unavailable");
        expect(posted).toHaveLength(0);
        expect(listeners.size).toBe(0);
    });

    it("requires an explicit, valid panel id", () => {
        expect(() => fileApi.exportFile("a.txt", "settings")).toThrow("Invalid panel id");
    });
});
