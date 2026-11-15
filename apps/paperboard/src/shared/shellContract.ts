// The shell window's boundary with main, declared once: each call's args
// and answer, each send's args and each push's payload. Main (Electron IPC,
// shelldata.ts), the preload, browser mode (browserHost.ts) and the renderer
// (lib/shell.ts) all read it, so no side names a channel or a field the
// others don't know.
//
// The shell and main ship together, so the shapes are strict: a call given a
// field its shape doesn't name is refused. Main reads every call's args
// (readShellArgs) before its handler runs; the renderer reads every answer
// and push (readShellAnswer, readShellPush) before it uses one.
//
// `browser` marks what browser mode serves too. Everything else needs a
// window: updates, native dialogs, permissions and quitting.
import { shape, type Infer, type Shape } from "@mileniumhq/paperapi";
import { isPanelId } from "@mileniumhq/paperapi/panelIdentity";
import { appUpdateState } from "./appUpdate";
import { graphics } from "./graphics";
import { launchOptions } from "./launchOptions";
import { panelFileTransferResult } from "./fileTransfer";
import { panelLoopbackRedirectResult } from "./loopbackRedirect";
import { panelPermission, panelPermissionEntry, permissionAnswer, permissionAsk, permissionFailure, screenPick, systemBlock } from "./panelPermissions";
import { updateQueueState } from "./updateQueue";

// ─── What crosses ───────────────────────────────────────────────────────────

const computerStatus = shape.object({
    connected: shape.boolean(),
    isRemote: shape.boolean(),
    host: shape.text(),
    port: shape.number(),
    error: shape.optional(shape.text()),
});

/** A paired computer as the shell shows it: never its token or pinned certificate. */
export const computerInfo = shape.object({
    id: shape.text(),
    name: shape.text(),
    host: shape.text(),
    port: shape.number(),
    /** the address other machines reach this computer at (local computer only) */
    networkAddress: shape.optional(shape.text()),
    os: shape.optional(shape.text()),
    osVersion: shape.optional(shape.text()),
    distroId: shape.optional(shape.text()),
    distroName: shape.optional(shape.text()),
    arch: shape.optional(shape.text()),
    isLocal: shape.optional(shape.boolean()),
    status: computerStatus,
});
export type ComputerInfo = Infer<typeof computerInfo>;

const computerList = shape.object({ computers: shape.list(computerInfo), activeId: shape.text() });
export type ComputerListResult = Infer<typeof computerList>;

const probeResult = shape.object({
    reachable: shape.boolean(),
    hostname: shape.optional(shape.text()),
    error: shape.optional(shape.text()),
    // what was typed is no address, so there is no port to name
    invalidAddress: shape.optional(shape.boolean()),
});
export type ComputerProbeResult = Infer<typeof probeResult>;

/** A Paperboard server found nearby over mDNS. */
const discoveredComputer = shape.object({
    /** stable service identity: the dedupe key */
    id: shape.text(),
    name: shape.text(),
    host: shape.text(),
    port: shape.number(),
    version: shape.optional(shape.text()),
    os: shape.optional(shape.text()),
});
export type DiscoveredComputer = Infer<typeof discoveredComputer>;

/** text that isn't empty (nor only spaces, with `words`), at most `max` long */
const filled = (max = 4096, { words = false } = {}): Shape<string> => ({
    check: (value, at) => {
        if (typeof value !== "string") return `the field "${at}": expected text, got ${typeof value}`;
        if (!(words ? value.trim() : value)) return `the field "${at}" is missing`;
        return value.length > max ? `the field "${at}" is longer than ${max} characters` : null;
    },
});
const words = (max: number) => filled(max, { words: true });
const panelId = (): Shape<string> => ({ check: (value, at) => (isPanelId(value) ? null : `the field "${at}" is no panel id: ${JSON.stringify(value)}`) });

const none = shape.nothing();
// a port as typed: the connection pool checks its range
const port = shape.optional(shape.either(shape.number(), shape.text()));
const askId = filled(128);

// what a held update is called: the queue's keys, at most 64 at once
const updateKeys: Shape<string[]> = {
    check: (value, at, strict) => {
        const why = shape.list(filled(512)).check(value, at, strict);
        if (why) return why;
        const count = (value as string[]).length;
        return count === 0 || count > 64 ? `the field "${at}" must list from 1 to 64 held updates` : null;
    },
};

// a panel's save or open dialog: the shell names the computer and the
// frame's panel; the rest is the panel's own, which the transfer's parser
// (fileTransfer.ts) checks and answers with an invalid-request
const panelFileTransfer = shape.object({
    computerId: shape.text(),
    panelId: shape.text(),
    path: shape.optional(shape.json()),
    suggestedName: shape.optional(shape.json()),
    filters: shape.optional(shape.json()),
    selection: shape.optional(shape.json()),
});

// ─── Channels ───────────────────────────────────────────────────────────────

interface CallDefinition {
    readonly args: Shape<any>;
    readonly answer: Shape<any>;
    readonly browser?: true;
}

export const SHELL_CALLS = {
    // throws until the local daemon is verified: why it isn't, once known
    "crane-credentials": { args: none, answer: shape.object({ port: shape.number(), token: shape.text(), computerId: shape.text() }), browser: true },
    "computers-list": { args: none, answer: computerList, browser: true },
    "computer-probe": { args: shape.object({ host: filled(), port }), answer: probeResult, browser: true },
    "computer-pair": {
        args: shape.object({ host: filled(), port, code: filled(), name: shape.optional(shape.text()) }),
        // the computer it paired, which the shell goes to: an answer
        // without one is said by the wizard
        answer: shape.object({ id: shape.optional(shape.text()) }),
        browser: true,
    },
    "computer-update": { args: shape.object({ id: filled(), name: shape.text() }), answer: shape.boolean(), browser: true },
    // null once forgotten; otherwise why the computer couldn't be told, and
    // nothing was forgotten unless evenIfUntold
    "computer-remove": { args: shape.object({ id: filled(), evenIfUntold: shape.optional(shape.boolean()) }), answer: shape.nullable(shape.text()), browser: true },
    "computer-switch": { args: shape.object({ id: filled() }), answer: shape.boolean(), browser: true },
    // every computer's id, in the rail's new order
    "computer-reorder": { args: shape.object({ ids: shape.list(shape.text()) }), answer: none, browser: true },
    "discovery-list": { args: none, answer: shape.list(discoveredComputer), browser: true },
    // the local data folder, or a panel's files folder; an unopened folder answers why
    "open-panel-folder": {
        args: shape.object({ computerId: filled(), panelId: shape.optional(shape.text()) }),
        answer: shape.object({ opened: shape.boolean(), error: shape.optional(shape.text()) }),
        browser: true,
    },
    // one file of an installed panel's manifest or store listing, in base64
    "panel-listing-file": { args: shape.object({ computerId: filled(), panelId: panelId(), path: filled() }), answer: shape.text(), browser: true },
    "app-version": { args: none, answer: shape.text(), browser: true },
    // command-line switches the shell honors, e.g. --mobile
    "launch-options": { args: none, answer: launchOptions, browser: true },
    // whether Paperboard is drawn on a GPU
    graphics: { args: none, answer: graphics, browser: true },
    // settings saved over the daemon still need main's side effects: why
    // Run on startup couldn't be applied, or null
    "app-settings-changed": { args: none, answer: shape.nullable(shape.text()), browser: true },

    "app-update-state": { args: none, answer: appUpdateState },
    "update-queue": { args: none, answer: updateQueueState },
    // Stop and update: resolves when the held updates ran
    "update-release": { args: shape.object({ keys: updateKeys }), answer: none },
    // look for updates to everything, now
    "update-check": { args: none, answer: none },
    "open-update-download": { args: none, answer: none },
    // false when a page with unsaved work kept Paperboard open
    "quit-and-install": { args: none, answer: shape.boolean() },
    "panel-file-export": { args: panelFileTransfer, answer: panelFileTransferResult },
    "panel-file-import": { args: panelFileTransfer, answer: panelFileTransferResult },
    // a panel's sign-in redirect to localhost, caught on this device under
    // the shell's own id for the request; the address is checked by the
    // listener, which answers why it can't listen there
    "panel-loopback-redirect": { args: shape.object({ requestId: filled(128), redirectUri: shape.json() }), answer: panelLoopbackRedirectResult },
    "panel-loopback-redirect-cancel": { args: shape.object({ requestId: filled(128) }), answer: none },
    // a new Google Drive location with its label, or an existing one signed
    // in again: the location the computer keeps
    "backup-gdrive-connect": {
        args: shape.either(
            shape.object({ computerId: words(128), label: words(60) }),
            shape.object({ computerId: words(128), locationId: words(64) }),
        ),
        answer: shape.json(),
    },
    "backup-gdrive-cancel": { args: none, answer: none },
    // a PermissionAnswer for an ask, a source id (or null) for a screen pick
    "panel-permission-answer": { args: shape.object({ askId, answer: shape.nullable(shape.text()) }), answer: none },
    "panel-permissions-list": { args: none, answer: shape.list(panelPermissionEntry) },
    "panel-permission-set": { args: shape.object({ panelId: panelId(), permission: panelPermission, answer: permissionAnswer }), answer: none },
    "open-system-privacy": { args: shape.object({ permission: panelPermission }), answer: none },
    // whether this window's panels hold unsaved work, which a quit asks about
    "panels-unsaved": { args: shape.object({ unsaved: shape.boolean() }), answer: none },
    "quit-answer": { args: shape.object({ askId, answer: shape.boolean() }), answer: none },
} as const satisfies Record<string, CallDefinition>;

export const SHELL_SENDS = {
    // a full quit, the same as the tray's Quit
    "quit-app": { args: none },
    // the renderer's errors, in main's log
    "renderer-log": { args: shape.object({ level: shape.oneOf("error", "warn", "info"), message: shape.text() }), browser: true },
} as const satisfies Record<string, { args: Shape<any>; browser?: true }>;

export const SHELL_PUSHES = {
    "app-update-state": appUpdateState,
    "update-queue": updateQueueState,
    "computers-changed": computerList,
    "discovery-changed": shape.list(discoveredComputer),
    "graphics-changed": graphics,
    "panel-permission-ask": permissionAsk,
    "panel-screen-pick": screenPick,
    "panel-permission-system": systemBlock,
    "panel-permission-failed": permissionFailure,
    "panel-permissions-changed": none,
    "quit-ask": shape.object({ askId: shape.text() }),
} as const satisfies Record<string, Shape<any>>;

export type ShellCall = keyof typeof SHELL_CALLS;
export type ShellSend = keyof typeof SHELL_SENDS;
export type ShellPush = keyof typeof SHELL_PUSHES;
/** what browser mode serves */
export type BrowserShellCall = { [K in ShellCall]: (typeof SHELL_CALLS)[K] extends { browser: true } ? K : never }[ShellCall];
export type BrowserShellSend = { [K in ShellSend]: (typeof SHELL_SENDS)[K] extends { browser: true } ? K : never }[ShellSend];

export type CallArgs<K extends ShellCall> = Infer<(typeof SHELL_CALLS)[K]["args"]>;
export type CallAnswer<K extends ShellCall> = Infer<(typeof SHELL_CALLS)[K]["answer"]>;
export type SendArgs<K extends ShellSend> = Infer<(typeof SHELL_SENDS)[K]["args"]>;
export type PushPayload<K extends ShellPush> = Infer<(typeof SHELL_PUSHES)[K]>;
/** a call's args as a caller passes them: none, or the one value */
export type Given<T> = [T] extends [void] ? [] : [T];

export const isShellCall = (channel: unknown): channel is ShellCall => typeof channel === "string" && Object.hasOwn(SHELL_CALLS, channel);
export const isShellSend = (channel: unknown): channel is ShellSend => typeof channel === "string" && Object.hasOwn(SHELL_SENDS, channel);
export const isShellPush = (channel: unknown): channel is ShellPush => typeof channel === "string" && Object.hasOwn(SHELL_PUSHES, channel);

/** the calls and sends a host serves: every one in a window, the browser's in browser mode */
export function shellChannels(host: "window" | "browser"): { calls: ShellCall[]; sends: ShellSend[] } {
    const served = (definition: object) => host === "window" || "browser" in definition;
    return {
        calls: (Object.keys(SHELL_CALLS) as ShellCall[]).filter((channel) => served(SHELL_CALLS[channel])),
        sends: (Object.keys(SHELL_SENDS) as ShellSend[]).filter((channel) => served(SHELL_SENDS[channel])),
    };
}

// ─── Reading what crosses ───────────────────────────────────────────────────

// the contract's readers name what they read; the value is the type its shape says, once checked
function check(s: Shape<unknown>, value: unknown, strict: boolean, what: string): void {
    const why = s.check(value, "", strict);
    if (why) throw new Error(`${what} was refused: ${why}`);
}

/** A call's args as its handler is given them, or a refusal naming the channel and the field. */
export function readShellArgs<K extends ShellCall>(channel: K, args: unknown): CallArgs<K> {
    check(SHELL_CALLS[channel].args, args, true, `The shell's ${channel} call`);
    return args as CallArgs<K>;
}

export function readSendArgs<K extends ShellSend>(channel: K, args: unknown): SendArgs<K> {
    check(SHELL_SENDS[channel].args, args, true, `The shell's ${channel} message`);
    return args as SendArgs<K>;
}

/** What main answered a call; what it may carry past its shape passes on. */
export function readShellAnswer<K extends ShellCall>(channel: K, answer: unknown): CallAnswer<K> {
    check(SHELL_CALLS[channel].answer, answer, false, `Main's answer to ${channel}`);
    return answer as CallAnswer<K>;
}

export function readShellPush<K extends ShellPush>(channel: K, payload: unknown): PushPayload<K> {
    check(SHELL_PUSHES[channel], payload, false, `Main's ${channel} push`);
    return payload as PushPayload<K>;
}

/** The bridge the preload exposes, and browser mode stands in for: channels and values as they travel. */
export interface ShellWire {
    invoke(channel: string, args?: unknown): Promise<unknown>;
    send(channel: string, args?: unknown): void;
    /** the payload of each push on `channel`; returns what stops listening */
    on(channel: string, listener: (payload: unknown) => void): () => void;
}
