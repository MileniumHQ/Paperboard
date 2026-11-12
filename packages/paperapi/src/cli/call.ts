// `paperapi call` and `paperapi restart`: what a panel does, from the
// terminal, as this computer's host.
import fs from "fs";
import path from "path";
import { isPanelId } from "../panelIdentity";
import { callBlockId } from "../serviceCalls";
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

// a block's registry entry: "command.kick" or "server1/command.kick"
const BLOCK_ENTRY = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?(command|value)\.[a-z0-9][a-z0-9-]{0,63}$/;

type ListedInputs = Record<string, { type?: string; optional?: boolean }>;

interface ListedBlock {
    entry: string;
    schema?: { kind?: string; name?: string; inputs?: ListedInputs };
}

function describeInputs(inputs: ListedInputs | undefined): string {
    if (!inputs || typeof inputs !== "object") return "";
    return Object.entries(inputs)
        .map(([name, input]) => `${name}${input?.optional ? "?" : ""}: ${input?.type ?? "any"}`)
        .join(", ");
}

async function listBlocks(connection: HostConnection, panel: string, output: Output): Promise<number> {
    const { entries } = await connection.request<{ entries: ListedBlock[] }>("blocks:list", { panelId: panel });
    const runnable = entries.filter((e) => BLOCK_ENTRY.test(e.entry));
    if (runnable.length === 0) {
        throw new CliError(
            `${panel} has no blocks to run right now`,
            "Blocks exist while the panel's service has registered them; run paperapi doctor to check its service. A service's own calls are never listed: name one to run it.",
        );
    }
    const width = Math.max(...runnable.map((e) => e.entry.length));
    output.note(output.err.dim(`${runnable.length} ${runnable.length === 1 ? "block" : "blocks"} on ${panel}:`));
    for (const block of runnable.sort((a, b) => a.entry.localeCompare(b.entry))) {
        const inputs = describeInputs(block.schema?.inputs);
        output.line(`${output.out.bold(block.entry.padEnd(width))}  ${block.schema?.name ?? ""}${inputs ? `  ${output.out.dim(`(${inputs})`)}` : ""}`);
    }
    return EXIT_OK;
}

export interface CallOptions {
    timeout?: string;
}

/**
 * Runs a block ("command.kick", "server1/value.players", inputs an object)
 * or one of the panel service's own calls ("greet", any JSON input), as
 * this computer's host. With nothing named, lists the panel's blocks.
 */
export async function runCall(panelArg: string, name: string | undefined, inputText: string | undefined, options: CallOptions, output: Output): Promise<number> {
    if (!isPanelId(panelArg)) throw usageError(`"${panelArg}" is not a panel id`);
    const panel = panelArg;
    const timeoutMs = parseTimeout(options.timeout);
    const input = parseInputs(inputText);
    const block = name !== undefined && BLOCK_ENTRY.test(name);
    if (block && input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
        throw usageError("A block's inputs are one JSON object", `Name each input: '{"player":"Steve"}'.`);
    }
    let entry: string | undefined;
    if (name !== undefined) {
        try {
            entry = block ? name : `command.${callBlockId(name)}`;
        } catch (err) {
            throw usageError((err as Error).message);
        }
    }
    const connection = await HostConnection.open();
    try {
        if (entry === undefined) return await listBlocks(connection, panel, output);
        const request = { inputs: block ? (input ?? {}) : input === undefined ? {} : { input } };
        const started = performance.now();
        let answer: { result?: unknown };
        try {
            // the daemon's own deadline answers first; this one only guards a silent socket
            answer = await connection.request("blocks:call", { panelId: panel, entry, request, timeoutMs }, timeoutMs === null ? null : timeoutMs + 5_000);
        } catch (err) {
            if (!(err instanceof DaemonError)) throw err;
            const missing = /not registered or unavailable/.test(err.message);
            throw new CliError(
                `${panel} ${name} failed: ${err.message}`,
                missing ? `See ${panel}'s blocks: paperapi call ${panel}. A call is one its service declares in definePanelService's calls.` : undefined,
            );
        }
        output.success(`${panel} ${name} ${output.err.dim(`· ${elapsed(started)}`)}`);
        if (answer?.result !== undefined && answer.result !== null) output.line(JSON.stringify(answer.result, null, 2));
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
