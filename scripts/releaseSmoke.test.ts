import { afterEach, expect, test } from "bun:test";
import { evaluate } from "./releaseSmoke";

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
    server?.stop(true);
    server = null;
});

// The app recreates its window while it starts, which closes the DevTools
// target mid-call. The smoke's poll must hear about it and look again, not
// wait forever on an answer that never comes.
test("an evaluation whose DevTools target closes before answering settles with why", async () => {
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, srv) {
            if (srv.upgrade(req, { data: undefined })) return undefined;
            return new Response("not a websocket", { status: 400 });
        },
        websocket: {
            // the evaluation arrives; the target goes away without a reply
            message(ws) {
                ws.close();
            },
        },
    });
    const reply = await evaluate(`ws://127.0.0.1:${server.port}/devtools/page/1`, "1 + 1");
    expect(reply).toEqual({ error: "the shell's DevTools target closed before it answered" });
});
