// The title bar's folder button: a folder the file manager won't open comes
// back with the file manager's reason, so the shell can say why instead of
// the click doing nothing.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createShellInvokeHandlers } from "../src/main/communication/shellHandlers";
import { getFilesDir } from "../papercrane/paths";

const handlersOpening = (answer: string) => {
    const opened: string[] = [];
    const handlers = createShellInvokeHandlers({
        appVersion: () => "0.0.0-test",
        launchOptions: () => ({ firstOpenTutorials: false, mobile: false }),
        openPath: async (dir) => {
            opened.push(dir);
            return answer;
        },
    });
    return { open: handlers["open-panel-folder"], opened };
};

describe("open-panel-folder", () => {
    test("answers the file manager's reason when it won't open the folder", async () => {
        const { open, opened } = handlersOpening("No application is registered as handling this file");
        const result = await open({ computerId: "local", panelId: "dev.paperboard.folder-test" });
        expect(result).toEqual({ opened: false, error: "No application is registered as handling this file" });
        expect(opened).toEqual([path.join(getFilesDir(), "dev.paperboard.folder-test")]);
    });

    test("opens a panel's files folder, made if it isn't there yet", async () => {
        const { open, opened } = handlersOpening("");
        const result = await open({ computerId: "local", panelId: "dev.paperboard.folder-made" });
        expect(result).toEqual({ opened: true });
        expect(fs.statSync(opened[0]).isDirectory()).toBe(true);
    });
});
