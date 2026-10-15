// The shell's side of a panel's backup location request (bun test): only
// well-formed requests open the window, the frame's own panel is the
// identity, and a second request while the window is open is refused.
import { expect, test } from "bun:test";
import { parseBackupLocationRequest } from "../src/renderer/src/lib/backupLocationRequest";

const PANEL = "dev.example.panel";

test("routes only backup location requests with a request id", () => {
    expect(parseBackupLocationRequest({ type: "paperboard:ready" }, PANEL, false)).toBeNull();
    expect(parseBackupLocationRequest({ type: "paperboard:backup-location", panelId: PANEL }, PANEL, false)).toBeNull();
    expect(parseBackupLocationRequest({ type: "paperboard:backup-location", requestId: "r", panelId: PANEL }, PANEL, false)).toEqual({ requestId: "r", refused: null });
});

test("refuses another panel's id and a second open window", () => {
    expect(parseBackupLocationRequest({ type: "paperboard:backup-location", requestId: "r", panelId: "dev.example.other" }, PANEL, false)?.refused).toContain("does not match");
    expect(parseBackupLocationRequest({ type: "paperboard:backup-location", requestId: "r", panelId: PANEL }, PANEL, true)?.refused).toContain("already open");
});
