// daemon hygiene (bun test): supervisor metadata redacts secret env values,
// system:update refuses without a checksum before any network is touched
import { describe, it, expect } from "bun:test";
import { redactEnvValues } from "../papercrane/storage";
import { handleSystem } from "../papercrane/rpc/system";

function fakeCtx() {
    const replies: { id: unknown; result: any; error?: string }[] = [];
    return {
        ctx: {
            // full-authority caller: master/host tokens carry no claim
            // (scoped pcp_ tokens are refused in systemUpdateClaim.test.ts)
            callerPanelId: () => null,
            reply: (id: unknown, result: any, error?: string) => {
                replies.push({ id, result, error });
            },
        } as any,
        replies,
    };
}

describe("supervisor metadata redaction", () => {
    it("redacts *TOKEN|SECRET|KEY* values, keeps the rest", () => {
        const out = redactEnvValues({
            BOT_TOKEN: "secret-token",
            API_SECRET: "shh",
            ENCRYPTION_KEY: "k",
            apiKey: "lowercase-too",
            PORT: "3000",
            NODE_ENV: "production",
        });
        expect(out.BOT_TOKEN).toBe("[redacted]");
        expect(out.API_SECRET).toBe("[redacted]");
        expect(out.ENCRYPTION_KEY).toBe("[redacted]");
        expect(out.apiKey).toBe("[redacted]");
        expect(out.PORT).toBe("3000");
        expect(out.NODE_ENV).toBe("production");
        expect(JSON.stringify(out)).not.toContain("secret-token");
    });

    it("tolerates missing env", () => {
        expect(redactEnvValues(undefined)).toEqual({});
    });
});

describe("system:update checksum boundary", () => {
    it("refuses without sha256 before replying success", async () => {
        const { ctx, replies } = fakeCtx();
        const handled = await handleSystem(
            "system:update",
            1,
            { downloadUrl: "https://registry.example/crane", version: "9.9.9" },
            ctx,
        );
        expect(handled).toBe(true);
        expect(replies).toHaveLength(1);
        expect(replies[0].error).toMatch(/sha256/);
        expect(replies[0].result).toBeNull();
    });

    it("refuses garbage checksums, not just missing ones", async () => {
        const { ctx, replies } = fakeCtx();
        await handleSystem(
            "system:update",
            2,
            { downloadUrl: "https://registry.example/crane", sha256: "abc123" },
            ctx,
        );
        expect(replies[0].error).toMatch(/sha256/);
    });

    it("still refuses unsafe download URLs first", async () => {
        const { ctx, replies } = fakeCtx();
        await handleSystem(
            "system:update",
            3,
            { downloadUrl: "http://evil.example/crane", sha256: "a".repeat(64) },
            ctx,
        );
        expect(replies[0].error).toMatch(/https/);
    });

    it("refuses self-update when the daemon runs embedded in Electron", async () => {
        const { ctx, replies } = fakeCtx();
        const versions = (process as any).versions;
        (process as any).versions = { ...versions, electron: "39.0.0" };
        try {
            await handleSystem(
                "system:update",
                4,
                {
                    downloadUrl: "https://registry.example/crane",
                    sha256: "a".repeat(64),
                },
                ctx,
            );
        } finally {
            (process as any).versions = versions;
        }
        // the swap is refused before the rename, not just the respawn:
        // "the crane binary" IS the running Electron executable here
        expect(replies[0].error).toMatch(/embedded/);
        expect(replies[0].result).toBeNull();
    });
});

