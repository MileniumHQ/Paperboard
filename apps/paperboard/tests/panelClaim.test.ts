// Claim scoping for rpc/panels.ts (T2) mirrors the secrets.ts pattern:
// scoped pcp_ callers derive identity from the token claim; a parameter
// disagreeing with the claim is refused FORBIDDEN with a loud warn.
// Master/host callers keep naming panels explicitly. panel:install is a
// host action — scoped tokens are refused.
import { describe, it, expect } from "bun:test";
import { handlePanels } from "../papercrane/rpc/panels";

function panelsCtx(claim: string | null) {
    const replies: { result: any; error?: string; code?: string }[] = [];
    const calls: { op: string; args: any[] }[] = [];
    const engine = {
        getConfig: (...args: any[]) => {
            calls.push({ op: "getConfig", args });
            return Promise.resolve({ a: 1 });
        },
        setConfig: (...args: any[]) => {
            calls.push({ op: "setConfig", args });
            return Promise.resolve(true);
        },
        uninstallPanel: (...args: any[]) => {
            calls.push({ op: "uninstallPanel", args });
            return Promise.resolve(true);
        },
        installPanel: (...args: any[]) => {
            calls.push({ op: "installPanel", args });
            return Promise.resolve({ id: "installed" });
        },
        listPanels: (...args: any[]) => {
            calls.push({ op: "listPanels", args });
            return Promise.resolve([]);
        },
    } as any;
    const ctx = {
        engine,
        callerPanelId: () => claim,
        sendEvent: () => undefined,
        reply: (_id: unknown, result: any, error?: string, code?: string) => {
            replies.push({ result, error, code });
        },
    };
    return { replies, calls, ctx, engine };
}

describe("config:get/set derive identity from the token claim", () => {
    it("a scoped caller reads its own config id freely", async () => {
        const f = panelsCtx("a");
        await handlePanels("config:get", 1, { id: "a" }, f.ctx as any);
        expect(f.calls).toEqual([{ op: "getConfig", args: ["a"] }]);
        expect(f.replies[0].error).toBeUndefined();
    });

    it("a scoped caller naming another panel's config is refused FORBIDDEN without touching the engine", async () => {
        const f = panelsCtx("a");
        await handlePanels("config:get", 1, { id: "b" }, f.ctx as any);
        expect(f.replies[0].code).toBe("FORBIDDEN");
        expect(f.replies[0].error).toMatch(/limited to "a"/);
        expect(f.calls).toEqual([]);
    });

    it("a scoped caller cannot write another panel's config", async () => {
        const f = panelsCtx("a");
        await handlePanels("config:set", 1, { id: "b", data: {} }, f.ctx as any);
        expect(f.replies[0].code).toBe("FORBIDDEN");
        expect(f.calls).toEqual([]);
    });

    it("config ids that do not belong to the claim are still refused set-side (host-owned ids included)", async () => {
        const f = panelsCtx("a");
        await handlePanels("config:set", 1, { id: "app-settings", data: {} }, f.ctx as any);
        expect(f.replies[0].code).toBe("FORBIDDEN");
    });

    it("an unscoped (master) caller keeps explicit-parameter behavior", async () => {
        const f = panelsCtx(null);
        await handlePanels("config:set", 1, { id: "app-settings", data: {} }, f.ctx as any);
        expect(f.calls).toEqual([{ op: "setConfig", args: ["app-settings", {}] }]);
        expect(f.replies[0].error).toBeUndefined();
    });
});

describe("panel:uninstall is claim-checked; panel:install is host-only", () => {
    it("a scoped caller may uninstall its own panel", async () => {
        const f = panelsCtx("a");
        await handlePanels("panel:uninstall", 1, { panelId: "a" }, f.ctx as any);
        expect(f.calls).toEqual([{ op: "uninstallPanel", args: ["a", { deleteData: false }] }]);
        expect(f.replies[0].result).toEqual({ success: true });
    });

    it("a scoped caller uninstalling another panel is refused FORBIDDEN", async () => {
        const f = panelsCtx("a");
        await handlePanels("panel:uninstall", 1, { panelId: "b" }, f.ctx as any);
        expect(f.replies[0].code).toBe("FORBIDDEN");
        expect(f.replies[0].error).toMatch(/limited to "a"/);
        expect(f.calls).toEqual([]);
    });

    it("deleteData is true only when the caller explicitly sends true", async () => {
        const f = panelsCtx(null);
        await handlePanels("panel:uninstall", 1, { panelId: "x", deleteData: "yes" }, f.ctx as any);
        expect(f.calls[0]).toEqual({ op: "uninstallPanel", args: ["x", { deleteData: false }] });
        const g = panelsCtx(null);
        await handlePanels("panel:uninstall", 1, { panelId: "x", deleteData: true }, g.ctx as any);
        expect(g.calls[0]).toEqual({ op: "uninstallPanel", args: ["x", { deleteData: true }] });
    });

    it("a scoped caller may not install at all (host action)", async () => {
        const f = panelsCtx("a");
        await handlePanels(
            "panel:install",
            1,
            { panelId: "a", downloadUrl: "https://x/y.tar.gz" },
            f.ctx as any,
        );
        expect(f.replies[0].code).toBe("FORBIDDEN");
        expect(f.replies[0].error).toMatch(/host-only/);
        expect(f.calls).toEqual([]);
    });

    it("a master caller keeps install + uninstall explicitly", async () => {
        const f = panelsCtx(null);
        await handlePanels(
            "panel:install",
            1,
            { panelId: "x", downloadUrl: "https://x/y.tar.gz", sha256: "a".repeat(64) },
            f.ctx as any,
        );
        // the URL is not the caller's to choose: the daemon resolves it from
        // its registry, and only the caller's expectations are passed on
        expect(f.calls).toEqual([{ op: "installPanel", args: ["x", { version: undefined, sha256: "a".repeat(64) }] }]);
        await handlePanels("panel:uninstall", 2, { panelId: "x" }, f.ctx as any);
        expect(f.calls[1]).toEqual({ op: "uninstallPanel", args: ["x", { deleteData: false }] });
    });

    it("install refusal precedes parameter asserts that would leak nothing — missing downloadUrl vs scoped token", async () => {
        // a scoped caller with omitted downloadUrl is refused FORBIDDEN
        // (identity check first), not INVALID_PARAMS (param check first)
        const f = panelsCtx("a");
        await handlePanels("panel:install", 1, { panelId: "a" }, f.ctx as any);
        expect(f.replies[0].code).toBe("FORBIDDEN");
    });
});
