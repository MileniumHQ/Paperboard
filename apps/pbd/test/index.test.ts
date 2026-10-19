import { describe, expect, it } from "bun:test";
import worker, { linkKey, parseTarget, type Env } from "../src/index";

const env = (links: Record<string, string>): Env => ({
    LINKS: { get: (async (key: string) => links[key] ?? null) as Env["LINKS"]["get"] },
});
const go = (path: string, e: Env, method = "GET") => worker.fetch(new Request(`https://pbd.lc${path}`, { method }), e);

describe("pbd.lc", () => {
    const links = env({ "/": "https://paperboard.dev/", "/beta2": "https://paperboard.dev/blog/beta-2/", "/bad": "javascript:alert(1)" });

    it("forwards a link to its stored URL", async () => {
        const res = await go("/beta2", links);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://paperboard.dev/blog/beta-2/");
    });
    it("forwards the bare domain through the / key", async () => {
        expect((await go("/", links)).headers.get("location")).toBe("https://paperboard.dev/");
    });
    it("ignores case and a trailing slash", async () => {
        expect((await go("/BETA2/", links)).headers.get("location")).toBe("https://paperboard.dev/blog/beta-2/");
    });
    it("answers 404 for an unknown link", async () => {
        expect((await go("/nope", links)).status).toBe(404);
    });
    it("never forwards to a non-https target", async () => {
        expect((await go("/bad", links)).status).toBe(500);
    });
    it("reports an unavailable store as 503, not as a missing link", async () => {
        const broken: Env = { LINKS: { get: (async () => { throw new Error("kv down"); }) as Env["LINKS"]["get"] } };
        expect((await go("/beta2", broken)).status).toBe(503);
    });
    it("refuses methods other than GET and HEAD", async () => {
        expect((await go("/beta2", links, "POST")).status).toBe(405);
    });
    it("does not look up overlong paths", () => {
        expect(linkKey("/" + "a".repeat(100))).toBeNull();
        expect(parseTarget("http://paperboard.dev")).toBeNull();
    });
});
