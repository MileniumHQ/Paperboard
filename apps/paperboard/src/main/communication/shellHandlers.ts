// Shell request handlers, independent of the transport that carries them.
// Electron IPC (shelldata.ts) and the browser-mode bridge (browserHost.ts)
// register the SAME functions; each transport owns its own caller check
// (senderFrame origin for IPC, session cookie + Origin for HTTP). Only
// requests both shells need live here — window, clipboard and updater
// channels stay Electron-only in shelldata.ts.
import * as path from "path";
import connectionPool from "./papercrane/ConnectionPool";
import discovery from "./discovery";
import { getPaperboardDir, getFilesDir, ensureDir } from "../../../papercrane/paths";
import { sanitizeId } from "../../../papercrane/storage";
import { logger } from "../../../papercrane/logger";
import { readCraneHandshake } from "../../../papercrane/handshake";
import { openRemoteFolder } from "../remoteFolder";
import { servePanelAsset } from "../panelServe";

// The panel library reads an installed panel's manifest and listing media,
// nothing else: never HTML (the serve path injects credentials into it),
// never scripts, and never more than the listing caps allow.
const LISTING_FILE_MAX_BYTES = 2 * 1024 * 1024;
const LISTING_FILE_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg", ".md"]);

export function isListingFilePath(subpath: string): boolean {
    if (subpath === "manifest.json") return true;
    if (subpath.split(/[\\/]/).includes("..")) return false;
    return LISTING_FILE_EXTENSIONS.has(path.extname(subpath).toLowerCase());
}

export interface ShellHandlerDeps {
    appVersion: () => string;
    // resolves to an error message, empty on success (Electron shell.openPath)
    openPath: (dir: string) => Promise<string>;
}

export type ShellInvokeHandler = (args: unknown) => unknown;

// channels served by every shell host (a subset of SHELL_INVOKE_CHANNELS)
export const SHARED_SHELL_INVOKE_CHANNELS = [
    "crane-credentials",
    "computers-list",
    "computer-probe",
    "computer-pair",
    "computer-update",
    "computer-remove",
    "computer-switch",
    "discovery-list",
    "open-panel-folder",
    "panel-listing-file",
    "app-version",
] as const;

export type SharedShellInvokeChannel = (typeof SHARED_SHELL_INVOKE_CHANNELS)[number];

function field(args: unknown, key: string): unknown {
    return args && typeof args === "object" ? (args as Record<string, unknown>)[key] : undefined;
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) {
        throw new Error(`Missing required parameter: ${name}`);
    }
    return value;
}

export function createShellInvokeHandlers(
    deps: ShellHandlerDeps,
): Record<SharedShellInvokeChannel, ShellInvokeHandler> {
    return {
        // throws retryable CRANE_NOT_READY until embedded daemon is up
        "crane-credentials": () => {
            const creds = readCraneHandshake();
            if (!creds) throw new Error("CRANE_NOT_READY");
            return { ...creds, computerId: "local" };
        },

        "computers-list": () => ({
            computers: connectionPool.listComputers(),
            activeId: connectionPool.getActiveId(),
        }),

        "computer-probe": async (args) => {
            const host = requireString(field(args, "host"), "host");
            return await connectionPool.probe(host, field(args, "port") as number | undefined);
        },

        "computer-pair": async (args) => {
            const host = requireString(field(args, "host"), "host");
            const code = requireString(field(args, "code"), "code");
            return await connectionPool.pairComputer(
                host,
                field(args, "port") as number | undefined,
                code,
                field(args, "name") as string | undefined,
            );
        },

        "computer-update": (args) => {
            const id = requireString(field(args, "id"), "id");
            return connectionPool.updateComputer(id, {
                name: field(args, "name") as string | undefined,
                port: field(args, "port") as number | undefined,
            });
        },

        // renderer input is validated here, not trusted from the caller's types
        "computer-remove": (id) => connectionPool.removeComputer(requireString(id, "id")),

        "computer-switch": (id) => connectionPool.setActive(requireString(id, "id")),

        "discovery-list": () => {
            discovery.refresh();
            return discovery.list();
        },

        // local dir or panel files dir; remotes mount an ephemeral session
        // base64 so both transports (IPC structured clone, browser-mode
        // JSON) carry the same value
        "panel-listing-file": async (args) => {
            const computerId = requireString(field(args, "computerId"), "computerId");
            const panelId = sanitizeId(requireString(field(args, "panelId"), "panelId"));
            if (!panelId) throw new Error("Invalid parameter: panelId");
            const subpath = requireString(field(args, "path"), "path").replace(/^\.?\/+/, "");
            if (!isListingFilePath(subpath)) throw new Error(`Not a listing file: ${subpath}`);
            const res = await servePanelAsset(computerId, panelId, subpath);
            if (!res.ok) throw new Error(`${subpath}: ${res.status} ${await res.text()}`);
            const bytes = Buffer.from(await res.arrayBuffer());
            if (bytes.byteLength > LISTING_FILE_MAX_BYTES) {
                throw new Error(`${subpath} is over the ${LISTING_FILE_MAX_BYTES}-byte listing cap`);
            }
            return bytes.toString("base64");
        },
        "open-panel-folder": async (args) => {
            const computerId = requireString(field(args, "computerId"), "computerId");
            const panelId = field(args, "panelId");
            // sanitize at this layer for BOTH branches: the remote branch
            // must not receive raw input either
            const cleanPanelId = panelId ? sanitizeId(panelId as string) : null;
            if (panelId && !cleanPanelId) {
                throw new Error("Invalid parameter: panelId");
            }
            if (computerId !== "local") {
                const res = await openRemoteFolder(computerId, cleanPanelId ?? undefined);
                if (!res.ok) {
                    logger.warn(`[Shell] open-panel-folder (remote ${computerId}) failed:`, res.error);
                }
                return res.ok;
            }
            const dir = cleanPanelId ? path.join(getFilesDir(), cleanPanelId) : getPaperboardDir();
            try {
                ensureDir(dir);
            } catch (err: any) {
                logger.warn("[Shell] open-panel-folder failed:", err?.message ?? err);
                return false;
            }
            // the file manager reports failure as a message, not a throw:
            // an unopened folder must answer false, not true
            const failure = await deps.openPath(dir);
            if (failure) {
                logger.warn("[Shell] open-panel-folder could not open", dir, failure);
                return false;
            }
            return true;
        },

        // app version for shell label
        "app-version": () => deps.appVersion(),
    };
}
