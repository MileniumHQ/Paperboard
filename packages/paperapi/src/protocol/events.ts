// The events the daemon pushes, each with its payload's shape: a socket's
// own streams (a terminal's output, a download's progress) and the
// broadcasts it declared with events:subscribe. A client reads each payload
// against its shape before a listener hears it, under the RPC's skew rules
// (rpc.ts): fields a shape doesn't name pass untouched, null for an optional
// field leaves it out, and a shape requires only what its listeners read.
// Events named at run time (a Blocks event, "blocks:<panel>:<entry>") carry
// what the panel that fires them says, and are not declared here.
import { shape, type Infer, type Shape } from "../shape";
import type { BackupProgress } from "../backups";
import { BACKUP_PROGRESS_EVENT } from "../channels";
import { PROBLEMS_EVENT, type PanelProblem } from "../problemShape";
import { anyText, InvalidParamsError, list, numeric, object, readValue } from "./fields";

// a payload whose listeners read it as the type the wire carries
const typed = <T>(): Shape<T> => ({ check: () => null });

type ProgressStage = "starting" | "checking" | "stopping" | "downloading" | "verifying" | "extracting" | "completed" | "error";

const ofStream = { id: anyText() };
// a terminal or a process ended; a program killed by a signal has no code
const exited = object({ ...ofStream, exitCode: shape.optional(shape.nullable(numeric())) });
// a registry gained or lost an entry, a project, or a socket's registrations;
// what else it names travels as the daemon gives it
const registryChange = object({
    type: anyText(),
    panelId: shape.optional(typed<string>()),
    entry: shape.optional(typed<string>()),
    project: shape.optional(typed<unknown>()),
});

export const EVENTS = {
    "term:data": object({ ...ofStream, data: anyText() }),
    "term:exit": exited,
    "term:foreground": object({ ...ofStream, name: anyText() }),
    "term:command": object({ ...ofStream, command: anyText(), exitCode: numeric() }),
    "term:cwd": object({ ...ofStream, cwd: anyText() }),
    "process:data": object({ ...ofStream, data: anyText(), stream: anyText() }),
    "process:exit": exited,
    // how far a download, an install or an update is: only its id is read
    // here, and the rest travels as the daemon gives it; target names which
    // of an update's parts it is about
    progress: object({
        downloadId: anyText(),
        stage: typed<ProgressStage>(),
        percent: typed<number>(),
        bytesLoaded: shape.optional(typed<number>()),
        bytesTotal: shape.optional(typed<number>()),
        message: shape.optional(typed<string>()),
        target: shape.optional(typed<string>()),
    }),
    // null names no source, or a backup that ended
    [BACKUP_PROGRESS_EVENT]: object({ panelId: anyText(), sourceId: shape.optional(shape.nullable(anyText())), progress: shape.optional(shape.nullable(typed<BackupProgress>())) }),
    [PROBLEMS_EVENT]: object({ panelId: anyText(), problems: list(typed<PanelProblem>()) }),
    "blocks:registry-updated": registryChange,
} as const satisfies Record<string, Shape<unknown>>;

export type RpcEvent = keyof typeof EVENTS;
/** What an event's listeners hear: its payload as read, or what the panel that fired it said. */
export type EventPayload<E extends string> = E extends RpcEvent ? Infer<(typeof EVENTS)[E]> : unknown;
/** How far a download, an install or an update is. */
export type ProgressEvent = EventPayload<"progress">;

export function isRpcEvent(event: unknown): event is RpcEvent {
    return typeof event === "string" && Object.hasOwn(EVENTS, event);
}

/** An event's payload, checked; one that doesn't fit throws, naming the event. */
export function readEvent<E extends string>(event: E, payload: unknown): EventPayload<E> {
    if (!isRpcEvent(event)) return payload as EventPayload<E>;
    try {
        const payloadShape: Shape<unknown> = EVENTS[event];
        return readValue(payloadShape, payload, "") as EventPayload<E>;
    } catch (err) {
        if (err instanceof InvalidParamsError) throw new Error(`Paperboard Server's ${event} event doesn't fit: ${err.message}`);
        throw err;
    }
}
