// Shell request handlers, independent of the transport that carries them.
// Electron IPC (shelldata.ts) and the browser-mode bridge (browserHost.ts)
// register the SAME functions; each transport owns its own caller check
// (senderFrame origin for IPC, session cookie + Origin for HTTP). Only
// requests both shells need live here — window and updater
// channels stay Electron-only in shelldata.ts.
import * as path from "path";
import connectionPool from "./papercrane/ConnectionPool";
import discovery from "./discovery";
import { getPaperboardDir, getFilesDir, ensureDir } from "../../../papercrane/paths";
import { sanitizeId } from "../../../papercrane/storage";
import { logger } from "../../../papercrane/logger";
import { openRemoteFolder } from "../remoteFolder";
import { servePanelAsset } from "../panelServe";
import type { LaunchOptions } from "../../shared/launchOptions";
import type { Graphics } from "../../shared/graphics";
import { isListingFilePath, LISTING_FILE_MAX_BYTES } from "../../shared/listingFile";
import { field } from "../../shared/fileTransfer";
import type { SHARED_SHELL_INVOKE_CHANNELS } from "./shellChannels";

export interface ShellHandlerDeps {
    appVersion: () => string;
    launchOptions: () => LaunchOptions;
    graphics: () => Graphics;
    // resolves to an error message, empty on success (Electron shell.openPath)
    openPath: (dir: string) => Promise<string>;
}

export type ShellInvokeHandler = (args: unknown) => unknown;

export type SharedShellInvokeChannel = (typeof SHARED_SHELL_INVOKE_CHANNELS)[number];

function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) {
        throw new Error(`Missing required parameter: ${name}`);
    }
    return value;
}

// a port as typed: the pool checks its range
function typedPort(args: unknown): number | string | undefined {
    const port = field(args, "port");
    if (port !== undefined && typeof port !== "number" && typeof port !== "string") {
        throw new Error("port must be a number or a string");
    }
    return port;
}

export function createShellInvokeHandlers(
    deps: ShellHandlerDeps,
): Record<SharedShellInvokeChannel, ShellInvokeHandler> {
    return {
        // throws until the local daemon is verified: why it isn't, once known
        "crane-credentials": () => {
            const local = connectionPool.getClient("local");
            const creds = local.getLocalCredentials();
            if (!creds) throw new Error(local.getStatus().error ?? "Paperboard Server isn't ready yet. Try again in a moment.");
            return { ...creds, computerId: "local" };
        },

        "computers-list": () => ({
            computers: connectionPool.listComputers(),
            activeId: connectionPool.getActiveId(),
        }),

        "computer-probe": async (args) => {
            return await connectionPool.probe(requireString(field(args, "host"), "host"), typedPort(args));
        },

        "computer-pair": async (args) => {
            const host = requireString(field(args, "host"), "host");
            const code = requireString(field(args, "code"), "code");
            return await connectionPool.pairComputer(host, typedPort(args), code, field(args, "name"));
        },

        "computer-update": (args) => connectionPool.renameComputer(requireString(field(args, "id"), "id"), field(args, "name")),

        // renderer input is validated here, not trusted from the caller's types
        "computer-remove": (args) => connectionPool.unpairComputer(requireString(field(args, "id"), "id"), field(args, "evenIfUntold") === true),

        "computer-switch": (id) => connectionPool.setActive(requireString(id, "id")),

        "computer-reorder": (args) => {
            const ids = field(args, "ids");
            if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
                throw new Error("ids must be a list of computer ids");
            }
            connectionPool.reorderComputers(ids);
        },

        "discovery-list": () => discovery.look(),

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
            // an unopened folder answers why, so the shell can say so
            if (computerId !== "local") {
                const res = await openRemoteFolder(computerId, cleanPanelId ?? undefined);
                if (!res.ok) {
                    logger.warn(`[Shell] open-panel-folder (remote ${computerId}) failed:`, res.error);
                    return { opened: false, error: res.error ?? "The folder couldn't be opened." };
                }
                return { opened: true };
            }
            const dir = cleanPanelId ? path.join(getFilesDir(), cleanPanelId) : getPaperboardDir();
            try {
                ensureDir(dir);
            } catch (err: any) {
                logger.warn("[Shell] open-panel-folder failed:", err?.message ?? err);
                return { opened: false, error: `${dir} couldn't be created: ${err?.message ?? err}` };
            }
            // the file manager reports failure as a message, not a throw
            const failure = await deps.openPath(dir);
            if (failure) {
                logger.warn("[Shell] open-panel-folder could not open", dir, failure);
                return { opened: false, error: failure };
            }
            return { opened: true };
        },

        // app version for shell label
        "app-version": () => deps.appVersion(),

        // command-line switches the shell honors, e.g. --mobile
        "launch-options": () => deps.launchOptions(),
        graphics: () => deps.graphics(),
    };
}
