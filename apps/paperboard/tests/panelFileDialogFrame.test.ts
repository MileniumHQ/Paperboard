// The shell's side of a panel frame's file dialog request (bun test): only
// well-formed requests are routed, and the frame's own panel is the
// identity. A panel naming another panel's id is refused before any
// dialog or transfer runs.
import { describe, it, expect } from "bun:test";
import { parseFileDialogMessage, runPanelFileDialog } from "../src/renderer/src/lib/panelFileDialog";

describe("panel frame file dialog requests", () => {
    it("routes only dialog requests with a kind and request id", () => {
        expect(parseFileDialogMessage({ type: "paperboard:ready" })).toBeNull();
        expect(parseFileDialogMessage({ type: "paperboard:file-dialog", kind: "delete", requestId: "r" })).toBeNull();
        expect(parseFileDialogMessage({ type: "paperboard:file-dialog", kind: "save" })).toBeNull();
        expect(parseFileDialogMessage({ type: "paperboard:file-dialog", kind: "open", requestId: "r", panelId: "p", path: "a" })).toMatchObject({
            kind: "open",
            requestId: "r",
        });
    });

    it("refuses a request naming another panel than the frame's", async () => {
        const message = parseFileDialogMessage({ type: "paperboard:file-dialog", kind: "save", requestId: "r", panelId: "dev.example.other", path: "a" });
        expect(await runPanelFileDialog("local", "dev.example.backups", message!)).toMatchObject({ status: "failed", code: "invalid-request" });
    });
});
