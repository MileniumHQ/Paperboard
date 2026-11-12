import { describe, expect, test } from "bun:test";
import type { PromptEntry } from "../src/contract";
import { checkSecretName } from "../src/service/mcpConfig";
import { Prompts } from "../src/service/prompts";

const KEY = "lin_api_correct-horse-battery-staple";

function setup(o: { failSave?: boolean } = {}) {
    const posted: PromptEntry[] = [];
    const notices: string[] = [];
    const vault = new Map<string, string>();
    const prompts = new Prompts({
        hasServer: (s) => s === "linear",
        checkSecretName: (n) => checkSecretName(n),
        saveSecret: async (server, name, value) => {
            if (o.failSave) throw new Error("the vault is locked");
            vault.set(`mcp.${server}.${name}`, value);
        },
        post: (e) => posted.push(structuredClone(e)),
        notice: (t) => notices.push(t),
    });
    const call = (args: Record<string, unknown>, fromFlow = false) => prompts.toolset().call("ask_user", args, { fromFlow });
    const ask = async () => {
        const r = await call({
            title: "Connect Linear",
            reason: "To read your issues.",
            fields: [{ label: "Workspace" }, { label: "API key", secret: { server: "linear", name: "api-key" } }],
        });
        expect(r.isError).toBeFalsy();
        return posted.at(-1)!.id;
    };
    return { prompts, posted, notices, vault, call, ask };
}

// A key typed into the card reaches the vault and nothing else.
describe("asking the user for things", () => {
    test("a secret answer goes only to the vault; a plain one goes to the agent", async () => {
        const s = setup();
        const id = await s.ask();
        await s.prompts.answer(id, ["acme", KEY]);
        expect(s.vault.get("mcp.linear.api-key")).toBe(KEY);
        expect(s.posted.at(-1)!.status).toBe("sent");
        expect(s.notices.at(-1)).toContain("Workspace: acme");
        expect(s.notices.at(-1)).toContain("saved in the vault as api-key for linear");
        expect(JSON.stringify([s.posted, s.notices])).not.toContain(KEY);
        await expect(s.prompts.answer(id, ["acme", KEY])).rejects.toThrow("isn't waiting anymore");
    });

    test("a secret that can't be saved fails loudly, and the key still isn't told", async () => {
        const s = setup({ failSave: true });
        const id = await s.ask();
        await expect(s.prompts.answer(id, ["acme", KEY])).rejects.toThrow("the vault is locked");
        expect(s.posted.at(-1)).toMatchObject({ status: "failed" });
        expect(s.notices.at(-1)).toContain("couldn't be saved");
        expect(JSON.stringify([s.posted, s.notices])).not.toContain(KEY);
    });

    test("an empty answer is refused and the request keeps waiting", async () => {
        const s = setup();
        const id = await s.ask();
        await expect(s.prompts.answer(id, ["acme", " "])).rejects.toThrow("Fill in API key");
        expect(s.posted.at(-1)!.status).toBe("waiting");
        expect(s.vault.size).toBe(0);
    });

    test("a secret for a server the agent doesn't have, or with a bad name, isn't asked for", async () => {
        const s = setup();
        expect((await s.call({ title: "x", reason: "y", fields: [{ label: "Key", secret: { server: "nope", name: "k" } }] })).text).toContain("isn't one of your tool servers");
        expect((await s.call({ title: "x", reason: "y", fields: [{ label: "Key", secret: { server: "linear", name: "a b" } }] })).isError).toBe(true);
        expect(s.posted).toEqual([]);
    });

    test("saying no tells the agent, and a new request replaces a waiting one", async () => {
        const s = setup();
        const first = await s.ask();
        const second = await s.ask();
        expect(s.posted.find((e) => e.id === first && e.status === "expired")).toBeTruthy();
        s.prompts.decline(second);
        expect(s.notices.at(-1)).toContain("said no");
        expect(() => s.prompts.decline(first)).toThrow("isn't waiting anymore");
    });

    test("an automation's turn can't ask", async () => {
        const s = setup();
        expect(s.prompts.toolset().tools({ fromFlow: true })).toEqual([]);
    });
});
