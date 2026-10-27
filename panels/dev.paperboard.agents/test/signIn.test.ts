// Signing in for the agent without it seeing the values (signIn.ts): one
// request at a time, answered once, and the values reach only the computer.

import { afterEach, describe, expect, test } from "bun:test";
import type { SignInEntry } from "../src/contract";
import type { ToolResult } from "../src/service/computerMcp";
import { SIGN_IN_TOOLS, SignIns } from "../src/service/signIn";
import { until } from "./fakeHost";

const PNG = "aW1hZ2U=";
const live: SignIns[] = [];
afterEach(() => live.splice(0).forEach((s) => s.shutdown()));

function setup(o: { prepare?: (args: Record<string, unknown>) => ToolResult; fill?: () => Promise<unknown>; waitMs?: number } = {}) {
    const posted: SignInEntry[] = [];
    const notices: string[] = [];
    const prepared: Record<string, unknown>[] = [];
    const filled: { id: string; values: string[] }[] = [];
    const s = new SignIns({
        prepare: async (args) => {
            prepared.push(args);
            return o.prepare?.(args) ?? { text: JSON.stringify({ site: "github.com", fields: [{ secret: false }, { secret: true }] }), image: PNG };
        },
        fill: async (args) => {
            filled.push(args);
            return o.fill ? o.fill() : { ok: true };
        },
        post: (e) => posted.push(e),
        notice: (t) => notices.push(t),
        waitMs: o.waitMs,
    });
    live.push(s);
    const tools = s.toolset();
    const ask = (args: Record<string, unknown> = { window: 7, fields: [{ mark: 3, label: "Email" }, { mark: 4, label: "Password" }], submit: 5 }) =>
        tools.call("ask_to_sign_in", args);
    return { s, ask, posted, notices, prepared, filled, last: () => posted.at(-1)! };
}

const SECRET = "hunter2-very-secret";

describe("sign-in requests", () => {
    test("the agent's picks go to the computer; the user sees the site, the labels and which fields are secret", async () => {
        const t = setup();
        const r = await t.ask();
        expect(r.isError).toBeFalsy();
        expect(r.text).toContain("github.com");
        expect(t.prepared[0]).toMatchObject({ window: 7, fields: [3, 4], submit: 5 });
        expect(t.last()).toMatchObject({
            kind: "sign-in",
            site: "github.com",
            status: "waiting",
            fields: [
                { label: "Email", secret: false },
                { label: "Password", secret: true },
            ],
        });
        expect(t.prepared[0]!.id).toBe(t.last().id);
        expect(t.s.shot(t.last().id)).toEqual({ image: PNG });
    });

    test("the values reach the computer once and nowhere else; the agent is told it was submitted", async () => {
        const t = setup();
        await t.ask();
        const id = t.last().id;
        expect(await t.s.submit(id, ["me@example.com", SECRET])).toEqual({ submitted: true });
        expect(t.filled).toEqual([{ id, values: ["me@example.com", SECRET] }]);
        expect(t.posted.map((e) => e.status)).toEqual(["waiting", "submitting", "submitted"]);
        expect(t.notices).toHaveLength(1);
        expect(t.notices[0]).toContain("github.com");
        expect(t.notices[0]).toContain("window 7");
        expect(JSON.stringify([t.posted, t.notices])).not.toContain(SECRET);
        expect(JSON.stringify([t.posted, t.notices])).not.toContain("me@example.com");
        // used once: answering again, or asking for its picture, is refused
        await expect(t.s.submit(id, ["a", "b"])).rejects.toThrow("isn't waiting anymore");
        expect(() => t.s.shot(id)).toThrow("isn't waiting anymore");
        expect(t.filled).toHaveLength(1);
    });

    test("the wrong number of values is refused and the request keeps waiting", async () => {
        const t = setup();
        await t.ask();
        const id = t.last().id;
        await expect(t.s.submit(id, [SECRET])).rejects.toThrow("one value per field");
        await expect(t.s.submit(id, ["a", 5])).rejects.toThrow("one value per field");
        await expect(t.s.submit(id, ["a", "x".repeat(1001)])).rejects.toThrow("one value per field");
        expect(t.filled).toHaveLength(0);
        expect(t.last().status).toBe("waiting");
    });

    test("a fill that fails is a failure: shown, told to the agent without the values, and not retried with them", async () => {
        const t = setup({ fill: async () => Promise.reject(new Error("the page isn't on github.com anymore")) });
        await t.ask();
        const id = t.last().id;
        await expect(t.s.submit(id, ["me", SECRET])).rejects.toThrow("Couldn't sign in: the page isn't on github.com anymore");
        expect(t.last()).toMatchObject({ status: "failed", error: "the page isn't on github.com anymore" });
        expect(t.notices[0]).toContain("couldn't be filled in");
        expect(JSON.stringify([t.posted, t.notices])).not.toContain(SECRET);
        await expect(t.s.submit(id, ["me", SECRET])).rejects.toThrow("isn't waiting anymore");
    });

    test("saying no tells the agent; an unanswered request lapses; a new one replaces the old", async () => {
        const t = setup();
        await t.ask();
        t.s.decline(t.last().id);
        expect(t.last().status).toBe("declined");
        expect(t.notices.at(-1)).toContain("said no");

        const u = setup({ waitMs: 20 });
        await u.ask();
        await until(() => u.last().status === "expired");
        expect(u.notices.at(-1)).toContain("didn't answer");

        const v = setup();
        await v.ask();
        const first = v.last().id;
        await v.ask();
        expect(v.posted.find((e) => e.id === first && e.status === "expired")).toBeTruthy();
        expect(() => v.s.shot(first)).toThrow("isn't waiting anymore");
        expect(v.last().status).toBe("waiting");
        // a replaced request isn't news to the agent: it asked for the new one
        expect(v.notices).toHaveLength(0);
    });

    test("a greyed-out or missing submit button needn't stop a sign-in: submit can be left out", async () => {
        const t = setup();
        expect(SIGN_IN_TOOLS[0]!.inputSchema.required).not.toContain("submit");
        const r = await t.ask({ window: 7, fields: [{ mark: 3, label: "Email" }, { mark: 4, label: "Password" }] });
        expect(r.isError).toBeFalsy();
        expect(t.prepared[0]).not.toHaveProperty("submit");
        expect(t.last().status).toBe("waiting");
        expect((await t.ask({ window: 7, fields: [{ mark: 3, label: "Email" }], submit: "5" })).isError).toBe(true);
    });

    test("bad picks are refused before the computer is asked; the computer's refusal reaches the agent", async () => {
        const t = setup({ prepare: () => ({ isError: true, text: "mark 9 is a push button, not a text field" }) });
        expect((await t.ask({ window: 7, fields: [], submit: 5 })).isError).toBe(true);
        expect((await t.ask({ window: 7, fields: [{ mark: 1, label: "" }], submit: 5 })).isError).toBe(true);
        expect((await t.ask({ window: 7, fields: [1, 2, 3, 4, 5].map((mark) => ({ mark, label: "x" })), submit: 6 })).isError).toBe(true);
        expect((await t.ask({ window: "7", fields: [{ mark: 1, label: "Email" }], submit: 5 })).isError).toBe(true);
        expect(t.prepared).toHaveLength(0);
        const r = await t.ask({ window: 7, fields: [{ mark: 9, label: "Email" }], submit: 5 });
        expect(r).toEqual({ isError: true, text: "mark 9 is a push button, not a text field" });
        expect(t.posted).toHaveLength(0);
    });

    test("shutting down lapses a waiting request", async () => {
        const t = setup();
        await t.ask();
        t.s.shutdown();
        expect(t.last().status).toBe("expired");
    });
});
