// Panel-scoped token claims (bun test): identity is granted at issuance.
// injectToken carries an optional panelId claim; issuePanelToken mints one
// live token per panel id; resolveToken returns the entry so handlers can
// derive the caller's panel from the credential instead of a parameter.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneAuth } from "../papercrane/auth";
import { PanelServicesManager } from "../papercrane/panelServices";
import { handleSecrets } from "../papercrane/rpc/secrets";
import { handleTerminal } from "../papercrane/rpc/terminal";
import { claimClient, checkClientOwnership, checkSpawnEnv } from "../papercrane/rpc/ownership";

let dir = "";

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-tokens-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("panel-scoped token claims", () => {
    it("panel tokens do not consume the paired-device budget", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            for (let i = 0; i < 200; i++) auth.issuePanelToken(`panel.${i}`);
            expect(auth.pair(auth.startPairing(), "fixture-device").success).toBe(true);
        } finally { auth.dispose(); }
    });
    it("injectToken stores a panelId claim readable via resolveToken", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            auth.injectToken("pc_master", "host");
            auth.injectToken("pcp_panel", "panel-service:a", "a");
            expect(auth.verifyToken("pc_master")).toBe(true);
            expect(auth.verifyToken("pcp_panel")).toBe(true);
            expect(auth.resolveToken("pc_master")?.panelId).toBeUndefined();
            expect(auth.resolveToken("pcp_panel")?.panelId).toBe("a");
            expect(auth.resolveToken("nope")).toBeNull();
        } finally {
            auth.dispose();
        }
    });

    it("issuePanelToken mints one stable token per panel, distinct across panels", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            const a1 = auth.issuePanelToken("a");
            const a2 = auth.issuePanelToken("a");
            const b = auth.issuePanelToken("b");
            expect(a1).toBe(a2);
            expect(a1).not.toBe(b);
            expect(a1.startsWith("pcp_")).toBe(true);
            expect(auth.resolveToken(a1)?.panelId).toBe("a");
            expect(auth.resolveToken(b)?.panelId).toBe("b");
        } finally {
            auth.dispose();
        }
    });

    it("claims survive a token-store reload", () => {
        const auth = new PaperCraneAuth(false, dir);
        const token = auth.issuePanelToken("a");
        auth.flushTokenStore();
        auth.dispose();
        const reopened = new PaperCraneAuth(false, dir);
        try {
            expect(reopened.resolveToken(token)?.panelId).toBe("a");
        } finally {
            reopened.dispose();
        }
    });
});

describe("panel service credentials", () => {
    it("tokenForPanel is empty without an issuer, claim-bound with one", () => {
        const mgr = new PanelServicesManager(dir);
        expect(mgr.tokenForPanel("a")).toBe("");
        const auth = new PaperCraneAuth(false, dir);
        try {
            mgr.setAuth(auth);
            const token = mgr.tokenForPanel("a");
            expect(token.startsWith("pcp_")).toBe(true);
            expect(auth.resolveToken(token)?.panelId).toBe("a");
            // stable across calls: one live token per panel
            expect(mgr.tokenForPanel("a")).toBe(token);
        } finally {
            auth.dispose();
        }
    });

    it("startAll honors manifest autostart:false", () => {        const panelsDir = path.join(dir, "panels");
        fs.mkdirSync(path.join(panelsDir, "booted"), { recursive: true });
        fs.mkdirSync(path.join(panelsDir, "quiet"), { recursive: true });
        fs.writeFileSync(
            path.join(panelsDir, "booted", "manifest.json"),
            JSON.stringify({ service: "./dist/service.js" }),
        );
        fs.writeFileSync(
            path.join(panelsDir, "quiet", "manifest.json"),
            JSON.stringify({ service: "./dist/service.js", autostart: false }),
        );
        class Probe extends PanelServicesManager {
            public started: string[] = [];
            public override startService(panelId: string): boolean {
                this.started.push(panelId);
                return true;
            }
        }
        const probe = new Probe(dir);
        probe.startAll();
        expect(probe.started).toEqual(["booted"]);
    });
});

describe("vault derives identity from the token claim", () => {
    function fakeCtx(claim: string | null) {
        const replies: { result: any; error?: string; code?: string }[] = [];
        const calls: { name: string; panelId: string }[] = [];
        const engine = {
            setSecret: () => undefined,
            getSecret: (name: string, panelId: string) => {
                calls.push({ name, panelId });
                return { found: true, value: "s3cr3t" };
            },
            deleteSecret: () => false,
            listSecrets: () => [],
            purgeSecrets: () => 0,
        };
        const ctx = {
            engine,
            callerPanelId: () => claim,
            reply: (_id: unknown, result: any, error?: string, code?: string) => {
                replies.push({ result, error, code });
            },
        };
        return { replies, calls, engine, ctx };
    }

    it("a scoped caller reads its own panel freely", async () => {
        const f = fakeCtx("a");
        await handleSecrets("secrets:get", 1, { panelId: "a", name: "k" }, f.ctx as any);
        expect(f.calls).toEqual([{ name: "k", panelId: "a" }]);
        expect(f.replies[0].error).toBeUndefined();
    });

    it("a scoped caller naming another panel is refused FORBIDDEN without touching the vault", async () => {
        const f = fakeCtx("a");
        await handleSecrets("secrets:get", 1, { panelId: "b", name: "k" }, f.ctx as any);
        expect(f.calls).toEqual([]);
        expect(f.replies[0].code).toBe("FORBIDDEN");
        expect(f.replies[0].error).toMatch(/scoped to "a"/);
    });

    it("an unscoped (master) caller keeps explicit-parameter behavior", async () => {
        const f = fakeCtx(null);
        await handleSecrets("secrets:get", 1, { panelId: "b", name: "k" }, f.ctx as any);
        expect(f.calls).toEqual([{ name: "k", panelId: "b" }]);
        expect(f.replies[0].error).toBeUndefined();
    });
});

describe("terminal/process id ownership", () => {
    function stubEngine() {
        const owners = new Map<string, string | null>();
        const writes: string[] = [];
        return {
            owners,
            writes,
            clientOwner: (id: string) => owners.get(id) ?? null,
            setClientOwner: (id: string, owner: string | null) => {
                owners.set(id, owner);
            },
            writeTerminal: (id: string) => {
                writes.push(id);
            },
        };
    }

    function termCtx(engine: any, claim: string | null) {
        const replies: any[] = [];
        return {
            replies,
            ctx: {
                engine,
                callerPanelId: () => claim,
                sendEvent: () => undefined,
                reply: (_id: unknown, result: any, error?: string, code?: string) => {
                    replies.push({ result, error, code });
                },
            },
        };
    }

    it("claimClient records the creator claim", () => {
        const engine = stubEngine();
        claimClient("t1", termCtx(engine, "a").ctx as any, "term:create");
        expect(engine.owners.get("t1")).toBe("a");
    });

    it("a scoped caller cannot touch another panel's terminal", async () => {
        const engine = stubEngine();
        engine.owners.set("t1", "gameserver");
        const f = termCtx(engine, "botcreator");
        await expect(handleTerminal("term:write", 1, { id: "t1", data: "x" }, f.ctx as any)).rejects.toMatchObject({
            code: "FORBIDDEN",
        });
        expect(engine.writes).toEqual([]);
    });

    it("a scoped caller cannot re-create another panel's id to take it over", () => {
        const engine = stubEngine();
        engine.owners.set("t1", "gameserver");
        expect(() => claimClient("t1", termCtx(engine, "botcreator").ctx as any, "term:create")).toThrow(/another panel/);
        expect(engine.owners.get("t1")).toBe("gameserver");
    });

    it("no caller, master included, may plant a credential in a child env", () => {
        for (const claim of ["a", null]) {
            expect(() =>
                checkSpawnEnv({ PAPERCRANE_TOKEN: "x" }, termCtx(stubEngine(), claim).ctx as any, "process:run"),
            ).toThrow(/refused/);
        }
        expect(() => checkSpawnEnv({ PATH: "/bin" }, termCtx(stubEngine(), null).ctx as any, "process:run")).not.toThrow();
    });

    it("owner and unclaimed ids proceed without a mismatch", () => {
        const engine = stubEngine();
        engine.owners.set("t1", "a");
        // matching claim: silent
        checkClientOwnership("t1", termCtx(engine, "a").ctx as any, "term:write");
        // unclaimed id: shared, silent
        checkClientOwnership("legacy", termCtx(engine, "a").ctx as any, "term:write");
        // master caller: silent
        checkClientOwnership("t1", termCtx(engine, null).ctx as any, "term:write");
    });
});
