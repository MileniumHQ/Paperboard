import { describe, expect, test } from "bun:test";
import type { SignInEntry } from "../src/contract";
import { SignIns } from "../src/service/signIn";

const PASSWORD = "correct horse battery staple";

function setup(fill: (args: { id: string; values: string[] }) => Promise<unknown>) {
    const posted: SignInEntry[] = [];
    const notices: string[] = [];
    const fills: { id: string; values: string[] }[] = [];
    const prepared: Record<string, unknown>[] = [];
    const signIns = new SignIns({
        prepare: async (args) => {
            prepared.push(structuredClone(args));
            return { text: JSON.stringify({ site: "example.com", fields: (args.fields as number[]).map((_, i) => ({ secret: i === 1 })) }), images: [{ data: "aW1n", type: "image/png" }] };
        },
        fill: async (args) => {
            fills.push(structuredClone(args));
            return fill(args);
        },
        post: (e) => posted.push(structuredClone(e)),
        tell: (t) => notices.push(t),
    });
    const ask = async () => {
        const r = await signIns.toolset().call("ask_to_sign_in", { window: 1, fields: [{ mark: 3, label: "Email" }, { mark: 4, label: "Password" }], submit: 5 }, { fromFlow: false });
        expect(r.isError).toBeFalsy();
        return posted.at(-1)!.id;
    };
    return { signIns, posted, notices, fills, prepared, ask };
}

// Site credentials reach only the computer, once.
describe("signing in for the agent", () => {
    test("the values go to the computer's fill exactly once and never into entries or notices; a second answer is rejected", async () => {
        const s = setup(async () => ({ ok: true }));
        const id = await s.ask();
        expect(await s.signIns.submit(id, ["ada@example.com", PASSWORD])).toEqual({ submitted: true });
        expect(s.fills).toEqual([{ id, values: ["ada@example.com", PASSWORD] }]);
        await expect(s.signIns.submit(id, ["ada@example.com", PASSWORD])).rejects.toThrow("That sign-in isn't waiting anymore.");
        expect(() => s.signIns.decline(id)).toThrow("That sign-in isn't waiting anymore.");
        expect(s.fills).toHaveLength(1);
        expect(s.posted.map((e) => e.status)).toEqual(["waiting", "submitting", "submitted"]);
        const said = JSON.stringify([s.posted, s.notices]);
        expect(said).not.toContain(PASSWORD);
        expect(said).not.toContain("ada@example.com");
    });

    test("a failed fill is reported, never retried, and its values aren't in the error", async () => {
        const s = setup(async () => {
            throw new Error("the page changed");
        });
        const id = await s.ask();
        await expect(s.signIns.submit(id, ["ada@example.com", PASSWORD])).rejects.toThrow("Couldn't sign in: the page changed");
        expect(s.fills).toHaveLength(1);
        await expect(s.signIns.submit(id, ["ada@example.com", PASSWORD])).rejects.toThrow("That sign-in isn't waiting anymore.");
        expect(s.fills).toHaveLength(1);
        expect(s.posted.at(-1)).toMatchObject({ status: "failed", error: "the page changed" });
        expect(JSON.stringify([s.posted, s.notices])).not.toContain(PASSWORD);
    });

    test("the card's picture names each field as the agent labels it, and a field without a name is refused", async () => {
        const s = setup(async () => ({ ok: true }));
        await s.ask();
        expect(s.prepared).toMatchObject([{ window: 1, fields: [3, 4], labels: ["Email", "Password"], submit: 5 }]);

        const unnamed = await s.signIns.toolset().call("ask_to_sign_in", { window: 1, fields: [{ mark: 3, label: " " }] }, { fromFlow: false });
        expect(unnamed).toMatchObject({ isError: true });
        expect(unnamed.text).toContain("each field has a label");
        expect(s.prepared).toHaveLength(1);
    });
});
