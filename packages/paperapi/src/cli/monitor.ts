// `paperapi monitor`: PaperAPI traffic on this computer, live. One line per
// call the daemon answered (who called, what, how long, and how it went),
// per broadcast event, and per service or process starting and stopping.
import { requirePanelId } from "../panelIdentity";
import {
    MONITOR_FRAME,
    MONITOR_PROTOCOL,
    MONITOR_SUBSCRIBE,
    type MonitorArg,
    type MonitorRecord,
} from "../monitorProtocol";
import { HostConnection, DaemonError, DaemonUnavailable, readHandshake, type CloseInfo } from "./daemon";
import { CliError, EXIT_OK, type Output, type Paint } from "./output";

export interface MonitorOptions {
    panel?: string;
    json?: boolean;
}

const RECONNECT_MS = 1_000;
// close codes that mean "you may not", not "I went away": retrying cannot help
const REFUSED_CLOSE_CODES = new Set([4401, 4403, 4429]);

function clock(at: number): string {
    const d = new Date(at);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function bytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function duration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(1)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

/** One argument as a person reads it: names by value, content by shape. */
export function formatArg(value: MonitorArg): string {
    if (value === null) return "null";
    if (typeof value === "string") return /^[^\s"=]+$/.test(value) ? value : JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    switch (value.type) {
        case "string":
            return `‹${value.size} chars›`;
        case "array":
            return `[${value.size}]`;
        case "object":
            return `{${value.keys.join(",")}}`;
        default:
            return `‹${value.type}›`;
    }
}

function formatArgs(args: Record<string, MonitorArg>, skip: Set<string>): string {
    return Object.entries(args)
        .filter(([key]) => !skip.has(key))
        .map(([key, value]) => `${key}=${formatArg(value)}`)
        .join(" ");
}

// columns start wide enough for most panel ids and methods, and grow to the
// widest value seen, so the feed lines up as it goes
class Columns {
    private panel = 24;
    private method = 20;

    fit(panel: string, method: string): { panel: string; method: string } {
        this.panel = Math.max(this.panel, Math.min(panel.length, 40));
        this.method = Math.max(this.method, Math.min(method.length, 32));
        return { panel: panel.padEnd(this.panel), method: method.padEnd(this.method) };
    }
}

export class MonitorFormatter {
    private columns = new Columns();

    constructor(private paint: Paint) {}

    format(record: MonitorRecord): string {
        const p = this.paint;
        const who = record.panel ?? "host";
        const time = p.dim(clock(record.at));
        switch (record.type) {
            case "rpc": {
                const cols = this.columns.fit(who, record.method);
                const outcome = record.ok
                    ? p.green("ok")
                    : p.red(`✗ ${record.code ? `${record.code} ` : ""}${record.error ?? ""}`);
                // the caller's own id is already in the panel column
                const args = formatArgs(record.args, new Set(record.args.panelId === record.panel ? ["panelId"] : []));
                return [time, p.cyan(cols.panel), p.bold(cols.method), duration(record.ms).padStart(9), outcome, args ? p.dim(args) : ""]
                    .filter(Boolean).join("  ");
            }
            case "event": {
                const label = `event ${record.event}`;
                const cols = this.columns.fit(who, label);
                const reach = `${bytes(record.bytes)} → ${record.recipients} ${record.recipients === 1 ? "socket" : "sockets"}`;
                return [time, p.cyan(cols.panel), p.magenta(cols.method), p.dim(reach)].join("  ");
            }
            case "service": {
                const label = `service ${record.state}`;
                const cols = this.columns.fit(who, label);
                const tone = record.state === "ready" || record.state === "starting" ? p.blue : record.state === "stopped" || record.state === "asleep" ? p.dim : p.red;
                const detail = [
                    record.pid !== undefined ? `pid ${record.pid}` : "",
                    record.code !== undefined ? `code ${record.code}` : "",
                    record.error ?? "",
                ].filter(Boolean).join(" · ");
                return [time, p.cyan(cols.panel), tone(cols.method), detail ? p.dim(detail) : ""].filter(Boolean).join("  ");
            }
            case "workload": {
                const label = `process ${record.state}`;
                const cols = this.columns.fit(who, label);
                const failed = record.state === "exited" && record.code !== 0 && record.code !== undefined;
                const detail = [record.id, record.code !== undefined ? `code ${record.code}` : ""].filter(Boolean).join(" · ");
                return [time, p.cyan(cols.panel), (failed ? p.red : p.blue)(cols.method), p.dim(detail)].join("  ");
            }
        }
    }
}

interface Session {
    connection: HostConnection;
    closed: Promise<CloseInfo>;
}

async function subscribe(options: MonitorOptions, onRecord: (record: MonitorRecord) => void): Promise<Session> {
    const connection = await HostConnection.open(readHandshake());
    const closed = new Promise<CloseInfo>((resolve) => connection.onClose(resolve));
    connection.onFrame((frame) => {
        if (frame?.type === MONITOR_FRAME && frame.record) onRecord(frame.record as MonitorRecord);
    });
    let answer: { protocol?: unknown };
    try {
        answer = await connection.request(MONITOR_SUBSCRIBE, options.panel ? { panelId: options.panel } : {});
    } catch (err) {
        connection.close();
        if (err instanceof DaemonError && err.code === "NOT_FOUND") {
            throw new CliError(
                `The Paperboard on ${connection.address} has no traffic monitor`,
                "It predates `paperapi monitor`; update Paperboard.",
            );
        }
        throw err;
    }
    if (answer?.protocol !== MONITOR_PROTOCOL) {
        connection.close();
        throw new CliError(
            `The Paperboard on ${connection.address} speaks monitor protocol ${String(answer?.protocol)}, this paperapi speaks ${MONITOR_PROTOCOL}`,
            "Update whichever of the two is older.",
        );
    }
    return { connection, closed };
}

/**
 * Streams records until interrupted. A daemon that stops or restarts is
 * waited for and watched again; a refusal ends the command with its reason.
 * Resolves with the exit code once `stop` fires.
 */
export async function runMonitor(options: MonitorOptions, output: Output, stop: Promise<void>): Promise<number> {
    if (options.panel !== undefined) requirePanelId(options.panel);
    const formatter = new MonitorFormatter(output.out);
    const onRecord = (record: MonitorRecord) => output.line(options.json ? JSON.stringify(record) : formatter.format(record));
    const scope = options.panel ? `calls involving ${options.panel}` : "every panel";
    let stopped = false;
    void stop.then(() => {
        stopped = true;
    });

    // the first connection must work: there is nothing to watch otherwise
    let session = await subscribe(options, onRecord);
    output.note(output.err.dim(`Watching ${scope} on Paperboard at ${session.connection.address}. Press Ctrl+C to stop.`));
    for (;;) {
        const outcome = await Promise.race([session.closed, stop.then(() => null)]);
        if (outcome === null) {
            session.connection.close();
            return EXIT_OK;
        }
        if (REFUSED_CLOSE_CODES.has(outcome.code)) {
            throw new CliError(`Paperboard ended the monitor: ${outcome.reason || `code ${outcome.code}`}`);
        }
        output.note(output.err.yellow(`Paperboard went away (${outcome.reason || `code ${outcome.code}`}). Waiting for it to come back.`));
        let lastProblem = "";
        for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([new Promise((resolve) => { timer = setTimeout(resolve, RECONNECT_MS); }), stop]);
            clearTimeout(timer);
            if (stopped) return EXIT_OK;
            try {
                session = await subscribe(options, onRecord);
                output.note(output.err.dim(`Watching again on Paperboard at ${session.connection.address}.`));
                break;
            } catch (err) {
                // a daemon that is not up yet is waited for; a refusal will
                // not change by waiting, so it ends the command
                if (!(err instanceof DaemonUnavailable)) throw err;
                if (err.message !== lastProblem) output.note(output.err.dim(`  ${err.message}`));
                lastProblem = err.message;
            }
        }
    }
}
