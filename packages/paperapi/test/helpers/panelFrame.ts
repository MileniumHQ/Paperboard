// A panel's page in its frame, without a browser: the window a shell's
// iframe gives it (a parent, message events) and the credentials the host
// injects, so readiness.ts answers the shell's challenge over a real
// connection to the daemon. Each stdin line is a message from the shell;
// each message the page posts to the shell is printed as one JSON line.
import { createInterface } from "node:readline";

const shell = {
    postMessage: (data: unknown) => {
        process.stdout.write(`${JSON.stringify(data)}\n`);
    },
};
const frame = Object.assign(new EventTarget(), { parent: shell });
Object.assign(globalThis, {
    window: frame,
    __PAPERBOARD_CRANE: {
        port: Number(process.env.FRAME_PORT),
        token: process.env.FRAME_TOKEN,
        computerId: "local",
        panelId: process.env.FRAME_PANEL_ID,
    },
});

await import("../../src/readiness");

for await (const line of createInterface({ input: process.stdin })) {
    const message = new Event("message");
    Object.defineProperties(message, { data: { value: JSON.parse(line) }, source: { value: shell } });
    frame.dispatchEvent(message);
}
