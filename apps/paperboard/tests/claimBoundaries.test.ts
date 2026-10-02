// Claim-derived file identity, token revocation on uninstall, typed RPC
// errors, spawn-env guards, and payload caps (bun test).
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine, FILE_READ_MAX_BYTES, CONFIG_MAX_BYTES } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { PanelServicesManager, panelServices } from "../papercrane/panelServices";
import { handleFiles } from "../papercrane/rpc/files";
import { handleProcess } from "../papercrane/rpc/process";
import { handleActions } from "../papercrane/rpc/actions";
import { handleSecrets } from "../papercrane/rpc/secrets";
import { rpcErrorCode, InvalidParamsError } from "../papercrane/rpc/params";
import { SecretError } from "../papercrane/credentials";

let dir = "";

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claim-boundaries-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function filesCtx(claim: string | null) {
    const replies: { result: any; error?: string; code?: string }[] = [];
    const calls: { op: string; appId: unknown }[] = [];
    const engine = {
        getFilePath: (t: string, appId?: string) => {
            calls.push({ op: "getFilePath", appId });
            return `/files/${appId}/${t}`;
        },
        fileExists: () => true,
        writeFile: () => "/x",
        readFile: (t: string, appId?: string) => {
            calls.push({ op: "readFile", appId });
            return Promise.resolve("data");
        },
        deleteFile: () => Promise.resolve(true),
        clearFiles: (appId?: string) => {
            calls.push({ op: "clearFiles", appId });
            return Promise.resolve(true);
        },
        downloadFile: () => Promise.resolve("/x"),
    };
    const ctx = {
        engine,
        callerPanelId: () => claim,
                sendEvent: () => undefined,
        reply: (_id: unknown, result: any, error?: string, code?: string) => {
            replies.push({ result, error, code });
        },
    };
    return { replies, calls, ctx };
}

describe("file:* derives identity from the token claim", () => {
    it("a scoped caller reads its own appId freely", async () => {
        const f = filesCtx("a");
        await handleFiles("file:read", 1, { targetPath: "x.txt", appId: "a" }, f.ctx as any);
        expect(f.calls).toEqual([{ op: "readFile", appId: "a" }]);
        expect(f.replies[0].error).toBeUndefined();
    });

    it("a scoped caller naming another panel is refused FORBIDDEN without touching the engine", async () => {
        const f = filesCtx("a");
        let thrown: unknown = null;
        try {
            await handleFiles("file:read", 1, { targetPath: "x.txt", appId: "b" }, f.ctx as any);
        } catch (err) {
            thrown = err;
        }
        // handleFiles has no catch of its own: the refusal throws and the
        // WS dispatcher maps the carried code — the engine is never touched
        expect(rpcErrorCode(thrown)).toBe("FORBIDDEN");
        expect(String((thrown as Error)?.message)).toMatch(/scoped to "a"/);
        expect(f.calls).toEqual([]);
        expect(f.replies).toEqual([]);
    });

    it("a scoped caller omitting appId lands in its own claim, not the shared default", async () => {
        const f = filesCtx("a");
        await handleFiles("file:read", 1, { targetPath: "x.txt" }, f.ctx as any);
        expect(f.calls).toEqual([{ op: "readFile", appId: "a" }]);
    });

    it("file:clear by a scoped caller cannot wipe another panel", async () => {
        const f = filesCtx("a");
        await handleFiles("file:clear", 1, { appId: "b" }, f.ctx as any).then(
            () => {
                throw new Error("expected refusal");
            },
            (err: any) => {
                expect(err.message).toMatch(/scoped to "a"/);
            },
        );
        expect(f.calls).toEqual([]);
    });

    it("an unscoped (master) caller keeps explicit-parameter behavior", async () => {
        const f = filesCtx(null);
        await handleFiles("file:clear", 1, { appId: "b" }, f.ctx as any);
        expect(f.calls).toEqual([{ op: "clearFiles", appId: "b" }]);
        expect(f.replies[0].error).toBeUndefined();
    });
});

describe("uninstall revokes the panel's scoped tokens", () => {
    it("revokePanelTokens deletes claim tokens and keeps the rest", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            const a = auth.issuePanelToken("a");
            const b = auth.issuePanelToken("b");
            auth.injectToken("pc_master", "host");
            expect(auth.revokePanelTokens("a")).toBe(1);
            expect(auth.resolveToken(a)).toBeNull();
            expect(auth.resolveToken(b)?.panelId).toBe("b");
            expect(auth.verifyToken("pc_master")).toBe(true);
            // revocation persists across reload
            auth.flushTokenStore();
            const reopened = new PaperCraneAuth(false, dir);
            try {
                expect(reopened.resolveToken(a)).toBeNull();
            } finally {
                reopened.dispose();
            }
        } finally {
            auth.dispose();
        }
    });

    it("panelServices.revokePanel drops the cache and revokes the vault token", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            const mgr = new PanelServicesManager(dir);
            mgr.setAuth(auth);
            const token = mgr.tokenForPanel("a");
            expect(auth.resolveToken(token)?.panelId).toBe("a");
            mgr.revokePanel("a");
            expect(auth.resolveToken(token)).toBeNull();
            // a later tokenForPanel mints fresh — the cached token is gone
            expect(mgr.tokenForPanel("a")).not.toBe(token);
        } finally {
            auth.dispose();
        }
    });

    it("engine.uninstallPanel revokes the panel credential", async () => {
        const engine = new PaperCraneEngine(dir, panelServices);
        const seen: string[] = [];
        const orig = panelServices.revokePanel.bind(panelServices);
        (panelServices as any).revokePanel = (id: string) => {
            seen.push(id);
            return orig(id);
        };
        try {
            await engine.uninstallPanel("gone-panel");
            expect(seen).toEqual(["gone-panel"]);
        } finally {
            (panelServices as any).revokePanel = orig;
        }
    });
});

describe("typed errors travel on the error, not in the message", () => {
    it("SecretError carries INVALID_PARAMS and maps without regex", () => {
        const err = new SecretError("INVALID_PARAMS", "Invalid secret name: 42");
        expect(rpcErrorCode(err)).toBe("INVALID_PARAMS");
        expect(rpcErrorCode(new Error("vault full for x"))).toBe("INTERNAL");
    });

    it("actions:register naming nothing is refused, not answered success", async () => {
        const replies: any[] = [];
        const ctx = {
            ws: {},
            callerPanelId: () => null,
            reply: (id: unknown, result: any, error?: string, code?: string) => {
                replies.push({ result, error, code });
            },
            broadcastEvent: () => undefined,
        };
        let thrown: unknown = null;
        try {
            await handleActions("actions:register", 1, { panelId: "a" }, ctx as any);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(InvalidParamsError);
        expect(rpcErrorCode(thrown)).toBe("INVALID_PARAMS");
        expect(replies).toEqual([]);
    });

    it("secrets cross-panel refusal still maps FORBIDDEN with the claim named", async () => {
        const replies: any[] = [];
        const ctx = {
            engine: { getSecret: () => ({ found: false, value: null }) },
            callerPanelId: () => "a",
            reply: (id: unknown, result: any, error?: string, code?: string) => {
                replies.push({ result, error, code });
            },
        };
        await handleSecrets("secrets:get", 1, { panelId: "b", name: "k" }, ctx as any);
        expect(replies[0].code).toBe("FORBIDDEN");
        expect(replies[0].error).toMatch(/scoped to "a"/);
    });
});

describe("spawn boundaries refuse loudly", () => {
    function procCtx(claim: string | null) {
        const replies: any[] = [];
        const owners = new Map<string, string | null>();
        return {
            replies,
            ctx: {
                engine: {
                    clientOwner: (id: string) => owners.get(id) ?? null,
                    setClientOwner: (id: string, o: string | null) => owners.set(id, o),
                    recordClientOwner: (id: string, o: string | null) => owners.set(id, o),
                    startProcess: () => Promise.resolve({ completion: Promise.resolve({ exitCode: 0 }) }),
                },
                callerPanelId: () => claim,
        sendEvent: () => undefined,
                reply: (id: unknown, result: any, error?: string, code?: string) => {
                    replies.push({ result, error, code });
                },
            },
        };
    }

    it("process:run refuses non-string args instead of dropping them", async () => {
        const f = procCtx(null);
        let thrown: unknown = null;
        try {
            await handleProcess(
                "process:run",
                1,
                { id: "p1", command: "echo", args: ["ok", 42] },
                f.ctx as any,
            );
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(InvalidParamsError);
        expect(rpcErrorCode(thrown)).toBe("INVALID_PARAMS");
    });

    it("a scoped caller planting PAPERCRANE_TOKEN in a child env is refused FORBIDDEN", async () => {
        const f = procCtx("a");
        let thrown: unknown = null;
        try {
            await handleProcess(
                "process:run",
                1,
                { id: "p1", command: "echo", args: [], env: { PAPERCRANE_TOKEN: "evil" } },
                f.ctx as any,
            );
        } catch (err) {
            thrown = err;
        }
        expect(rpcErrorCode(thrown)).toBe("FORBIDDEN");
        expect(String((thrown as Error)?.message)).toMatch(/PAPERCRANE_TOKEN/);
    });

    it("benign env (JAVA_HOME) passes the guard", async () => {
        const f = procCtx("a");
        const ran: any[] = [];
        (f.ctx.engine as any).startProcess = (...a: any[]) => {
            ran.push(a);
            return Promise.resolve({ completion: Promise.resolve({ exitCode: 0 }) });
        };
        await handleProcess(
            "process:run",
            1,
            { id: "p1", command: "java", args: ["-version"], env: { JAVA_HOME: "/x" } },
            f.ctx as any,
        );
        expect(ran.length).toBe(1);
        expect(f.replies[0]).toEqual({ result: { success: true }, error: undefined, code: undefined });
    });
});

describe("payload caps refuse instead of slurping", () => {
    it("readFile refuses past FILE_READ_MAX_BYTES", async () => {
        const engine = new PaperCraneEngine(dir);
        const appDir = path.join(dir, "files", "bigpanel");
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, "blob.bin"), "x".repeat(FILE_READ_MAX_BYTES + 1));
        let thrown: unknown = null;
        try {
            await engine.readFile("blob.bin", "bigpanel");
        } catch (err) {
            thrown = err;
        }
        expect(rpcErrorCode(thrown)).toBe("INVALID_PARAMS");
        // a small file still reads
        fs.writeFileSync(path.join(appDir, "small.txt"), "hi");
        expect(await engine.readFile("small.txt", "bigpanel")).toBe("hi");
    });

    it("setConfig refuses past CONFIG_MAX_BYTES serialized", async () => {
        const engine = new PaperCraneEngine(dir);
        let thrown: unknown = null;
        try {
            await engine.setConfig("huge", { blob: "x".repeat(CONFIG_MAX_BYTES) });
        } catch (err) {
            thrown = err;
        }
        expect(rpcErrorCode(thrown)).toBe("INVALID_PARAMS");
        expect(await engine.setConfig("tiny", { a: 1 })).toBe(true);
    });

    it("construction never sweeps; only the port-owner sweeps at startup", () => {
        fs.mkdirSync(path.join(dir, "panels"), { recursive: true });
        const orphan = path.join(dir, "panels", "x.tmp-12345.tar.gz");
        fs.writeFileSync(orphan, "partial download");
        // a second construction — the port-race shape from index.ts
        // tryStart — must not delete the first daemon's live temp files
        const second = new PaperCraneEngine(dir);
        expect(fs.existsSync(orphan)).toBe(true);
        second.sweepStartupOrphans();
        expect(fs.existsSync(orphan)).toBe(false);
    });
});
