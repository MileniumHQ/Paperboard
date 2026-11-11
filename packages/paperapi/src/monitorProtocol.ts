// The traffic monitor's wire contract, shared by the daemon that emits it and
// the `paperapi monitor` command that prints it.
//
// A socket authenticated with this computer's own host token (the one in
// local/crane.json) sends `monitor:subscribe`; from its answer on, the daemon
// sends it one `{ type: "monitor", record }` frame per handled call, event
// and lifecycle change. Records never carry secret values or file contents:
// arguments arrive as a summary (see MonitorArg).

export const MONITOR_SUBSCRIBE = "monitor:subscribe";
export const MONITOR_UNSUBSCRIBE = "monitor:unsubscribe";
export const MONITOR_FRAME = "monitor";
/** Bumped when a record changes shape in a way a reader must know about. */
export const MONITOR_PROTOCOL = 1;

/**
 * One argument of a call. Identifiers the protocol defines (panelId, action,
 * event, id, path, name, ...) arrive as their value; everything else arrives
 * as its shape only: a string or array as its size, an object as its keys.
 */
export type MonitorArg =
    | string
    | number
    | boolean
    | null
    | { type: "string"; size: number }
    | { type: "number" }
    | { type: "boolean" }
    | { type: "array"; size: number }
    | { type: "object"; keys: string[] };

/** A request the daemon answered. `panel` is the caller; null is the host. */
export interface MonitorRpcRecord {
    type: "rpc";
    /** epoch milliseconds the request arrived */
    at: number;
    panel: string | null;
    method: string;
    /** the panel the call names in its panelId argument, when it names one */
    target?: string;
    /** milliseconds from arrival to answer */
    ms: number;
    ok: boolean;
    error?: string;
    code?: string;
    args: Record<string, MonitorArg>;
}

/** A broadcast event. `panel` is the socket that caused it; null is the host or the daemon. */
export interface MonitorEventRecord {
    type: "event";
    at: number;
    panel: string | null;
    event: string;
    /** size of the event frame, in bytes */
    bytes: number;
    /** sockets the event was delivered to */
    recipients: number;
}

/** asleep: stopped for having nothing to do; the next call to it starts it again */
export type MonitorServiceState = "starting" | "ready" | "exited" | "stopped" | "asleep" | "failed";

/** A panel service changed state. */
export interface MonitorServiceRecord {
    type: "service";
    at: number;
    panel: string;
    state: MonitorServiceState;
    pid?: number;
    /** exit code, for exited, stopped and asleep */
    code?: number | null;
    /** why, for failed */
    error?: string;
}

/** A supervised process or terminal started or exited. `panel` is its owner; null is the host. */
export interface MonitorWorkloadRecord {
    type: "workload";
    at: number;
    panel: string | null;
    id: string;
    state: "started" | "exited";
    code?: number | null;
}

export type MonitorRecord =
    | MonitorRpcRecord
    | MonitorEventRecord
    | MonitorServiceRecord
    | MonitorWorkloadRecord;

/** A lifecycle change as the engine reports it, before the monitor stamps the time. */
export type MonitorLifecycle =
    | Omit<MonitorServiceRecord, "at">
    | Omit<MonitorWorkloadRecord, "at">;

/** Whether a record involves a panel: it made the call, the call names it, or it is the panel's service or workload. */
export function monitorRecordInvolves(record: MonitorRecord, panelId: string): boolean {
    if (record.panel === panelId) return true;
    return record.type === "rpc" && record.target === panelId;
}
