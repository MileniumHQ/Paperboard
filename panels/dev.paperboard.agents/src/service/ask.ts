// A question from a flow (the Get Answer action), answered outside the
// conversation: the harness runs once in a fresh thread with no memory, no
// computer and no texting, and its last message is the answer. Nothing joins
// the chat, and the conversation's turn keeps running alongside.
//
// Each ask is its own daemon-supervised child. A flow waits 30 s for an
// action, so an ask that hasn't answered by ASK_MS is stopped and fails.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { LIMITS, PANEL_ID, type Harness, type Settings } from "../contract";
import { AcpTurn, type AcpEvent } from "./acp";
import { askLaunch, HARNESS_NAMES, parseTurnLine } from "./harness";
import { writeLine } from "./mcpClient";
import type { TurnHost } from "./conversation";

/** under the 30 s a flow gives an action, so the ask fails with its own reason first */
export const ASK_MS = 28_000;
/** questions answered at once; past this, an ask is refused rather than queued past its flow's deadline */
export const MAX_ASKING = 4;
const MAX_LINE = 16 * 1024 * 1024;

export interface AskDeps {
    host: TurnHost;
    settings: () => Settings | null;
    resolve: (harness: Harness) => string | null;
    /** an empty folder to run in: no project files or instruction files for the harness to pick up */
    workdir: string;
    askMs?: number;
}

export class Asker {
    private running = new Set<string>();
    private closed = false;

    constructor(private deps: AskDeps) {}

    /** `instructions`: the flow's own, in place of the ones in settings */
    async ask(question: unknown, instructions?: string): Promise<string> {
        if (this.closed) throw new Error("the Agents service is shutting down");
        const text = typeof question === "string" ? question.trim() : "";
        if (!text) throw new Error("ask something first");
        if (text.length > LIMITS.message) throw new Error(`questions are limited to ${LIMITS.message} characters`);
        const settings = this.deps.settings();
        if (!settings) throw new Error("set up the agent in the Agents panel first");
        const own = instructions?.trim();
        if (own && own.length > LIMITS.instructions) throw new Error(`instructions are limited to ${LIMITS.instructions} characters`);
        const custom = own || settings.automationInstructions || null;
        const command = this.deps.resolve(settings.harness);
        if (!command) throw new Error(`${HARNESS_NAMES[settings.harness]} isn't installed on this computer anymore`);
        if (this.running.size >= MAX_ASKING) throw new Error(`the agent is already answering ${MAX_ASKING} questions; ask again once one is done`);
        const id = `${PANEL_ID}.ask.${randomUUID()}`;
        this.running.add(id);
        try {
            return await this.run(id, settings, command, text, custom);
        } finally {
            this.running.delete(id);
        }
    }

    async shutdown() {
        this.closed = true;
        await Promise.allSettled([...this.running].map((id) => this.deps.host.kill(id, "SIGKILL")));
    }

    private async run(id: string, settings: Settings, command: string, question: string, instructions: string | null): Promise<string> {
        const { host } = this.deps;
        const launch = askLaunch({ harness: settings.harness, command, model: settings.model, name: settings.name, question, instructions });
        const messages: string[] = [];
        const failures: string[] = [];
        let answered = false;
        let timedOut = false;
        let stderr = "";
        let buf = "";
        const onEvent = (ev: AcpEvent) => {
            if (ev.type === "message") messages.push(ev.text);
            else if (ev.type === "failed") failures.push(ev.message);
            else if (ev.type === "done") {
                // OpenCode waits for another prompt once it has answered
                answered = true;
                void host.kill(id, "SIGTERM").catch((e) => console.error(`[ai] couldn't stop OpenCode after its answer: ${e instanceof Error ? e.message : e}`));
            }
        };
        const acp =
            settings.harness === "opencode"
                ? new AcpTurn({
                      cwd: this.deps.workdir,
                      thread: null,
                      model: settings.model,
                      message: question,
                      // no tool servers to wait for
                      ready: async () => {},
                      write: (line) => writeLine(host.write, id, line),
                      emit: onEvent,
                  })
                : null;
        const onLine = (line: string) => {
            if (acp) acp.line(line);
            else for (const ev of parseTurnLine(settings.harness, line)) onEvent(ev);
        };
        const exited = new Promise<number | undefined>((ok) => {
            const offs = [
                host.onStdout(id, (data) => {
                    buf += data;
                    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
                        onLine(buf.slice(0, i));
                        buf = buf.slice(i + 1);
                    }
                    if (buf.length > MAX_LINE) buf = "";
                }),
                host.onStderr(id, (data) => {
                    stderr = (stderr + data).slice(-4000);
                }),
            ];
            offs.push(
                host.onExit(id, (code) => {
                    for (const off of offs) off();
                    ok(code);
                }),
            );
        });
        fs.mkdirSync(this.deps.workdir, { recursive: true });
        await host.start({
            id,
            command: launch.command,
            args: launch.args,
            cwd: this.deps.workdir,
            env: launch.env,
            ...(acp ? {} : { stdin: false }),
        });
        const ms = this.deps.askMs ?? ASK_MS;
        const timer = setTimeout(() => {
            timedOut = true;
            void host.kill(id, "SIGKILL").catch((e) => console.error(`[ai] couldn't stop a question past its time: ${e instanceof Error ? e.message : e}`));
        }, ms);
        let code: number | undefined;
        try {
            const driven = acp?.run();
            code = await exited;
            if (buf.trim()) onLine(buf);
            acp?.close();
            await driven;
        } finally {
            clearTimeout(timer);
        }
        if (timedOut) throw new Error(`the agent didn't answer within ${Math.round(ms / 1000)} seconds`);
        if (failures.length) throw new Error(failures[failures.length - 1]);
        if (code !== 0 && !answered) throw new Error(`${HARNESS_NAMES[settings.harness]} ended with exit ${code ?? "?"}${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400)}` : ""}`);
        // what it said before searching ("let me look that up") isn't the answer; its last message is
        const answer = messages.map((m) => m.trim()).filter(Boolean).at(-1);
        if (!answer) throw new Error("the agent gave no answer");
        return answer;
    }
}
