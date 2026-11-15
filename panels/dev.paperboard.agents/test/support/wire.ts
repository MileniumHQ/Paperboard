// The page's side of its socket to the daemon, for a test that decides when
// the real service hears a call or when the page hears its answer: a script
// run in the page before its own code (BootedPanel.open({ init: WIRE })) that
// watches the service calls the page sends (by the contract's name) and can
// hold one on its way out, or its answer on its way back, until the test
// lets it go. Everything still goes to and comes from the real service; only
// the timing is the test's. A call held on its way out can be let go with
// its input changed, so the real service is the one that refuses it.
//
// A wait on what the socket holds is a wait on the page: every change here
// marks the document (data-wire), which Page.waitFor wakes on.
//
// One call can instead be answered at the socket (answerHeld): for an answer
// the real service could only get from the internet, which a test never
// reaches.
import type { Page } from "../../../../scripts/testing/chrome";

export const WIRE = `(() => {
    const send = WebSocket.prototype.send;
    const listen = WebSocket.prototype.addEventListener;
    const callOf = (data) => {
        if (typeof data !== "string") return null;
        // every frame the transport sends is JSON
        const message = JSON.parse(data);
        const entry = message.action === "blocks:call" ? /^command\\.call-(.+)$/.exec(message.params?.entry ?? "") : null;
        return entry ? { id: message.id, name: entry[1], input: message.params.request?.inputs?.input, message } : null;
    };
    const wire = (window.__wire = {
        sent: [],
        holdingCalls: new Set(),
        heldCalls: [],
        holdingAnswers: new Set(),
        awaited: new Map(),
        heldAnswers: [],
        sockets: new Set(),
    });
    // every change here is a change to the document too, so a wait on the page (Page.waitFor) wakes on it
    let changes = 0;
    const changed = () => (document.documentElement.dataset.wire = String(++changes));
    WebSocket.prototype.send = function (data) {
        const call = callOf(data);
        if (!call) return send.call(this, data);
        wire.sent.push({ name: call.name, input: call.input });
        changed();
        if (wire.holdingAnswers.has(call.name)) wire.awaited.set(call.id, call.name);
        if (wire.holdingCalls.has(call.name)) return void wire.heldCalls.push({ socket: this, call });
        return send.call(this, data);
    };
    WebSocket.prototype.addEventListener = function (type, listener, options) {
        if (type !== "message") return listen.call(this, type, listener, options);
        wire.sockets.add({ socket: this, listener });
        return listen.call(this, type, (event) => {
            // every frame the daemon sends is JSON
            const frame = typeof event.data === "string" ? JSON.parse(event.data) : null;
            const name = frame?.type === "response" ? wire.awaited.get(frame.id) : undefined;
            if (name === undefined) return listener(event);
            wire.awaited.delete(frame.id);
            wire.heldAnswers.push({ name, deliver: () => listener(event) });
            changed();
        }, options);
    };
    const take = (list, name, newest) => {
        const matches = (h) => h.name === name || h.call?.name === name;
        const i = newest ? list.findLastIndex(matches) : list.findIndex(matches);
        if (i < 0) throw new Error("nothing named " + name + " is held");
        return list.splice(i, 1)[0];
    };
    window.__wireApi = {
        sent: (name) => wire.sent.filter((c) => c.name === name).map((c) => c.input ?? null),
        holdCalls: (name, on) => void (on ? wire.holdingCalls.add(name) : wire.holdingCalls.delete(name)),
        heldCalls: (name) => wire.heldCalls.filter((h) => h.call.name === name).length,
        releaseCall: (name, change) => {
            const { socket, call } = take(wire.heldCalls, name);
            const message = change ? { ...call.message, params: { ...call.message.params, request: { inputs: { input: { ...call.input, ...change } } } } } : call.message;
            send.call(socket, JSON.stringify(message));
        },
        answerHeld: (name, result) => {
            const { socket, call } = take(wire.heldCalls, name);
            const data = JSON.stringify({ type: "response", id: call.id, result: { result } });
            for (const s of wire.sockets) if (s.socket === socket) s.listener(new MessageEvent("message", { data }));
        },
        holdAnswers: (name, on) => void (on ? wire.holdingAnswers.add(name) : wire.holdingAnswers.delete(name)),
        heldAnswers: (name) => wire.heldAnswers.filter((h) => h.name === name).length,
        deliverAnswer: (name, which) => take(wire.heldAnswers, name, which === "newest").deliver(),
    };
})()`;

const api = (page: Page, call: string) => page.evaluate(`window.__wireApi.${call}`);
const name = (n: string) => JSON.stringify(n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());

/** The page's calls to the service, by the contract's name: what each one was given, held or not. */
export const sent = (page: Page, call: string) => page.evaluate<unknown[]>(`window.__wireApi.sent(${name(call)})`);
/** From now on (or no longer), the page's `call`s wait on their way to the service. */
export const holdCalls = (page: Page, call: string, on = true) => api(page, `holdCalls(${name(call)}, ${on})`);
/** How many `call`s wait on their way out. */
export const heldCalls = (page: Page, call: string) => page.evaluate<number>(`window.__wireApi.heldCalls(${name(call)})`);
/** Sends the oldest held `call` on to the service, with `change` merged into its input. */
export const releaseCall = (page: Page, call: string, change?: Record<string, unknown>) => api(page, `releaseCall(${name(call)}, ${JSON.stringify(change ?? null)})`);
/** Answers the oldest held `call` at the socket, as the service would have: only for an answer that comes from the internet. */
export const answerHeld = (page: Page, call: string, result: unknown) => api(page, `answerHeld(${name(call)}, ${JSON.stringify(result)})`);
/** From now on (or no longer), the service's answers to `call` wait on their way to the page. */
export const holdAnswers = (page: Page, call: string, on = true) => api(page, `holdAnswers(${name(call)}, ${on})`);
/** How many answers to `call` wait on their way in. */
export const heldAnswers = (page: Page, call: string) => page.evaluate<number>(`window.__wireApi.heldAnswers(${name(call)})`);
/** Hands the page the oldest (or newest) held answer to `call`. */
export const deliverAnswer = (page: Page, call: string, which: "oldest" | "newest" = "oldest") => api(page, `deliverAnswer(${name(call)}, ${JSON.stringify(which)})`);
