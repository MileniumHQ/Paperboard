// file root-path convention (bun test): an empty targetPath means the
// panel root (getServerDir passes ""). getPath/exists must allow it —
// the engine maps it to the panel base — while read/write/delete stay
// strict, since an empty path is meaningless there. Regression test for
// the gameserver lifecycle failing to start with "Missing required
// parameter: targetPath".
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { handleFiles } from "../papercrane/rpc/files";

let dir = "";
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-root-"));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function filesCtx() {
    const replies: any[] = [];
    const calls: { op: string; target: unknown }[] = [];
    const engine = {
        getFilePath: (t: string, _appId?: string) => {
            calls.push({ op: "getFilePath", target: t });
            return path.join(dir, t);
        },
        fileExists: (t: string, _appId?: string) => {
            calls.push({ op: "fileExists", target: t });
            return true;
        },
        readFile: () => "x",
        writeFile: () => "x",
        deleteFile: () => true,
    };
    const ctx: any = {
        engine,
        reply: (_id: unknown, result: any) => replies.push(result),
        sendEvent: () => {
            // file root-path cases emit no events
        },
        callerPanelId: () => null,
    };
    return { replies, calls, ctx };
}

describe("file root-path convention", () => {
    it("getPath('') reaches the engine (panel root)", async () => {
        const f = filesCtx();
        await handleFiles("file:getPath", 1, { targetPath: "" }, f.ctx);
        expect(f.calls).toEqual([{ op: "getFilePath", target: "" }]);
        expect(f.replies).toHaveLength(1);
    });

    it("exists('') reaches the engine", async () => {
        const f = filesCtx();
        await handleFiles("file:exists", 1, { targetPath: "" }, f.ctx);
        expect(f.calls).toEqual([{ op: "fileExists", target: "" }]);
    });

    it("read/write/delete stay strict on empty paths", async () => {
        for (const action of ["file:read", "file:write", "file:delete"]) {
            const f = filesCtx();
            await expect(
                handleFiles(action, 1, { targetPath: "", content: "x" }, f.ctx),
            ).rejects.toThrow(/targetPath/);
            expect(f.calls).toEqual([]);
        }
    });
});
