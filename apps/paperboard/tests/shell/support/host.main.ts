// The shell's host for the browser suite, run as its own process the way
// Electron main is: the same browser host, shell handlers, connection pool
// and panel server that `paperboard --browser` wires up in src/main/index.ts,
// over the test's throwaway PAPERBOARD_DIR. Only what is a network or an OS
// boundary is the harness's: mDNS discovery (it finds nothing here) and the
// system work main does after a settings save. A test can hold a probe of an
// address, to answer it after a newer one, and count the probes.
//
// The test drives it over stdin, one JSON command per line, and reads each
// answer as one stdout line starting with ANSWER (the daemon client logs to
// stdout too).
import * as path from "node:path";
import { createInterface } from "node:readline";
import { startBrowserHost } from "../../../src/main/browserHost";
import { BrowserSessions } from "../../../src/main/browserSessions";
import { createShellInvokeHandlers, SHARED_SHELL_INVOKE_CHANNELS } from "../../../src/main/communication/shellHandlers";
import { addShellPushSink, pushToShells } from "../../../src/main/communication/shellPush";
import connectionPool from "../../../src/main/communication/papercrane/ConnectionPool";
import { servePanelAsset } from "../../../src/main/panelServe";
import { getLocalDir } from "../../../papercrane/paths";
import { launchOptionsFromArgv } from "../../../src/shared/launchOptions";
import { ANSWER } from "./protocol";

const rendererDir = process.argv[2];
if (!rendererDir) throw new Error("usage: host.main.ts <built renderer dir>");

await connectionPool.init();

const shared = createShellInvokeHandlers({
    appVersion: () => "0.0.0-test",
    launchOptions: () => launchOptionsFromArgv([]),
    graphics: () => ({ gpu: true }),
    openPath: async () => "Opening folders is not part of the browser suite",
});

let probes = 0;
// a probe of a held address waits until the test lets it answer
const held = new Map<string, { release: () => void; promise: Promise<void> }>();

const invoke: Record<string, (args: unknown) => unknown> = {};
for (const channel of SHARED_SHELL_INVOKE_CHANNELS) invoke[channel] = shared[channel];
invoke["computer-probe"] = async (args) => {
    probes++;
    const answer = await shared["computer-probe"](args);
    await held.get((args as { host: string }).host)?.promise;
    return answer;
};
invoke["discovery-list"] = () => [];
// main applies the saved theme and login item to the OS; nothing to apply here
invoke["app-settings-changed"] = () => null;

const host = await startBrowserHost({
    port: 0,
    sessions: new BrowserSessions(path.join(getLocalDir(), "browser-sessions.json")),
    rendererDir,
    invoke,
    send: { "renderer-log": () => undefined },
    servePanel: servePanelAsset,
});
addShellPushSink((channel, payload) => host.push(channel, payload));
// what communication.ts mirrors for the Electron windows
connectionPool.on("change", () =>
    pushToShells("computers-changed", { computers: connectionPool.listComputers(), activeId: connectionPool.getActiveId() }),
);

type Command =
    | { cmd: "sign-in-url" }
    | { cmd: "probes" }
    | { cmd: "hold-probe"; host: string }
    | { cmd: "release-probe"; host: string }
    | { cmd: "pair"; host: string; port: number; code: string; name: string }
    | { cmd: "rename"; id: string; name: string };

async function run(command: Command): Promise<unknown> {
    switch (command.cmd) {
        case "sign-in-url":
            return host.signInUrl();
        case "probes":
            return probes;
        case "hold-probe": {
            let release!: () => void;
            const promise = new Promise<void>((resolve) => (release = resolve));
            held.set(command.host, { release, promise });
            return true;
        }
        case "release-probe": {
            const hold = held.get(command.host);
            if (!hold) throw new Error(`No probe of ${command.host} is held`);
            hold.release();
            held.delete(command.host);
            return true;
        }
        case "pair":
            return (await connectionPool.pairComputer(command.host, command.port, command.code, command.name)).id;
        case "rename":
            // as another window of this app renaming it would: the change is pushed to every shell
            return connectionPool.updateComputer(command.id, { name: command.name });
    }
}

const reply = (seq: number, body: { result?: unknown; error?: string }) => process.stdout.write(`${ANSWER}${JSON.stringify({ seq, ...body })}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
    const { seq, command } = JSON.parse(line) as { seq: number; command: Command };
    run(command).then(
        (result) => reply(seq, { result }),
        (err) => reply(seq, { error: err instanceof Error ? err.message : String(err) }),
    );
});
process.stdin.on("end", () => {
    connectionPool.dispose();
    void host.close().then(() => process.exit(0));
});
reply(0, { result: host.origin });
