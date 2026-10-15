// The shell's side of a panel frame's export or import request (bun test): only
// well-formed requests are routed, and the frame's own panel is the
// identity. A panel naming another panel's id is refused before any
// dialog or transfer runs.
import { describe, it, expect } from "bun:test";
import { parseFileTransferMessage, runPanelFileTransfer } from "../src/renderer/src/lib/panelFileTransfer";

describe("panel frame export and import requests", () => {
    it("routes only transfer requests with a kind and request id", () => {
        expect(parseFileTransferMessage({ type: "paperboard:ready" })).toBeNull();
        expect(parseFileTransferMessage({ type: "paperboard:file-transfer", kind: "delete", requestId: "r" })).toBeNull();
        expect(parseFileTransferMessage({ type: "paperboard:file-transfer", kind: "export" })).toBeNull();
        expect(parseFileTransferMessage({ type: "paperboard:file-transfer", kind: "import", requestId: "r", panelId: "p", path: "a" })).toMatchObject({
            kind: "import",
            requestId: "r",
        });
    });

    it("refuses a request naming another panel than the frame's", async () => {
        const message = parseFileTransferMessage({ type: "paperboard:file-transfer", kind: "export", requestId: "r", panelId: "dev.example.other", path: "a" });
        expect(await runPanelFileTransfer("local", "dev.example.backups", message!)).toMatchObject({ status: "failed", code: "invalid-request" });
    });
});
