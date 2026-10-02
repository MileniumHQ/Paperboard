// system:update is host-token-only (T4): a scoped pcp_ caller gets a typed
// FORBIDDEN before any network is touched, mirroring the panels/secrets
// claim pattern.
import { describe, it, expect } from "bun:test";
import { handleSystem } from "../papercrane/rpc/system";

function systemCtx(claim: string | null) {
    const replies: { result: any; error?: string; code?: string }[] = [];
    return {
        replies,
        ctx: {
            callerPanelId: () => claim,
            reply: (_id: unknown, result: any, error?: string, code?: string) => {
                replies.push({ result, error, code });
            },
        },
    };
}

describe("system:update claim boundary", () => {
    it("a scoped caller is refused FORBIDDEN before any download", async () => {
        const f = systemCtx("a");
        await handleSystem(
            "system:update",
            1,
            { downloadUrl: "https://localhost/self", sha256: "a".repeat(64) },
            f.ctx as any,
        );
        expect(f.replies[0].code).toBe("FORBIDDEN");
        expect(f.replies[0].error).toMatch(/host-only/);
    });

    it("the refusal name comes first: malformed params do not mask the claim refusal", async () => {
        const f = systemCtx("a");
        await handleSystem(
            "system:update",
            1,
            { downloadUrl: "not-a-url", sha256: undefined },
            f.ctx as any,
        );
        expect(f.replies[0].code).toBe("FORBIDDEN");
    });
});

describe("system:update release authority", () => {
    const valid = { downloadUrl: "https://example.invalid/crane", sha256: "a".repeat(64) };

    it("refuses an unsigned or wrongly signed binary before any download", async () => {
        for (const signature of [undefined, "", "AAAA", "A".repeat(86) + "=="]) {
            const f = systemCtx(null);
            await handleSystem("system:update", 1, { ...valid, version: "99.0.0", signature }, f.ctx as any);
            expect(f.replies[0].error).toMatch(/not signed by the Paperboard release key/);
        }
    });

    it("refuses a version that is not newer than the running daemon (no signed downgrades)", async () => {
        const f = systemCtx(null);
        await handleSystem("system:update", 1, { ...valid, version: "0.0.1", signature: "A".repeat(86) + "==" }, f.ctx as any);
        expect(f.replies[0].error).toMatch(/not newer/);
        const g = systemCtx(null);
        await handleSystem("system:update", 1, { ...valid }, g.ctx as any);
        expect(g.replies[0].error).toMatch(/version is required/);
    });
});
