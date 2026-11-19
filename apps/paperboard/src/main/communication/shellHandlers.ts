// The calls both shells serve (BrowserShellCall in shared/shellContract.ts),
// independent of the transport that carries them. Electron IPC
// (shelldata.ts) and the browser-mode bridge (browserMode.ts) serve the SAME
// functions through shellServer.ts, which reads each call's args against
// the contract first; each transport owns its own caller check (senderFrame
// origin for IPC, session cookie + Origin for HTTP). Window and updater
// calls stay Electron-only in shelldata.ts.
import * as path from "path";
import connectionPool from "./papercrane/ConnectionPool";
import discovery from "./discovery";
import { getPaperboardDir, getFilesDir, ensureDir } from "daemon/core/paths";
import { sanitizeId } from "daemon/core/storage";
import { logger } from "daemon/core/logger";
import { openRemoteFolder } from "../remoteFolder";
import { servePanelAsset } from "../panelServe";
import type { LaunchOptions } from "../../shared/launchOptions";
import type { Graphics } from "../../shared/graphics";
import { isListingFilePath, LISTING_FILE_MAX_BYTES } from "../../shared/listingFile";
import type { BrowserShellCall } from "../../shared/shellContract";
import type { CallHandlers } from "./shellServer";

export interface ShellHandlerDeps {
    appVersion: () => string;
    launchOptions: () => LaunchOptions;
    graphics: () => Graphics;
    // resolves to an error message, empty on success (Electron shell.openPath)
    openPath: (dir: string) => Promise<string>;
    // main's side effects of freshly saved settings: why Run on startup
    // couldn't be applied, or null
    appSettingsChanged: () => Promise<string | null>;
}

export function createShellInvokeHandlers(deps: ShellHandlerDeps): CallHandlers<BrowserShellCall, unknown> {
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

        "computer-probe": ({ host, port }) => connectionPool.probe(host, port),
        // the shell goes to the computer it paired; its token and pinned
        // certificate stay in main, which dials it
        "computer-pair": async ({ host, port, code, name }) => ({ id: (await connectionPool.pairComputer(host, port, code, name)).id }),
        "computer-update": ({ id, name }) => connectionPool.renameComputer(id, name),
        "computer-remove": ({ id, evenIfUntold }) => connectionPool.unpairComputer(id, evenIfUntold === true),
        "computer-switch": ({ id }) => connectionPool.setActive(id),
        "computer-reorder": ({ ids }) => connectionPool.reorderComputers(ids),

        "discovery-list": () => discovery.look(),

        // local dir or panel files dir; remotes mount an ephemeral session
        // base64 so both transports (IPC structured clone, browser-mode
        // JSON) carry the same value
        "panel-listing-file": async ({ computerId, panelId, path: given }) => {
            const subpath = given.replace(/^\.?\/+/, "");
            if (!isListingFilePath(subpath)) throw new Error(`Not a listing file: ${subpath}`);
            const res = await servePanelAsset(computerId, panelId, subpath);
            if (!res.ok) throw new Error(`${subpath}: ${res.status} ${await res.text()}`);
            const bytes = Buffer.from(await res.arrayBuffer());
            if (bytes.byteLength > LISTING_FILE_MAX_BYTES) {
                throw new Error(`${subpath} is over the ${LISTING_FILE_MAX_BYTES}-byte listing cap`);
            }
            return bytes.toString("base64");
        },
        "open-panel-folder": async ({ computerId, panelId }) => {
            // sanitize at this layer for BOTH branches: the remote branch
            // must not receive raw input either
            const cleanPanelId = panelId ? sanitizeId(panelId) : null;
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
        "app-settings-changed": () => deps.appSettingsChanged(),
    };
}
