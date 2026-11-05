// A panel page asking its shell for something only the shell can show (a
// file picker, the backup location chooser). The request travels over
// postMessage tagged with the generation the shell gave this document; the
// answer is taken only from the parent, for this request and generation.
// Taking a request back (its signal aborts, or the page goes away) tells
// the shell with `${type}-cancel`, same request and generation.
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
    /** takes the request back when `signal` aborts, rejecting with `error` */
    cancel?: { signal?: AbortSignal; error: () => Error };
}

// one open request per type per document; the shell refuses a second
// anyway, and an open request is the only listener this module keeps
const pending = new Set<string>();

export function requestShell<R>(request: ShellRequest<R>): Promise<R> {
    const session = currentFrameSession();
    if (!session || typeof window === "undefined") return Promise.reject(request.unavailable());
    if (session.widget) return Promise.reject(request.widget());
    const signal = request.cancel?.signal;
    if (signal?.aborted) return Promise.reject(request.cancel!.error());
    if (pending.has(request.type)) return Promise.reject(request.busy());
    const requestId = crypto.randomUUID();
    const resultType = `${request.type}-result`;
    pending.add(request.type);
    return new Promise<R>((resolve, reject) => {
        const finish = () => {
            pending.delete(request.type);
            window.removeEventListener("message", receive);
            window.removeEventListener("pagehide", takeBack);
            signal?.removeEventListener("abort", abort);
        };
        // the page going away leaves nobody to answer: the shell stops too
        const takeBack = () => {
            finish();
            window.parent.postMessage({ type: `${request.type}-cancel`, generation: session.generation, requestId }, "*");
        };
        const abort = () => {
            takeBack();
            reject(request.cancel!.error());
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
        window.addEventListener("pagehide", takeBack, { once: true });
        signal?.addEventListener("abort", abort, { once: true });
        window.parent.postMessage({ type: request.type, generation: session.generation, requestId, ...request.fields }, "*");
    });
}
