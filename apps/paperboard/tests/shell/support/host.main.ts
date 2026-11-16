// The shell's host for the browser suite, run as its own process the way
// Electron main is: the same browser host, shell handlers, connection pool
// and panel server that `paperboard --browser` wires up in src/main/index.ts,
// over the test's throwaway PAPERBOARD_DIR. Only what is a network or an OS
// boundary is the harness's: the network mDNS discovery browses (mdns.ts,
// which finds nothing and can fail) and the system work main does after a
// settings save. A test can hold a probe of an address, to answer it after a
// newer one, and count the probes; make the next forget fail; hold or fail the saves of panel permissions, which it
// keeps in the store main keeps them in, and fail the next list of them; push what main pushes on its own
// (the update queue's states, a permission it couldn't decide),
// making the next Stop and update fail; and break discovery's socket. A
// Google Drive sign-in is main's own, its browser a tab the person closed.
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
import type { ShellCall, ShellPush } from "../../../src/shared/shellContract";
import { addShellPushSink, pushToShells } from "../../../src/main/communication/shellPush";
import connectionPool from "../../../src/main/communication/papercrane/ConnectionPool";
import discovery from "../../../src/main/communication/discovery";
import { failMdns } from "./mdns";
import { servePanelAsset } from "../../../src/main/panelServe";
import { getLocalDir } from "../../../papercrane/paths";
import { launchOptionsFromArgv } from "../../../src/shared/launchOptions";
import { PanelPermissionStore } from "../../../src/main/panelPermissions";
import type { PanelPermission, PermissionAnswer } from "../../../src/shared/panelPermissions";
import { initialAppUpdateState } from "../../../src/shared/appUpdate";
import { initialUpdateQueueState, type UpdateCheckOutcome, type UpdateQueueState } from "../../../src/shared/updateQueue";
import { cancelGoogleSignIn, signInToGoogleDrive } from "../../../src/main/googleOAuth";
import { ANSWER } from "./protocol";

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

let probes = 0;
// a probe of a held address waits until the test lets it answer
const held = new Map<string, { release: () => void; promise: Promise<void> }>();
let failRemove: string | null = null;
// the update queue is the test's: it pushes each state, as main's queue does
// while it runs, and can make the next Stop and update fail
let updateQueue: UpdateQueueState = { ...initialUpdateQueueState };
let failRelease: string | null = null;
const releases: string[][] = [];
const releaseWaiters: (() => void)[] = [];
// panel permissions are an Electron window's (the browser asks for itself):
// the shell shows them only when it runs in one
const permissions = new PanelPermissionStore(path.join(getLocalDir(), "panel-permissions.json"));
permissions.onChange(() => pushToShells("panel-permissions-changed", undefined));
const permissionSaves: { answer: PermissionAnswer; run: () => void }[] = [];
const permissionSaveWaiters: (() => void)[] = [];
let holdPermissionSaves = false;
let failPermissionSave: string | null = null;
let failPermissionList: string | null = null;
// a Google Drive sign-in runs as main runs it; the browser it opens is
// counted and never comes back, and nothing past it is reachable
let googleSignIns = 0;
const googleSignInWaiters: (() => void)[] = [];

// a look for updates waits here until a test says what it came to
const updateChecks: ((outcome: UpdateCheckOutcome) => void)[] = [];
const updateCheckWaiters: (() => void)[] = [];

// what an Electron window serves that this suite has no part in
const notHere = (channel: string) => () => {
    throw new Error(`Channel not available in browser mode: ${channel}`);
};

// the host is an Electron window's: every channel the contract declares
const calls: CallHandlers<ShellCall, unknown> = {
    ...shared,
    "computer-probe": async (args, caller) => {
        probes++;
        const answer = await shared["computer-probe"](args, caller);
        await held.get(args.host)?.promise;
        return answer;
    },
    "computer-remove": (args, caller) => {
        const refused = failRemove;
        failRemove = null;
        if (refused) throw new Error(refused);
        return shared["computer-remove"](args, caller);
    },
    // an Electron window also asks for its updates: there are none here
    "app-update-state": () => initialAppUpdateState,
    "update-queue": () => updateQueue,
    "update-release": ({ keys }) => {
        const refused = failRelease;
        failRelease = null;
        if (refused) throw new Error(refused);
        releases.push(keys);
        for (const wake of releaseWaiters.splice(0)) wake();
    },
    "panel-permissions-list": () => {
        const refused = failPermissionList;
        failPermissionList = null;
        if (refused) throw new Error(refused);
        return permissions.list();
    },
    "panel-permission-set": ({ panelId, permission, answer }) =>
        new Promise<void>((resolve, reject) => {
            const run = () => {
                const refused = failPermissionSave;
                failPermissionSave = null;
                if (refused) return reject(new Error(refused));
                permissions.set(panelId, permission, answer);
                resolve();
            };
            if (!holdPermissionSaves) return run();
            permissionSaves.push({ answer, run });
            for (const wake of permissionSaveWaiters.splice(0)) wake();
        }),
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
    "update-check": () =>
        new Promise<UpdateCheckOutcome>((resolve) => {
            updateChecks.push(resolve);
            for (const wake of updateCheckWaiters.splice(0)) wake();
        }),
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

type Command =
    | { cmd: "sign-in-url" }
    | { cmd: "probes" }
    | { cmd: "hold-probe"; host: string }
    | { cmd: "release-probe"; host: string }
    | { cmd: "rename"; id: string; name: string }
    | { cmd: "fail-remove"; message: string }
    | { cmd: "set-permission"; panelId: string; permission: PanelPermission; answer: PermissionAnswer }
    | { cmd: "permission"; panelId: string; permission: PanelPermission }
    | { cmd: "fail-permission-list"; message: string }
    | { cmd: "hold-permission-saves" }
    | { cmd: "held-permission-save" }
    | { cmd: "release-permission-save"; fail?: string }
    | { cmd: "push-update-queue"; state: UpdateQueueState }
    | { cmd: "fail-release"; message: string }
    | { cmd: "answer-update-check"; outcome: UpdateCheckOutcome }
    | { cmd: "next-release" }
    | { cmd: "google-sign-ins"; atLeast: number }
    | { cmd: "fail-mdns"; message: string }
    | { cmd: "push"; channel: ShellPush; payload: unknown };

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
        case "rename":
            // as another window of this app renaming it would: the change is pushed to every shell
            return connectionPool.renameComputer(command.id, command.name);
        case "fail-remove":
            failRemove = command.message;
            return true;
        case "set-permission":
            permissions.set(command.panelId, command.permission, command.answer);
            return true;
        case "permission":
            return permissions.list().find((e) => e.panelId === command.panelId && e.permission === command.permission)?.answer ?? null;
        case "fail-permission-list":
            failPermissionList = command.message;
            return true;
        case "hold-permission-saves":
            holdPermissionSaves = true;
            return true;
        case "held-permission-save":
            // resolves with the answer the oldest held save asks for, once one is held
            while (permissionSaves.length === 0) await new Promise<void>((wake) => permissionSaveWaiters.push(wake));
            return permissionSaves[0].answer;
        case "release-permission-save": {
            // the oldest held save answers: as it was asked, or refused
            const save = permissionSaves.shift();
            if (!save) throw new Error("No permission save is held");
            if (command.fail) failPermissionSave = command.fail;
            save.run();
            return true;
        }
        case "push-update-queue":
            updateQueue = command.state;
            pushToShells("update-queue", updateQueue);
            return true;
        case "fail-release":
            failRelease = command.message;
            return true;
        case "answer-update-check": {
            // the oldest look for updates comes to this, once one was asked for
            while (updateChecks.length === 0) await new Promise<void>((wake) => updateCheckWaiters.push(wake));
            updateChecks.shift()!(command.outcome);
            return true;
        }
        case "next-release":
            // resolves with the keys of the oldest Stop and update that ran, once one has
            while (releases.length === 0) await new Promise<void>((wake) => releaseWaiters.push(wake));
            return releases.shift();
        case "google-sign-ins":
            // resolves with how many Google sign-ins opened a browser, once at least that many have
            while (googleSignIns < command.atLeast) await new Promise<void>((wake) => googleSignInWaiters.push(wake));
            return googleSignIns;
        case "fail-mdns":
            failMdns(command.message);
            return true;
        case "push":
            // what main pushes to its windows on its own
            host.push(command.channel, command.payload);
            return true;
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
    discovery.stop();
    void host.close().then(() => process.exit(0));
});
reply(0, { result: host.origin });
