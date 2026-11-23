// Privileged shell-only IPC; panels speak PaperCrane directly over WebSocket.
// Every channel is the contract's (shared/shellContract.ts): calls, sends and
// pushes are typed by it.
import { onCleanup } from "solid-js";
import { panelPath } from "@mileniumhq/paperapi";
import { createBrowserBridge } from "./browserBridge";
import type {
    CallAnswer,
    CallArgs,
    ComputerInfo,
    Given,
    PushPayload,
    SendArgs,
    ShellCall,
    ShellPush,
    ShellSend,
    ShellWire,
} from "../../../shared/shellContract";
import type { PanelPermission, PermissionAnswer } from "../../../shared/panelPermissions";

export type { ComputerInfo, ComputerListResult, ComputerProbeResult, DiscoveredComputer } from "../../../shared/shellContract";

export interface ShellIpc {
    invoke<K extends ShellCall>(channel: K, ...args: Given<CallArgs<K>>): Promise<CallAnswer<K>>;
    send<K extends ShellSend>(channel: K, ...args: Given<SendArgs<K>>): void;
    /** returns what stops listening */
    on<K extends ShellPush>(channel: K, listener: (payload: PushPayload<K>) => void): () => void;
}

// Electron hands main's refusal of a call over as "Error invoking remote
// method '<channel>': Error: <why>"; the shell says only why
const ELECTRON_REFUSAL = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

function refusal(err: unknown): unknown {
    if (!(err instanceof Error) || !ELECTRON_REFUSAL.test(err.message)) return err;
    return new Error(err.message.replace(ELECTRON_REFUSAL, ""), { cause: err });
}

function typed(wire: ShellWire): ShellIpc {
    return {
        invoke: async (channel, ...args) => {
            try {
                return (await wire.invoke(channel, args[0])) as CallAnswer<typeof channel>;
            } catch (err) {
                throw refusal(err);
            }
        },
        send: (channel, ...args) => wire.send(channel, args[0]),
        on: (channel, listener) => wire.on(channel, (payload) => listener(payload as PushPayload<typeof channel>)),
    };
}

// Electron windows get the preload bridge; browser mode (`--browser`) has
// no preload and talks to the host over HTTP with the same wire.
let ipc: ShellIpc | null = null;

export function isBrowserShell(): boolean {
    return !window.paperboardShell;
}

export function shellIpc(): ShellIpc {
    ipc ??= typed(window.paperboardShell ?? createBrowserBridge());
    return ipc;
}

/**
 * A state main keeps and pushes whenever it changes: `read` reads it once
 * and `watch` hears each push. `accept` gets the read and each push, except
 * one older than `current()` (a push and the read travel separately) and any
 * after the owner is disposed. `failed` gets why the read failed. Called
 * where onCleanup reaches the owner, such as onMount.
 */
export function subscribeRevisioned<T extends { revision: number }>(
    read: () => Promise<T>,
    watch: (listener: (next: T) => void) => () => void,
    current: () => T,
    accept: (next: T) => void,
    failed: (err: unknown) => void,
): void {
    let disposed = false;
    const take = (next: T) => {
        if (disposed || next.revision < current().revision) return;
        accept(next);
    };
    const stop = watch(take);
    onCleanup(() => {
        disposed = true;
        stop();
    });
    void read().then(take).catch((err) => {
        if (!disposed) failed(err);
    });
}

// Where a panel's documents and assets load from. Electron serves each
// panel from its own panel:// origin; a browser host from a folder of the
// shell's own origin, /_panel/<computerId>/<panelId>/.
export function panelUrl(computerId: string, panelId: string, subpath = ""): string {
    const rest = subpath.replace(/^\.?\//, "");
    if (!isBrowserShell()) return `panel://${computerId}.${panelId}/${rest}`;
    return `${location.origin}${panelPath(computerId, panelId, rest)}`;
}

/**
 * Where a computer is, for people: the local computer's network address, a
 * paired one's host:port, or for one the host reaches through a relay, that
 * relay. `inSentence` words it to follow a name ("at 10.0.0.2:7210",
 * "through Remote Relay"); without it, it stands alone, as a subtitle does.
 */
export function computerAddress(
    computer: Pick<ComputerInfo, "host" | "port" | "via" | "networkAddress" | "isLocal">,
    options: { inSentence?: boolean } = {},
): string {
    if (computer.via) return `${options.inSentence ? "through" : "Through"} ${computer.via}`;
    const address = computer.isLocal ? computer.networkAddress || computer.host : `${computer.host}:${computer.port}`;
    return options.inSentence ? `at ${address}` : address;
}

/** One file of an installed panel's manifest or store listing, as bytes. */
export async function readPanelListingFile(computerId: string, panelId: string, path: string): Promise<Uint8Array> {
    const base64 = await shellIpc().invoke("panel-listing-file", { computerId, panelId, path });
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export const computersApi = {
    list: () => shellIpc().invoke("computers-list"),
    /** whether an address answers, for a computer not paired yet */
    probe: (host: string, port?: number | string) => shellIpc().invoke("computer-probe", { host, port }),
    /** whether a paired computer answers, at any address it is known by */
    reach: (id: string) => shellIpc().invoke("computer-reach", { id }),
    pair: (host: string, port: number | undefined, code: string, name?: string) =>
        shellIpc().invoke("computer-pair", { host, port, code, name }),
    rename: (id: string, name: string) => shellIpc().invoke("computer-update", { id, name }),
    /** null once forgotten; otherwise why the computer couldn't be told, and
     * nothing was forgotten unless `evenIfUntold` */
    remove: (id: string, evenIfUntold = false) => shellIpc().invoke("computer-remove", { id, evenIfUntold }),
    switch: (id: string) => shellIpc().invoke("computer-switch", { id }),
    /** every computer's id, in the rail's new order */
    reorder: (ids: string[]) => shellIpc().invoke("computer-reorder", { ids }),
    onChanged: (cb: (data: { computers: ComputerInfo[]; activeId: string }) => void) => shellIpc().on("computers-changed", cb),
};

// Nearby PaperCrane machines found via mDNS/Bonjour browsing in main.
export const discoveryApi = {
    list: () => shellIpc().invoke("discovery-list"),
    onChanged: (cb: (services: PushPayload<"discovery-changed">) => void) => shellIpc().on("discovery-changed", cb),
};

// Opens the local data dir (or a panel's files dir) in the OS file manager
export const shellApi = {
    /** an unopened folder answers why */
    openPanelFolder: (computerId: string, panelId?: string) => shellIpc().invoke("open-panel-folder", { computerId, panelId }),
    getAppVersion: () => shellIpc().invoke("app-version"),
    getLaunchOptions: () => shellIpc().invoke("launch-options"),
    /** whether Paperboard is drawn on a GPU, and again whenever that changes */
    getGraphics: () => shellIpc().invoke("graphics"),
    onGraphicsChanged: (cb: (graphics: PushPayload<"graphics-changed">) => void) => shellIpc().on("graphics-changed", cb),
};
/** Ends this browser's session (Paperboard in the browser only) and shows
 * the signed-out page. Rejects with why when the host refused. */
export async function signOutOfBrowser(): Promise<void> {
    const res = await fetch("/_shell/sign-out", { method: "POST", headers: { "Content-Type": "application/json" } });
    if (!res.ok && res.status !== 401) throw new Error(`Paperboard couldn't sign this browser out: HTTP ${res.status} ${await res.text()}`);
    location.assign("/signed-out.html");
}

// Main applies side effects of freshly persisted settings (theme, title bars,
// login item); resolves to why Run on startup couldn't be applied, or null
export function notifyAppSettingsChanged(): Promise<string | null> {
    return shellIpc().invoke("app-settings-changed");
}

// Forwards renderer errors into the main file logger
export function logToMain(
    level: "info" | "warn" | "error",
    ...args: unknown[]
): void {
    // serialization happens INSIDE the try — a circular payload must
    // degrade to a safe string here, not throw in the caller's context
    // and defeat "logging must never break the caller".
    let message = "";
    try {
        const seen = new WeakSet<object>();
        message = args
            .map((a) =>
                a instanceof Error
                    ? a.stack ?? String(a)
                    : typeof a === "object"
                      ? JSON.stringify(a, (_key, value) => {
                          if (value && typeof value === "object") {
                              if (seen.has(value)) return "[Circular]";
                              seen.add(value);
                          }
                          return value;
                      }, 2)
                      : String(a),
            )
            .join(" ");
        shellIpc().send("renderer-log", { level, message });
    } catch (err) {
        // quiet: logging must never break the caller, and there is nowhere else to log this
        console.warn("[shell.ts] logToMain failed (IPC unavailable):", err);
    }
}

// Panels ask for the microphone, camera or screen; main asks the window the
// panel is in (PanelPermissionPrompt) and keeps the answers per panel.
// A quit the person asks for waits for this window's pages with unsaved
// work (main's quitGate.ts): the window says whether it holds any, and
// answers main's ask once they had their say.
export const quitApi = {
    setUnsaved: (unsaved: boolean) => shellIpc().invoke("panels-unsaved", { unsaved }),
    onAsk: (cb: (ask: { askId: string }) => void) => shellIpc().on("quit-ask", cb),
    answer: (askId: string, quit: boolean) => shellIpc().invoke("quit-answer", { askId, answer: quit }),
};

export const panelPermissionsApi = {
    list: () => shellIpc().invoke("panel-permissions-list"),
    set: (panelId: string, permission: PanelPermission, answer: PermissionAnswer) =>
        shellIpc().invoke("panel-permission-set", { panelId, permission, answer }),
    /** a PermissionAnswer for an ask, a source id (or null) for a screen pick */
    answer: (askId: string, answer: string | null) => shellIpc().invoke("panel-permission-answer", { askId, answer }),
    openSystemSettings: (permission: PanelPermission) => shellIpc().invoke("open-system-privacy", { permission }),
    onAsk: (cb: (ask: PushPayload<"panel-permission-ask">) => void) => shellIpc().on("panel-permission-ask", cb),
    onScreenPick: (cb: (pick: PushPayload<"panel-screen-pick">) => void) => shellIpc().on("panel-screen-pick", cb),
    onSystemBlock: (cb: (block: PushPayload<"panel-permission-system">) => void) => shellIpc().on("panel-permission-system", cb),
    onFailure: (cb: (failure: PushPayload<"panel-permission-failed">) => void) => shellIpc().on("panel-permission-failed", cb),
    onChanged: (cb: () => void) => shellIpc().on("panel-permissions-changed", cb),
};
