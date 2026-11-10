// pbd.lc through its real fetch handler. workerd is not a dependency of
// this worker, so LINKS is a stand-in for the one KV call it makes:
// `get(key)` resolves the stored string, or null for a key never written.
import { describe, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";

function links(stored: Record<string, string>): Env & { lookups: string[] } {
    const lookups: string[] = [];
    return {
        lookups,
        LINKS: {
            get: (async (key: string) => {
                lookups.push(key);
                return Object.hasOwn(stored, key) ? stored[key]! : null;
            }) as unknown as Env["LINKS"]["get"],
        },
    };
}

const LIVE = {
    "/": "https://paperboard.dev/",
    "/beta2": "https://github.com/MileniumHQ/Paperboard/releases/tag/v0.2.0",
    "/script": "javascript:alert(document.cookie)",
    "/plain": "http://paperboard.dev/",
};

const visit = (env: Env, path: string, method = "GET") => worker.fetch(new Request(`https://pbd.lc${path}`, { method }), env);

// Short links forward only to stored https targets.
describe("short links forward only to stored https targets", () => {
    test("a stored link answers 302 to its target, whatever the case or trailing slash", async () => {
        const env = links(LIVE);
        for (const path of ["/beta2", "/Beta2", "/BETA2/", "/beta2//"]) {
            const res = await visit(env, path);
            expect({ path, status: res.status }).toEqual({ path, status: 302 });
            expect(res.headers.get("location")).toBe(LIVE["/beta2"]);
        }
        expect(env.lookups).toEqual(["/beta2", "/beta2", "/beta2", "/beta2"]);
    });

    test("the bare domain uses the / link", async () => {
        const env = links(LIVE);
        const res = await visit(env, "/");
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://paperboard.dev/");
        expect(env.lookups).toEqual(["/"]);
    });

    test("an unknown key answers 404", async () => {
        const res = await visit(links(LIVE), "/nothing-here");
        expect(res.status).toBe(404);
        expect(res.headers.get("location")).toBeNull();
    });

    test("a stored target that is not https answers 500 and is never forwarded", async () => {
        for (const path of ["/script", "/plain"]) {
            const res = await visit(links(LIVE), path);
            expect({ path, status: res.status }).toEqual({ path, status: 500 });
            expect(res.headers.get("location")).toBeNull();
            expect(await res.text()).not.toContain("javascript:");
        }
    });

    test("an overlong path is never looked up", async () => {
        const env = links({ [`/${"a".repeat(101)}`]: "https://paperboard.dev/" });
        const res = await visit(env, `/${"a".repeat(101)}`);
        expect(res.status).toBe(404);
        expect(env.lookups).toEqual([]);
    });
});

// An unavailable store is not a missing link.
describe("an unavailable store is not a missing link", () => {
    test("a KV read failure answers 503, not 404", async () => {
        const env: Env = {
            LINKS: {
                get: (async () => {
                    throw new Error("KV GET failed: 500 Internal Server Error");
                }) as unknown as Env["LINKS"]["get"],
            },
        };
        const res = await visit(env, "/beta2");
        expect(res.status).toBe(503);
        expect(res.headers.get("location")).toBeNull();
    });

    test("methods other than GET and HEAD answer 405 without a lookup", async () => {
        const env = links(LIVE);
        for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
            const res = await visit(env, "/beta2", method);
            expect({ method, status: res.status }).toEqual({ method, status: 405 });
            expect(res.headers.get("allow")).toBe("GET, HEAD");
        }
        expect(env.lookups).toEqual([]);
        const head = await visit(env, "/beta2", "HEAD");
        expect(head.status).toBe(302);
    });
});
