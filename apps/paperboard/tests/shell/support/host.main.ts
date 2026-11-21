// The shell's host for the browser suite, run as its own process the way
// Electron main is: the same browser host, shell handlers, connection pool
// and panel server that `paperboard --browser` wires up in src/main/index.ts,
// over the test's throwaway PAPERBOARD_DIR. Only what is a network or an OS
// boundary is the harness's: the network mDNS discovery browses (mdns.ts,
// which finds nothing) and the system work main does after a settings save. A
// test can push the update queue's states, as main's queue does while it
// runs, and the app's own update state. A Google Drive sign-in is main's own,
// its browser a tab the person closed.
//
// The test drives it over stdin, one JSON command per line, and reads each
// answer as one stdout line starting with ANSWER (the daemon client logs to
// stdout too).
import * as path from "node:path";
import { createInterface } from "node:readline";
import { startBrowserHost } from "../../../src/main/browserHost";
import { BrowserSessions } from "../../../src/main/browserSessions";
import { createShellInvokeHandlers } from "../../../src/main/communication/shellHandlers";
import { shellServer, type CallHandlers } from "../../../src/main/communication/shellServer";
import type { ShellCall } from "../../../src/shared/shellContract";
import { addShellPushSink, pushToShells } from "../../../src/main/communication/shellPush";
import connectionPool from "../../../src/main/communication/papercrane/ConnectionPool";
import discovery from "../../../src/main/communication/discovery";
import { servePanelAsset } from "../../../src/main/panelServe";
import { getLocalDir } from "daemon/core/paths";
import { launchOptionsFromArgv } from "../../../src/shared/launchOptions";
import { initialAppUpdateState, type AppUpdateState } from "../../../src/shared/appUpdate";
import { initialUpdateQueueState, type UpdateQueueState } from "../../../src/shared/updateQueue";
import { cancelGoogleSignIn, signInToGoogleDrive } from "../../../src/main/googleOAuth";
import { ANSWER, type Command, type HostCommands } from "./protocol";

const rendererDir = process.argv[2];
if (!rendererDir) throw new Error("usage: host.main.ts <built renderer dir>");

await connectionPool.init();

const shared = createShellInvokeHandlers({
    appVersion: () => "0.0.0-test",
    // as main reads them: a phone boot starts this host with --mobile
    launchOptions: () => launchOptionsFromArgv(process.argv),
    graphics: () => ({ gpu: true }),
    openPath: async () => "Opening folders is not part of the browser suite",
    // main applies the saved theme and login item to the OS; nothing to apply here
    appSettingsChanged: async () => null,
});

// the update queue is the test's: it pushes each state, as main's queue does
// while it runs
let updateQueue: UpdateQueueState = { ...initialUpdateQueueState };
let appUpdate: AppUpdateState = { ...initialAppUpdateState };
// a Google Drive sign-in runs as main runs it; the browser it opens is
// counted and never comes back, and nothing past it is reachable
let googleSignIns = 0;
const googleSignInWaiters: (() => void)[] = [];

// what an Electron window serves that this suite has no part in
const notHere = (channel: string) => () => {
    throw new Error(`Channel not available in browser mode: ${channel}`);
};

// the host is an Electron window's: every channel the contract declares
const calls: CallHandlers<ShellCall, unknown> = {
    ...shared,
    // an Electron window also asks for its updates: there are none here
    "app-update-state": () => appUpdate,
    "update-queue": () => updateQueue,
    "backup-gdrive-connect": () =>
        signInToGoogleDrive(
            { clientId: "browser-suite", clientSecret: "browser-suite" },
            {
                endpoints: { authUrl: "http://127.0.0.1:9/auth", tokenUrl: "http://127.0.0.1:9/token" },
                page: () => "",
                openExternal: async () => {
                    googleSignIns++;
                    for (const wake of googleSignInWaiters.splice(0)) wake();
                },
            },
            async () => {
                throw new Error("The browser suite keeps no Google sign-in");
            },
        ),
    "backup-gdrive-cancel": () => cancelGoogleSignIn(),
    "update-release": notHere("update-release"),
    "update-check": notHere("update-check"),
    "panel-permissions-list": notHere("panel-permissions-list"),
    "panel-permission-set": notHere("panel-permission-set"),
    "open-update-download": notHere("open-update-download"),
    "quit-and-install": notHere("quit-and-install"),
    "panel-file-export": notHere("panel-file-export"),
    "panel-file-import": notHere("panel-file-import"),
    "panel-loopback-redirect": notHere("panel-loopback-redirect"),
    "panel-loopback-redirect-cancel": notHere("panel-loopback-redirect-cancel"),
    "panel-permission-answer": notHere("panel-permission-answer"),
    "open-system-privacy": notHere("open-system-privacy"),
    // a window says whether its panels hold unsaved work; no quit asks here
    "panels-unsaved": () => undefined,
    "quit-answer": notHere("quit-answer"),
    // a report runs a coding agent on this computer, which the suite has none of
    "issue-report-setup": notHere("issue-report-setup"),
    "issue-report-start": notHere("issue-report-start"),
    "issue-report-steer": notHere("issue-report-steer"),
    "issue-report-stop": notHere("issue-report-stop"),
    "issue-report-file": notHere("issue-report-file"),
    "issue-report-open-link": notHere("issue-report-open-link"),
};

const host = await startBrowserHost({
    port: 0,
    sessions: new BrowserSessions(path.join(getLocalDir(), "browser-sessions.json")),
    rendererDir,
    shell: shellServer("window", calls, { "quit-app": notHere("quit-app"), "renderer-log": () => undefined }),
    servePanel: servePanelAsset,
});
addShellPushSink((channel, payload) => host.push(channel, payload));
// what communication.ts starts and mirrors for the Electron windows
discovery.start();
discovery.on("update", (services) => pushToShells("discovery-changed", services));
connectionPool.on("change", () =>
    pushToShells("computers-changed", { computers: connectionPool.listComputers(), activeId: connectionPool.getActiveId() }),
);

// each command's handler, held to the answer protocol.ts declares for it
const handlers: { [K in keyof HostCommands]: (command: HostCommands[K]["command"]) => Promise<HostCommands[K]["result"]> } = {
    "sign-in-url": async () => host.signInUrl(),
    "push-update-queue": async (command) => {
        updateQueue = command.state;
        pushToShells("update-queue", updateQueue);
        return true;
    },
    "push-app-update": async (command) => {
        appUpdate = command.state;
        pushToShells("app-update-state", appUpdate);
        return true;
    },
    // resolves with how many Google sign-ins opened a browser, once at least that many have
    "google-sign-ins": async (command) => {
        while (googleSignIns < command.atLeast) await new Promise<void>((wake) => googleSignInWaiters.push(wake));
        return googleSignIns;
    },
};

async function run(command: Command): Promise<unknown> {
    // a command from a test built against another host (or past the types) has no handler
    if (!Object.hasOwn(handlers, command.cmd)) throw new Error(`unknown command ${command.cmd}`);
    return (handlers[command.cmd] as (command: Command) => Promise<unknown>)(command);
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
    discovery.stop();
    void host.close().then(() => process.exit(0));
});
reply(0, { result: host.origin });
