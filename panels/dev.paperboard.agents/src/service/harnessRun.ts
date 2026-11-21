// One run of a harness as a daemon-supervised child, the way a conversation's turn and a flow's question both
// run one: its files written, started, handed its message, its output read as events until it exits or runs
// past its time. What the run was for (a reply, an answer) is the caller's to make of the outcome.

import { errorMessage } from "@mileniumhq/paperapi";
import { AcpTurn, type AcpEvent, type AcpTurnOptions } from "./acp";
import { feed, parseTurnLine, writeRunFiles, type AskLaunch } from "./harness";
import type { TurnHost } from "./conversation";
import { BRAINS, type Harness } from "../contract";
import { writeLine } from "./mcpClient";
import { lineReader } from "./lines";

const MAX_LINE = 16 * 1024 * 1024; // one event can carry a screenshot

export interface HarnessRun {
    host: TurnHost;
    id: string;
    harness: Harness;
    launch: AskLaunch;
    cwd: string;
    /** besides the launch's own */
    env: Record<string, string>;
    ms: number;
    /** an ACP harness (OpenCode) is driven over its input; null for one that reads its message and prints */
    acp: Omit<AcpTurnOptions, "write" | "emit"> | null;
    onEvent: (ev: AcpEvent) => void;
    /** stops the child: once it has answered (OpenCode would wait for another prompt), or past its time */
    stop: () => Promise<void>;
    /** a run past its time that couldn't be stopped */
    unstopped: (e: Error) => void;
    /** every line in and out, for the developer's log */
    line?: (stream: "stdout" | "stderr" | "stdin", text: string) => void;
}

export interface HarnessOutcome {
    code: number | undefined;
    failures: string[];
    /** the end of its stderr */
    stderr: string;
    /** the message it couldn't be handed, if it ended first: its own exit says why, when it failed */
    unfed: Error | null;
    timedOut: boolean;
    /** its prompt was answered (ACP) */
    answered: boolean;
}

export async function runHarness(o: HarnessRun): Promise<HarnessOutcome> {
    const out: HarnessOutcome = { code: undefined, failures: [], stderr: "", unfed: null, timedOut: false, answered: false };
    const onEvent = (ev: AcpEvent) => {
        if (ev.type === "failed") out.failures.push(ev.message);
        else if (ev.type === "done") {
            out.answered = true;
            // quiet: its time limit stops it anyway; the answer is already in
            void o.stop().catch((e) => console.error(`[agents] couldn't stop ${BRAINS[o.harness].program} after its answer (its time limit still will): ${errorMessage(e)}`));
        }
        o.onEvent(ev);
    };
    // each header value as it appears inside the JSON line
    const secrets = (o.acp?.mcpServers ?? []).flatMap((s) => (s.headers ?? []).map((h) => JSON.stringify(h.value).slice(1, -1))).filter((v) => v.length > 0);
    const acp = o.acp
        ? new AcpTurn({
              ...o.acp,
              write: (line) => {
                  // the log is written to disk: the MCP servers' headers carry the panel's token, taken out by value
                  const logged = secrets.reduce((l, v) => l.replaceAll(v, "[redacted]"), line);
                  o.line?.("stdin", logged);
                  return writeLine(o.host.write, o.id, line);
              },
              emit: onEvent,
          })
        : null;
    const onLine = (line: string) => {
        o.line?.("stdout", line);
        if (acp) acp.line(line);
        else for (const ev of parseTurnLine(o.harness, line)) onEvent(ev);
    };
    // a line past the cap is dropped to its end, and the run says so
    const stdout = lineReader(MAX_LINE, onLine, () => out.failures.push(`${BRAINS[o.harness].program} printed a line over ${MAX_LINE / 1024 / 1024} MB, which couldn't be read`));
    // every listener goes when the run is over, whether or not it ever started
    const offs: (() => void)[] = [];
    const exited = new Promise<number | undefined>((ok) => {
        offs.push(
            o.host.onStdout(o.id, stdout.push),
            o.host.onStderr(o.id, (data) => {
                o.line?.("stderr", data);
                out.stderr = (out.stderr + data).slice(-4000);
            }),
        );
        offs.push(
            o.host.onExit(o.id, (code) => {
                for (const off of offs) off();
                ok(code);
            }),
        );
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const removeFiles = writeRunFiles(o.launch.files);
    try {
        await o.host.start({ id: o.id, command: o.launch.command, args: o.launch.args, cwd: o.cwd, env: { ...o.env, ...o.launch.env } });
        timer = setTimeout(() => {
            out.timedOut = true;
            o.stop().catch(o.unstopped);
        }, o.ms);
        // Codex and Claude read the message to the end of their input before they start; ACP talks over it
        const fed = o.launch.input === null ? null : feed(o.host, o.id, o.launch.input).catch((e: Error) => void (out.unfed = e));
        const driven = acp?.run();
        out.code = await exited;
        await fed;
        stdout.end();
        acp?.close();
        await driven;
    } finally {
        clearTimeout(timer);
        removeFiles();
        for (const off of offs) off();
    }
    return out;
}

/**
 * Why a run that ended in time didn't do its job, or null: its last reported failure, an exit that failed
 * before it answered (`who` ended…), or the `what` it never took.
 */
export function harnessFailure(r: HarnessOutcome, harness: Harness, who: string, what: string): string | null {
    if (r.failures.length) return r.failures[r.failures.length - 1]!;
    const stderr = r.stderr.trim();
    if (r.code !== 0 && !r.answered) return `${who} ended with exit ${r.code ?? "?"}${stderr ? `: ${stderr.split("\n").slice(-3).join(" ").slice(0, 400)}` : ""}`;
    if (r.unfed) return `${BRAINS[harness].program} ended before it took the ${what}: ${errorMessage(r.unfed)}`;
    return null;
}
