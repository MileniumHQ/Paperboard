// backupApi (bun test): route bindings, and chooseLocation as a shell
// request against a stand-in window.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { RPC_ROUTES } from "../src/ipc";
import { BackupLocationError, backupApi } from "../src/backups";
import { setFrameSession } from "../src/frameSession";

type Listener = (event: { source: unknown; data: unknown }) => void;
const listeners = new Set<Listener>();
const posted: any[] = [];
const parent = { postMessage: (message: unknown) => posted.push(message) };
const savedWindow = (globalThis as any).window;
const PANEL = "dev.example.backups";

function reply(data: unknown) {
    for (const listener of [...listeners]) listener({ source: parent, data });
}

beforeEach(() => {
    listeners.clear();
    posted.length = 0;
    (globalThis as any).window = {
        parent,
        addEventListener: (type: string, fn: Listener) => type === "message" && listeners.add(fn),
        removeEventListener: (type: string, fn: Listener) => type === "message" && listeners.delete(fn),
    };
    setFrameSession({ generation: "gen-1", widget: false });
});

afterEach(() => {
    (globalThis as any).window = savedWindow;
});

describe("backup routes", () => {
    it("panel backups and host locations reach the daemon's backup actions", () => {
        const expected: Record<string, string> = {
            "backup-status": "backup:status",
            "backup-create": "backup:create",
            "backup-list": "backup:list",
            "backup-restore": "backup:restore",
            "backup-delete": "backup:delete",
            "backup-locations": "backup:destinations",
            "backup-location-usage": "backup:destination-usage",
            "backup-location-add": "backup:destination-add",
            "backup-location-remove": "backup:destination-remove",
            "backup-panel-location-set": "backup:panel-destination-set",
        };
        for (const [channel, action] of Object.entries(expected)) expect(RPC_ROUTES[channel]?.action).toBe(action);
    });

    it("making and restoring a backup are not cut off by the default call timeout", () => {
        expect(RPC_ROUTES["backup-create"].timeoutMs).toBeNull();
        expect(RPC_ROUTES["backup-restore"].timeoutMs).toBeNull();
    });
});

describe("chooseLocation", () => {
    it("asks the shell for this panel and resolves the chosen location", async () => {
        const result = backupApi.chooseLocation(PANEL);
        expect(posted[0]).toMatchObject({ type: "paperboard:backup-location", generation: "gen-1", panelId: PANEL });
        const location = { id: "local", kind: "local", label: "This computer", detail: "/x", removable: false };
        reply({ type: "paperboard:backup-location-result", generation: "gen-1", requestId: posted[0].requestId, result: { status: "chosen", location } });
        expect(await result).toEqual({ status: "chosen", location });
        expect(listeners.size).toBe(0);
    });

    it("throws the shell's failure and refuses widgets", async () => {
        const result = backupApi.chooseLocation(PANEL);
        reply({ type: "paperboard:backup-location-result", generation: "gen-1", requestId: posted[0].requestId, result: { status: "failed", message: "offline" } });
        const err = await result.catch((e) => e);
        expect(err instanceof BackupLocationError && err.code === "failed").toBe(true);

        setFrameSession({ generation: "gen-2", widget: true });
        const widgetErr = await backupApi.chooseLocation(PANEL).catch((e) => e);
        expect(widgetErr instanceof BackupLocationError && widgetErr.code === "unavailable").toBe(true);
        expect(listeners.size).toBe(0);
    });
});
