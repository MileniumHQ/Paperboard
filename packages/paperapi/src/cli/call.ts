// `paperapi call` and `paperapi restart`: what a panel does, from the
// terminal, as this computer's host.
import fs from "fs";
import path from "path";
import { isPanelId } from "../panelIdentity";
import { HostConnection, DaemonError } from "./daemon";
import { CliError, EXIT_OK, usageError, type Output } from "./output";

const MAX_TIMEOUT_MS = 60_000;

/** A panel named on the command line: a panel folder, or a panel id. */
export function resolvePanel(arg: string | undefined, cwd = process.cwd()): string {
    const dir = path.resolve(cwd, arg ?? ".");
    const manifest = path.join(dir, "manifest.json");
    if (fs.existsSync(manifest)) {
        let id: unknown;
        try {
            id = JSON.parse(fs.readFileSync(manifest, "utf8"))?.id;
        } catch (err) {
            throw new CliError(`${manifest} is not valid JSON: ${(err as Error).message}`);
        }
        if (!isPanelId(id)) throw new CliError(`${manifest} has no valid panel id`, "Run paperapi doctor to see what is wrong with it.");
        return id;
    }
    if (arg !== undefined && isPanelId(arg)) return arg;
    if (arg === undefined) throw usageError("There is no manifest.json here", "Run this in a panel folder, or name the panel: a folder or a panel id.");
    throw usageError(`"${arg}" is neither a panel folder nor a panel id`);
}

export function parseTimeout(value: string | undefined): number | null {
    if (value === undefined) return 30_000;
    if (value === "none") return null;
    const ms = Number(value);
    if (!Number.isInteger(ms) || ms <= 0 || ms > MAX_TIMEOUT_MS) {
        throw usageError(`--timeout must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, or "none"`);
    }
    return ms;
}

export function parseInputs(text: string | undefined): unknown {
    if (text === undefined) return undefined;
    try {
        return JSON.parse(text);
    } catch (err) {
        throw usageError(
            `The inputs are not JSON: ${(err as Error).message}`,
            `Pass one JSON value, quoted for your shell: '{"name":"Ada"}', or '"text"' for a string.`,
        );
    }
}

function elapsed(started: number): string {
    const ms = performance.now() - started;
    return ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

type ListedInputs = Record<string, { type?: string; required?: boolean }>;

interface ListedAction {
    action: string;
    schema?: { name?: string; internal?: boolean; eventOnly?: boolean; inputs?: ListedInputs };
}

function describeInputs(inputs: ListedInputs | undefined): string {
    if (!inputs || typeof inputs !== "object") return "";
    return Object.entries(inputs)
        .map(([name, input]) => `${name}${input?.required ? "" : "?"}: ${input?.type ?? "any"}`)
        .join(", ");
}

async function listActions(connection: HostConnection, panel: string, output: Output): Promise<number> {
    const { actions } = await connection.request<{ actions: ListedAction[] }>("actions:list", { panelId: panel });
    const callable = actions.filter((a) => !a.schema?.eventOnly);
    if (callable.length === 0) {
        throw new CliError(
            `${panel} has no actions to call right now`,
            "Actions exist while the panel's service (or an open window) has registered them; run paperapi doctor to check its service.",
        );
    }
    const width = Math.max(...callable.map((a) => a.action.length));
    output.note(output.err.dim(`${callable.length} ${callable.length === 1 ? "action" : "actions"} on ${panel}:`));
    for (const entry of callable.sort((a, b) => a.action.localeCompare(b.action))) {
        const name = entry.schema?.name && entry.schema.name !== entry.action ? entry.schema.name : "";
        const inputs = describeInputs(entry.schema?.inputs);
        const tags = entry.schema?.internal ? output.out.dim(" (internal)") : "";
        output.line(`${output.out.bold(entry.action.padEnd(width))}  ${name}${tags}${inputs ? `  ${output.out.dim(`(${inputs})`)}` : ""}`);
    }
    return EXIT_OK;
}

export interface CallOptions {
    timeout?: string;
}

export async function runCall(panelArg: string, action: string | undefined, inputsText: string | undefined, options: CallOptions, output: Output): Promise<number> {
    if (!isPanelId(panelArg)) throw usageError(`"${panelArg}" is not a panel id`);
    const panel = panelArg;
    const timeoutMs = parseTimeout(options.timeout);
    const inputs = parseInputs(inputsText);
    const connection = await HostConnection.open();
    try {
        if (action === undefined) return await listActions(connection, panel, output);
        const started = performance.now();
        let answer: { result?: unknown };
        try {
            // the daemon's own deadline answers first; this one only guards a silent socket
            answer = await connection.request("actions:call", { panelId: panel, action, args: [inputs], timeoutMs }, timeoutMs === null ? null : timeoutMs + 5_000);
        } catch (err) {
            if (!(err instanceof DaemonError)) throw err;
            const missing = /not registered or unavailable/.test(err.message);
            throw new CliError(
                `${panel} ${action} failed: ${err.message}`,
                missing ? `See what ${panel} offers: paperapi call ${panel}` : undefined,
            );
        }
        output.success(`${panel} ${action} ${output.err.dim(`· ${elapsed(started)}`)}`);
        if (answer?.result !== undefined) output.line(JSON.stringify(answer.result, null, 2));
        return EXIT_OK;
    } finally {
        connection.close();
    }
}

export async function runRestart(panelArg: string | undefined, output: Output): Promise<number> {
    const panel = resolvePanel(panelArg);
    const connection = await HostConnection.open();
    try {
        const started = performance.now();
        let answer: { restarted?: boolean };
        try {
            // stopping takes up to 6 s and getting ready up to 20 s
            answer = await connection.request("panel:restartService", { panelId: panel }, 60_000);
        } catch (err) {
            if (!(err instanceof DaemonError)) throw err;
            const reason = err.message.replace(/^Restart failed: /, "");
            throw new CliError(
                `${panel}'s service did not restart: ${reason}`,
                /is not installed/.test(reason) ? "Link it first: paperapi link" : `Watch it start: paperapi monitor --panel ${panel}`,
            );
        }
        if (!answer?.restarted) {
            throw new CliError(`${panel} has no service to restart`, "Its manifest.json declares no \"service\".");
        }
        output.success(`Restarted ${panel}'s service ${output.err.dim(`· ready in ${elapsed(started)}`)}`);
        return EXIT_OK;
    } finally {
        connection.close();
    }
}
