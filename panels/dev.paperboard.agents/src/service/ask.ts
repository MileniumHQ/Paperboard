// A question from a flow (the Get Answer action), answered outside the
// conversation: the harness runs once in a fresh thread with no memory, no
// computer and no texting, and its last message is the answer. Nothing joins
// the chat, and the conversation's turn keeps running alongside.
//
// Each ask is its own daemon-supervised child. A flow waits 30 s for an
// action, so an ask that hasn't answered by ASK_MS is stopped and fails.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { errorMessage } from "@mileniumhq/paperapi";
import { LIMITS, PANEL_ID, type Harness, type Settings } from "../contract";
import { askInstructions, askLaunch, HARNESS_NAMES, removeLeftRunFiles, runFilesDir } from "./harness";
import type { TurnLog } from "./turnLog";
import type { TurnHost } from "./conversation";
import { harnessFailure, runHarness } from "./harnessRun";

/** under the 30 s a flow gives an action, so the ask fails with its own reason first */
export const ASK_MS = 28_000;
/** questions answered at once; past this, an ask is refused rather than queued past its flow's deadline */
const MAX_ASKING = 4;

export interface AskDeps {
    host: TurnHost;
    settings: () => Settings | null;
    resolve: (harness: Harness) => string | null;
    /** what the harness runs with besides the daemon's environment: its home, and no updating itself */
    env: (harness: Harness) => Record<string, string>;
    /** why the harness can't answer (not signed in, say), or null */
    problem?: (harness: Harness) => string | null;
    /** an empty folder to run in: no project files or instruction files for the harness to pick up */
    workdir: string;
    /** where a question's instructions file goes (but Codex's, which go in its home): only its run reads it, while it runs */
    filesDir: string;
    askMs?: number;
    /** the developer's log of every turn (turnLog.ts), when it's switched on */
    log?: TurnLog | null;
}

export class Asker {
    private running = new Set<string>();
    private closed = false;

    constructor(private deps: AskDeps) {
        // left by questions the last service generation didn't see to their end (Codex's are the conversation's to remove)
        removeLeftRunFiles(deps.filesDir);
    }

    /** `instructions`: the flow's own, in place of the ones in settings */
    async ask(question: unknown, instructions?: string): Promise<string> {
        if (this.closed) throw new Error("the Agent service is shutting down");
        const text = typeof question === "string" ? question.trim() : "";
        if (!text) throw new Error("ask something first");
        if (text.length > LIMITS.message) throw new Error(`questions are limited to ${LIMITS.message} characters`);
        const settings = this.deps.settings();
        if (!settings) throw new Error("set up the agent in the Agent panel first");
        const own = instructions?.trim();
        if (own && own.length > LIMITS.instructions) throw new Error(`instructions are limited to ${LIMITS.instructions} characters`);
        const custom = own || settings.automationInstructions || null;
        const command = this.deps.resolve(settings.harness);
        if (!command) throw new Error(`${HARNESS_NAMES[settings.harness]} isn't installed. Install it in the agent's settings`);
        const problem = this.deps.problem?.(settings.harness);
        if (problem) throw new Error(problem);
        if (this.running.size >= MAX_ASKING) throw new Error(`the agent is already answering ${MAX_ASKING} questions; ask again once one is done`);
        const id = `${PANEL_ID}.ask.${randomUUID()}`;
        this.running.add(id);
        const log = this.deps.log ?? null;
        const started = Date.now();
        const lines: string[] = [];
        try {
            const answer = await this.run(id, settings, command, text, custom, log ? lines : null);
            log?.ask({ harness: settings.harness, model: settings.model, question: text, instructions: askInstructions(settings.name, custom), answer, ms: Date.now() - started, lines });
            return answer;
        } catch (e) {
            log?.ask({ harness: settings.harness, model: settings.model, question: text, instructions: askInstructions(settings.name, custom), error: errorMessage(e), ms: Date.now() - started, lines });
            throw e;
        } finally {
            this.running.delete(id);
        }
    }

    async shutdown() {
        this.closed = true;
        await Promise.allSettled([...this.running].map((id) => this.deps.host.kill(id, "SIGKILL")));
    }

    private async run(id: string, settings: Settings, command: string, question: string, instructions: string | null, lines: string[] | null): Promise<string> {
        const { host } = this.deps;
        const filesDir = runFilesDir(settings.harness, this.deps.env(settings.harness), this.deps.filesDir);
        const messages: string[] = [];
        const ms = this.deps.askMs ?? ASK_MS;
        fs.mkdirSync(this.deps.workdir, { recursive: true });
        const r = await runHarness({
            host,
            id,
            harness: settings.harness,
            launch: askLaunch({ harness: settings.harness, command, model: settings.model, name: settings.name, question, instructions, filesDir }),
            cwd: this.deps.workdir,
            env: this.deps.env(settings.harness),
            ms,
            // no tool servers to wait for
            acp: settings.harness === "opencode" ? { cwd: this.deps.workdir, thread: null, model: settings.model, message: question, ready: async () => {} } : null,
            onEvent: (ev) => {
                if (ev.type === "message") messages.push(ev.text);
            },
            stop: () => host.kill(id, "SIGKILL"),
            unstopped: (e) => console.error(`[agents] couldn't stop a question past its time: ${errorMessage(e)}`),
            line: lines
                ? (stream, text) => {
                      if (stream === "stdout") lines.push(text);
                  }
                : undefined,
        });
        if (r.timedOut) throw new Error(`the agent didn't answer within ${Math.round(ms / 1000)} seconds`);
        const failed = harnessFailure(r, settings.harness, HARNESS_NAMES[settings.harness], "question");
        if (failed) throw new Error(failed);
        // what it said before searching ("let me look that up") isn't the answer; its last message is
        const answer = messages.map((m) => m.trim()).filter(Boolean).at(-1);
        if (!answer) throw new Error("the agent gave no answer");
        return answer;
    }
}
