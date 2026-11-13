import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "../../src/contract";
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

// shell text, quoting and flags: each is one value to the brain, on every system's process launcher
const HOSTILE = `hi; rm -rf ~ && del /s /q C:\\ | echo "PWNED" $(whoami) \`id\` %PATH% ^& --dangerously-bypass-approvals-and-sandbox 'x' {env:${MCP_TOKEN_ENV}} {file:~/.ssh/id_rsa}`;

const HARNESSES = ["codex", "claude-code", "opencode"] as const;

/** the run files a turn or a question left behind: none, once it's over */
const leftFiles = (...dirs: string[]) => dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.startsWith("paperboard-run-")) : []));

// No argv injection, no token leak, and neither the message nor the instructions on a command line, which other
// users can read and every system caps (Windows: 32,767 characters for all of it; Linux: 128 KiB an argument).
describe("what reaches a brain's command line", () => {
    test("the user's message arrives whole over stdin or ACP, and the MCP token only in the environment", async () => {
        for (const harness of HARNESSES) {
            rig = await conversationRig({ harness });
            const { id } = rig.conversation.send(HOSTILE);
            await settled(rig);
            const [run] = rig.log().filter((e) => e.event === "run");
            const argv: string[] = run.argv;
            expect(argv.some((a) => a.includes("PWNED") || a.includes(id))).toBe(false);
            if (harness !== "opencode") expect(rig.turns()[0].message).toBe(`[${id}] ${HOSTILE}`);
            expect(run.env[MCP_TOKEN_ENV]).toBe(rig.mcp.token);
            expect(argv.some((a) => a.includes(rig!.mcp.token))).toBe(false);
            expect(rig.host.startedAs(turnId)[0]!.args.some((a) => a.includes(rig!.mcp.token))).toBe(false);
            await rig.close();
            rig = null;
        }
    }, SLOW * 2);

    test("a turn with the longest message, a full memory and a compaction's seed starts, and none of it is in argv or the environment", async () => {
        // memory as big as it gets: every fact at its longest, and a note's worth of text besides
        const memory = Array.from({ length: LIMITS.memory.facts }, (_, i) => `- memory-fact-${i} ${"m".repeat(LIMITS.memory.factChars - 20)}`).join("\n");
        const sections = async () => ({ tools: [`**Memory:**\n${memory}`, `**Notes:** ${"n".repeat(20_000)}`], now: [`**Routines:** ${"r".repeat(5_000)}`] });
        for (const harness of HARNESSES) {
            rig = await conversationRig({ harness, instructions: sections });
            // a compacted conversation: a long summary, and its latest ten messages, each at the longest
            const entries = Array.from({ length: 10 }, (_, i) => ({ id: `old00${i}`, at: 1_000 + i, kind: i % 2 ? "agent" : "user", text: `seed-${i} ${"s".repeat(LIMITS.message - 10)}` }));
            fs.writeFileSync(path.join(rig.dir, "transcript.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
            fs.writeFileSync(path.join(rig.dir, "carry.json"), JSON.stringify({ summary: `SUMMARY ${"y".repeat(40_000)}`, from: "old000" }));
            await rig.conversation.shutdown();
            rig.restart();
            const message = `the longest message ${"z".repeat(LIMITS.message - 30)}`;
            const { id } = rig.conversation.send(message);
            await settled(rig);
            expect(rig.conversation.history().filter((e) => e.kind === "error")).toEqual([]);
            expect(rig.conversation.history().at(-1)).toMatchObject({ kind: "agent" });
            const run = rig.log().filter((e) => e.event === "run").at(-1);
            const argv: string[] = run.argv;
            const launched = [...argv, ...Object.values(run.env as Record<string, string>)].join(" ");
            for (const part of ["zzzzzzzzzz", "seed-", "SUMMARY", "memory-fact-", "nnnnnnnnnn", "rrrrrrrrrr", "You are Ada"]) expect(launched).not.toContain(part);
            // what's left on the command line is a fixed few flags, far under every system's cap
            expect(argv.join(" ").length).toBeLessThan(8_000);
            if (harness === "opencode") {
                const config = rig.log().find((e) => e.event === "acp-config");
                expect(config.instructions).toContain("memory-fact-99");
                if (process.platform !== "win32") expect(config.instructionsMode).toBe(0o600);
            } else {
                const turn = rig.turns().at(-1);
                expect(turn.message).toContain("SUMMARY yyyy");
                expect(turn.message).toContain("seed-9");
                expect(turn.message.endsWith(`[${id}] ${message}`)).toBe(true);
                expect(turn.message.length).toBeGreaterThan(200_000);
                expect(turn.instructions).toContain("memory-fact-99");
                expect(turn.instructions).toContain("You are Ada");
                if (process.platform !== "win32") expect(turn.instructionsMode).toBe(0o600);
            }
            expect(leftFiles(path.join(rig.dir, "run"), path.join(rig.root, "storage", "brains", "codex"))).toEqual([]);
            await rig.close();
            rig = null;
        }
    }, SLOW * 3);

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

    test("Get Answer hands over the question and its instructions the same way", async () => {
        rig = await conversationRig({ harness: "codex" });
        const codexHome = path.join(rig.root, "storage", "brains", "codex");
        const filesDir = path.join(rig.root, "ask-run");
        for (const harness of ["codex", "claude-code"] as const) {
            const program = brainProgram(rig.root, harness);
            const asker = new Asker({
                host: rig.host,
                settings: () => ({ name: "Ada", harness, model: null, compaction: "summarize", automationInstructions: `custom-instructions ${HOSTILE}` }),
                resolve: () => program,
                env: () => (harness === "codex" ? { CODEX_HOME: codexHome } : {}),
                workdir: path.join(rig.root, "ask"),
                filesDir,
            });
            const question = `--help ${HOSTILE}`;
            await asker.ask(question);
            const run = rig.log().filter((e) => e.event === "run").at(-1);
            const turn = rig.turns().at(-1);
            expect(turn.message).toBe(question);
            expect(turn.instructions).toContain("custom-instructions");
            expect((run.argv as string[]).some((a) => a.includes("PWNED") || a.includes("custom-instructions"))).toBe(false);
            expect(Object.keys(run.env)).not.toContain(MCP_TOKEN_ENV);
            expect(leftFiles(filesDir, codexHome)).toEqual([]);
        }
    }, SLOW);
});
