// The shell window's boundary with main, declared once: each call's args
// and answer, each send's args and each push's payload. Main (Electron IPC,
// shelldata.ts), the preload, browser mode (browserHost.ts) and the renderer
// (lib/shell.ts) all read it, so no side names a channel or a field the
// others don't know.
//
// `browser` marks what browser mode serves too. Everything else needs a
// window: updates, native dialogs, permissions and quitting.
import type { IdentityPart } from "@mileniumhq/paperapi";
import type { AppUpdateState } from "./appUpdate";
import type { Graphics } from "./graphics";
import type { LaunchOptions } from "./launchOptions";
import type { PanelFileTransferResult } from "./fileTransfer";
import type { PanelLoopbackRedirectResult } from "./loopbackRedirect";
import type { PanelPermission, PanelPermissionEntry, PermissionAnswer, PermissionAsk, PermissionFailure, ScreenPick, SystemBlock } from "./panelPermissions";
import type { UpdateCheckOutcome, UpdateQueueState } from "./updateQueue";

// ─── What crosses ───────────────────────────────────────────────────────────

export interface ComputerStatus {
    connected: boolean;
    isRemote: boolean;
    host: string;
    port: number;
    error?: string;
}

/** A paired computer as the shell shows it: never its token or pinned certificate. */
export interface ComputerInfo {
    id: string;
    name: string;
    /** the address it is dialed at first: its .local name when it answers to one */
    host: string;
    /** the IP it last answered at, dialed alongside a .local host */
    address?: string;
    port: number;
    /** the address other machines reach this computer at (local computer only) */
    networkAddress?: string;
    /** what the host reaches this computer through (such as a relay),
     * when it isn't a host:port people would recognize */
    via?: string;
    os?: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    flavor?: IdentityPart;
    machine?: IdentityPart;
    board?: string;
    operator?: IdentityPart;
    arch?: string;
    isLocal?: boolean;
    status: ComputerStatus;
}

export interface ComputerListResult {
    computers: ComputerInfo[];
    activeId: string;
}

export interface ComputerProbeResult {
    reachable: boolean;
    /** the name the computer is listed under here, when the certificate it answered with is one this app lists */
    listedAs?: string;
    error?: string;
    // what was typed is no address, so there is no port to name
    invalidAddress?: boolean;
}

/** whether a paired computer answers, at any address it is known by, under its pinned certificate */
export interface ComputerReachResult {
    reachable: boolean;
    error?: string;
}

export type SetupStepId = "connect" | "signIn" | "check" | "install" | "pair";

/** one step of setting a computer up over SSH, as its loader shows it */
export interface SetupStep {
    id: SetupStepId;
    status: "waiting" | "loading" | "success" | "error";
    label: string;
    // how far a step that can tell is (a download); one without is under way, no more
    percent?: number;
}

/** a setup over SSH, pushed whole on every change */
export interface ComputerSetupState {
    jobId: string;
    // counts up with every change: pushes and the start answer travel apart, and the higher one is newer
    revision: number;
    host: string;
    steps: SetupStep[];
    // keys and the agent didn't sign in: the account and password are asked
    signIn: { username: string; error?: string } | null;
    // paired (the computer's id, the name it is listed under, and what to know
    // about it now: "stops when you sign out"), the pairing code is the way
    // left (why), or what stopped it
    result: { paired: { id: string; name: string; notice?: string } } | { useCode: string } | { failed: string } | null;
}

/** A Paperboard server found nearby over mDNS. */
export interface DiscoveredComputer {
    /** stable service identity: the dedupe key */
    id: string;
    name: string;
    /** the address it answered from */
    host: string;
    /** the .local name it answers to (an older daemon advertises none) */
    mdnsName?: string;
    port: number;
    version?: string;
    os?: string;
    /** its TLS certificate's SHA-256 fingerprint: who it is, whatever its address */
    fingerprint?: string;
}

/** A backup location as people see it: where it is, never its keys or sign-in. */
export interface ShellBackupLocation {
    id: string;
    kind: "local" | "s3" | "gdrive";
    label: string;
    detail: string;
    removable: boolean;
}

// a panel's save or open dialog: the shell names the computer and the
// frame's panel; the rest is the panel's own, which the transfer's parser
// (fileTransfer.ts) checks and answers with an invalid-request
export interface PanelFileTransferArgs {
    computerId: string;
    panelId: string;
    path?: unknown;
    suggestedName?: unknown;
    filters?: unknown;
    selection?: unknown;
}

// ─── Channels ───────────────────────────────────────────────────────────────

export const SHELL_CALLS = {
    "crane-credentials": { browser: true },
    "computers-list": { browser: true },
    "computer-probe": { browser: true },
    "computer-reach": { browser: true },
    "computer-pair": { browser: true },
    "computer-update": { browser: true },
    "computer-remove": { browser: true },
    "computer-switch": { browser: true },
    "computer-reorder": { browser: true },
    "discovery-list": { browser: true },
    "computer-ssh-check": { browser: true },
    "computer-setup-start": { browser: true },
    "computer-setup-sign-in": { browser: true },
    "computer-setup-cancel": { browser: true },
    "open-panel-folder": { browser: true },
    "panel-listing-file": { browser: true },
    "app-version": { browser: true },
    "launch-options": { browser: true },
    graphics: { browser: true },
    "app-settings-changed": { browser: true },
    "issue-details": { browser: true },
    "issue-send": { browser: true },

    "app-update-state": {},
    "update-queue": {},
    "update-release": {},
    "update-check": {},
    "open-update-download": {},
    "quit-and-install": {},
    "panel-file-export": {},
    "panel-file-import": {},
    "panel-loopback-redirect": {},
    "panel-loopback-redirect-cancel": {},
    "backup-gdrive-connect": {},
    "backup-gdrive-cancel": {},
    "panel-permission-answer": {},
    "panel-permissions-list": {},
    "panel-permission-set": {},
    "open-system-privacy": {},
    "panels-unsaved": {},
    "quit-answer": {},
} as const satisfies Record<string, { readonly browser?: true }>;

export const SHELL_SENDS = {
    // a full quit, the same as the tray's Quit
    "quit-app": {},
    // the renderer's errors, in main's log
    "renderer-log": { browser: true },
} as const satisfies Record<string, { readonly browser?: true }>;

export const SHELL_PUSHES = {
    "app-update-state": true,
    "update-queue": true,
    "computers-changed": true,
    "discovery-changed": true,
    "computer-setup-changed": true,
    "graphics-changed": true,
    "panel-permission-ask": true,
    "panel-screen-pick": true,
    "panel-permission-system": true,
    "panel-permission-failed": true,
    "panel-permissions-changed": true,
    "quit-ask": true,
} as const satisfies Record<string, true>;

export type ShellCall = keyof typeof SHELL_CALLS;
export type ShellSend = keyof typeof SHELL_SENDS;
export type ShellPush = keyof typeof SHELL_PUSHES;
/** what browser mode serves */
export type BrowserShellCall = { [K in ShellCall]: (typeof SHELL_CALLS)[K] extends { browser: true } ? K : never }[ShellCall];
export type BrowserShellSend = { [K in ShellSend]: (typeof SHELL_SENDS)[K] extends { browser: true } ? K : never }[ShellSend];

export interface ShellCallContract {
    // throws until the local daemon is verified: why it isn't, once known.
    // token is a secret the renderer needs: the shell is a PaperAPI host and
    // dials its daemon itself with this token, on loopback by port, or at a
    // URL where a host reaches it some other way (Paperboard web's relay)
    "crane-credentials": {
        args: void;
        answer: { port: number; token: string; computerId: string } | { url: string; token: string; computerId: string };
    };
    "computers-list": { args: void; answer: ComputerListResult };
    "computer-probe": { args: { host: string; port?: number | string }; answer: ComputerProbeResult };
    "computer-reach": { args: { id: string }; answer: ComputerReachResult };
    "computer-pair": {
        // no name: a new computer is named by its hostname, and one paired again keeps its own
        args: { host: string; port?: number | string; code: string };
        // the id of the computer it paired, which the shell goes to, and
        // nothing more: the pairing's token stays in main
        answer: { id?: string };
    };
    "computer-update": { args: { id: string; name: string }; answer: boolean };
    // null once forgotten; otherwise why the computer couldn't be told, and
    // nothing was forgotten unless evenIfUntold
    "computer-remove": { args: { id: string; evenIfUntold?: boolean }; answer: string | null };
    "computer-switch": { args: { id: string }; answer: boolean };
    "computer-reorder": { args: { ids: string[] }; answer: void };
    "discovery-list": { args: void; answer: DiscoveredComputer[] };
    // whether an SSH server answers for host (an address or ~/.ssh/config alias)
    "computer-ssh-check": { args: { host: string }; answer: { ssh: boolean } };
    // sets the computer up over SSH; progress comes as computer-setup-changed.
    // A new setup cancels the one before it.
    // answers with the setup as it stands, so what it pushed before the answer isn't missed
    "computer-setup-start": { args: { host: string }; answer: ComputerSetupState };
    // the password is used for this setup alone, and never stored
    "computer-setup-sign-in": { args: { jobId: string; username: string; password: string }; answer: void };
    "computer-setup-cancel": { args: { jobId: string }; answer: void };
    "open-panel-folder": { args: { computerId: string; panelId?: string }; answer: { opened: boolean; error?: string } };
    // one file of an installed panel's manifest or store listing, in base64
    "panel-listing-file": { args: { computerId: string; panelId: string; path: string }; answer: string };
    "app-version": { args: void; answer: string };
    "launch-options": { args: void; answer: LaunchOptions };
    graphics: { args: void; answer: Graphics };
    // settings saved over the daemon still need main's side effects: why
    // Run on startup couldn't be applied, or null
    "app-settings-changed": { args: void; answer: string | null };
    // Report an Issue: the diagnostics it attaches (the computer looked at,
    // its panels, recent log lines), scrubbed, as the person sees them, with
    // an id for this gather
    "issue-details": { args: void; answer: { id: string; text: string } };
    // sends what the person typed, and the diagnostics gathered under
    // `detailsId` (null when they left them out), to Paperboard's issues
    // service (services/issues), with this app's version and system. The
    // diagnostics stay in main: a body over the browser-mode bridge's cap is
    // refused, and the id makes what's sent the very text that was shown.
    "issue-send": { args: { text: string; detailsId: string | null }; answer: void };

    "app-update-state": { args: void; answer: AppUpdateState };
    "update-queue": { args: void; answer: UpdateQueueState };
    "update-release": { args: { keys: string[] }; answer: void };
    "update-check": { args: void; answer: UpdateCheckOutcome };
    "open-update-download": { args: void; answer: void };
    // false when a page with unsaved work kept Paperboard open
    "quit-and-install": { args: void; answer: boolean };
    "panel-file-export": { args: PanelFileTransferArgs; answer: PanelFileTransferResult };
    "panel-file-import": { args: PanelFileTransferArgs; answer: PanelFileTransferResult };
    "panel-loopback-redirect": { args: { requestId: string; redirectUri: unknown }; answer: PanelLoopbackRedirectResult };
    "panel-loopback-redirect-cancel": { args: { requestId: string }; answer: void };
    "backup-gdrive-connect": {
        args: { computerId: string; label: string } | { computerId: string; locationId: string };
        answer: ShellBackupLocation;
    };
    "backup-gdrive-cancel": { args: void; answer: void };
    "panel-permission-answer": { args: { askId: string; answer: string | null }; answer: void };
    "panel-permissions-list": { args: void; answer: PanelPermissionEntry[] };
    "panel-permission-set": { args: { panelId: string; permission: PanelPermission; answer: PermissionAnswer }; answer: void };
    "open-system-privacy": { args: { permission: PanelPermission }; answer: void };
    "panels-unsaved": { args: { unsaved: boolean }; answer: void };
    "quit-answer": { args: { askId: string; answer: boolean }; answer: void };
}

export interface ShellSendContract {
    "quit-app": void;
    "renderer-log": { level: "error" | "warn" | "info"; message: string };
}

export interface ShellPushContract {
    "app-update-state": AppUpdateState;
    "update-queue": UpdateQueueState;
    "computers-changed": ComputerListResult;
    "discovery-changed": DiscoveredComputer[];
    "computer-setup-changed": ComputerSetupState;
    "graphics-changed": Graphics;
    "panel-permission-ask": PermissionAsk;
    "panel-screen-pick": ScreenPick;
    "panel-permission-system": SystemBlock;
    "panel-permission-failed": PermissionFailure;
    "panel-permissions-changed": void;
    "quit-ask": { askId: string };
}

export type CallArgs<K extends ShellCall> = ShellCallContract[K]["args"];
export type CallAnswer<K extends ShellCall> = ShellCallContract[K]["answer"];
export type SendArgs<K extends ShellSend> = ShellSendContract[K];
export type PushPayload<K extends ShellPush> = ShellPushContract[K];
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

/** The bridge the preload exposes, and browser mode stands in for: channels and values as they travel. */
export interface ShellWire {
    invoke(channel: string, args?: unknown): Promise<unknown>;
    send(channel: string, args?: unknown): void;
    /** the payload of each push on `channel`; returns what stops listening */
    on(channel: string, listener: (payload: unknown) => void): () => void;
}
