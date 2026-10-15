// A panel page asking its shell for something only the shell can show (a
// file picker, the backup location chooser). The request travels over
// postMessage tagged with the generation the shell gave this document; the
// answer is taken only from the parent, for this request and generation.
import { currentFrameSession } from "./frameSession";

export interface ShellRequest<R> {
    /** message type out; the answer comes back as `${type}-result` */
    type: string;
    fields: Record<string, unknown>;
    /** errors for the cases every request shares */
    unavailable: () => Error;
    widget: () => Error;
    busy: () => Error;
    /** the shell's answer as a result, or the Error to reject with */
    parse: (result: unknown) => R | Error;
}

// one open request per type per document; the shell refuses a second
// anyway, and an open request is the only listener this module keeps
const pending = new Set<string>();

export function requestShell<R>(request: ShellRequest<R>): Promise<R> {
    const session = currentFrameSession();
    if (!session || typeof window === "undefined") return Promise.reject(request.unavailable());
    if (session.widget) return Promise.reject(request.widget());
    if (pending.has(request.type)) return Promise.reject(request.busy());
    const requestId = crypto.randomUUID();
    const resultType = `${request.type}-result`;
    pending.add(request.type);
    return new Promise<R>((resolve, reject) => {
        const finish = () => {
            pending.delete(request.type);
            window.removeEventListener("message", receive);
            window.removeEventListener("pagehide", finish);
        };
        const receive = (event: MessageEvent) => {
            const data = event.data;
            if (event.source !== window.parent || data?.type !== resultType) return;
            if (data.generation !== session.generation || data.requestId !== requestId) return;
            finish();
            const parsed = request.parse(data.result);
            if (parsed instanceof Error) reject(parsed);
            else resolve(parsed);
        };
        window.addEventListener("message", receive);
        window.addEventListener("pagehide", finish, { once: true });
        window.parent.postMessage({ type: request.type, generation: session.generation, requestId, ...request.fields }, "*");
    });
}
