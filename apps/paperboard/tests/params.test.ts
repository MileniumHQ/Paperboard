// RPC params boundary idiom (bun test): one assert shape for every
// handler. Malformed calls throw InvalidParamsError (mapped to
// INVALID_PARAMS), valid calls pass through untouched.
import { describe, it, expect } from "bun:test";
import {
    InvalidParamsError,
    rpcErrorCode,
    assertStr,
    assertOptStr,
    assertId,
    assertPanelId,
    assertNum,
} from "../papercrane/rpc/params";
import { ErrorCode } from "../papercrane/protocol";
import { handlePanels } from "../papercrane/rpc/panels";
import { handleTerminal } from "../papercrane/rpc/terminal";
import { PaperCraneEngine } from "../papercrane/engine";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("params asserts", () => {
    it("assertStr requires a non-empty string within cap", () => {
        expect(assertStr("a", "id")).toBe("a");
        expect(() => assertStr("", "id")).toThrow(InvalidParamsError);
        expect(() => assertStr(undefined, "id")).toThrow(InvalidParamsError);
        expect(() => assertStr(42, "id")).toThrow(InvalidParamsError);
        expect(() => assertStr("toolong", "id", 3)).toThrow(InvalidParamsError);
        expect(assertStr("", "id", 10, true)).toBe("");
    });

    it("assertOptStr passes undefined through, rejects non-strings", () => {
        expect(assertOptStr(undefined, "x")).toBeUndefined();
        expect(assertOptStr(null, "x")).toBeUndefined();
        expect(assertOptStr("ok", "x")).toBe("ok");
        expect(() => assertOptStr(7, "x")).toThrow(InvalidParamsError);
    });

    it("assertId sanitizes like every other identity surface", () => {
        expect(assertId("dev.paperboard.x", "panelId")).toBe("dev.paperboard.x");
        expect(() => assertId("../evil", "panelId")).toThrow(InvalidParamsError);
        expect(() => assertId("", "panelId")).toThrow(InvalidParamsError);
        expect(assertPanelId("a.b.c")).toBe("a.b.c");
        expect(() => assertPanelId("")).toThrow(InvalidParamsError);
    });

    it("assertNum takes fallbacks, refuses NaN", () => {
        expect(assertNum("80", "cols", 0)).toBe(80);
        expect(assertNum(undefined, "cols", 80)).toBe(80);
        expect(() => assertNum(undefined, "cols")).toThrow(InvalidParamsError);
        expect(() => assertNum("many", "cols", 80)).toThrow(InvalidParamsError);
    });

    it("rpcErrorCode maps malformed calls to INVALID_PARAMS only", () => {
        expect(rpcErrorCode(new InvalidParamsError("x"))).toBe(ErrorCode.INVALID_PARAMS);
        expect(rpcErrorCode(new Error("x"))).toBe(ErrorCode.INTERNAL);
        expect(rpcErrorCode(null)).toBe(ErrorCode.INTERNAL);
    });
});

describe("handlers refuse malformed params with typed errors", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "params-test-"));
    const engine = new PaperCraneEngine(tmp);

    function ctx() {
        const replies: any[] = [];
        return {
            replies,
            ctx: {
                engine,
                callerPanelId: () => null,
                sendEvent: () => undefined,
                reply: (_id: unknown, result: any, error?: string, code?: string) => {
                    replies.push({ result, error, code });
                },
            } as any,
        };
    }

    it("config:get traversal is INVALID_PARAMS, sentinel untouched", async () => {
        const sentinel = path.join(tmp, "sentinel.txt");
        fs.writeFileSync(sentinel, "secret");
        const f = ctx();
        await handlePanels("config:get", 1, { id: "shell-../../sentinel" }, f.ctx);
        expect(f.replies[0].code).toBe("INVALID_PARAMS");
        expect(fs.readFileSync(sentinel, "utf8")).toBe("secret");
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("term:write without an id throws InvalidParamsError (dispatcher maps it)", async () => {
        const f = ctx();
        await expect(handleTerminal("term:write", 1, {}, f.ctx)).rejects.toThrow(InvalidParamsError);
    });
});
