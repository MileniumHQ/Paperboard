import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { parseSettings } from "../../src/service/app";
import { Asker } from "../../src/service/ask";
import { MCP_TOKEN_ENV } from "../../src/service/computerMcp";
import { conversationRig, settled, turnId, type Rig } from "../support/rig";
import { brainProgram, SLOW } from "../support/host";

let rig: Rig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

// shell text, quoting and flags: each is one argument to the brain, on every system's process launcher
const HOSTILE = `hi; rm -rf ~ && del /s /q C:\\ | echo "PWNED" $(whoami) \`id\` %PATH% ^& --dangerously-bypass-approvals-and-sandbox 'x'`;

// No argv injection or token leak.
describe("what reaches a brain's command line", () => {
    test("the user's message is one argument and the MCP token arrives only in the environment", async () => {
        for (const harness of ["codex", "claude-code"] as const) {
            rig = await conversationRig({ harness });
            const { id } = rig.conversation.send(HOSTILE);
            await settled(rig);
            const [run] = rig.log().filter((e) => e.event === "run");
            expect(run.argv.at(-1)).toBe(`[${id}] ${HOSTILE}`);
            expect(run.env[MCP_TOKEN_ENV]).toBe(rig.mcp.token);
            expect(run.argv.some((a: string) => a.includes(rig!.mcp.token))).toBe(false);
            expect(rig.host.startedAs(turnId)[0]!.args.some((a) => a.includes(rig!.mcp.token))).toBe(false);
            await rig.close();
            rig = null;
        }
    }, SLOW);

    test("a saved model is a single value that can't be read as a flag", async () => {
        const base = { name: "Ada", harness: "codex" };
        for (const model of ["--dangerously-bypass-approvals-and-sandbox", "-c", "gpt 5", "gpt-5;rm", "a".repeat(65), "x\ny"]) {
            expect(parseSettings({ ...base, model })).toBeNull();
        }
        expect(parseSettings({ ...base, model: "gpt-5.5" })).toMatchObject({ model: "gpt-5.5" });
        rig = await conversationRig({ harness: "codex" });
        rig.settings.model = "openai/gpt-5.5:high";
        rig.conversation.send("hi");
        await settled(rig);
        const args = rig.log().find((e) => e.event === "run").argv as string[];
        expect(args[args.indexOf("-m") + 1]).toBe("openai/gpt-5.5:high");
    }, SLOW);

    test("Get Answer puts the question after --", async () => {
        rig = await conversationRig({ harness: "codex" });
        for (const harness of ["codex", "claude-code"] as const) {
            const program = brainProgram(rig.root, harness);
            const asker = new Asker({
                host: rig.host,
                settings: () => ({ name: "Ada", harness, model: null, compaction: "summarize" }),
                resolve: () => program,
                env: () => ({}),
                workdir: path.join(rig.root, "ask"),
            });
            const question = `--help ${HOSTILE}`;
            await asker.ask(question);
            const run = rig.log().filter((e) => e.event === "run").at(-1);
            expect(run.argv.slice(-2)).toEqual(["--", question]);
            expect(Object.keys(run.env)).not.toContain(MCP_TOKEN_ENV);
        }
    }, SLOW);
});
