// The calls both shells serve (BrowserShellCall in shared/shellContract.ts),
// independent of the transport that carries them. Electron IPC
// (shelldata.ts) and the browser-mode bridge (browserMode.ts) serve the SAME
// functions through shellServer.ts, which reads each call's args against
// the contract first; each transport owns its own caller check (senderFrame
// origin for IPC, session cookie + Origin for HTTP). Window and updater
// calls stay Electron-only in shelldata.ts.
import * as path from "path";
import connectionPool, { LOCAL_COMPUTER_NAME } from "./papercrane/ConnectionPool";
import discovery from "./discovery";
import { getPaperboardDir, getFilesDir, getLogsDir, ensureDir } from "daemon/core/paths";
import { buildDetails, localScrubber, readLogTail, type DetailsInput } from "../issueDetails";
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
    // Report an Issue: sends the text and diagnostics with what this host says about itself
    sendIssue: (text: string, details: string) => Promise<void>;
}

// Report an Issue's diagnostics: the computer the shell shows, its panels,
// and the end of this computer's log, scrubbed (issueDetails.ts)
async function collectIssueDetails(): Promise<string> {
    const computers = connectionPool.listComputers();
    const activeId = connectionPool.getActiveId();
    const active = computers.find((computer) => computer.id === activeId) ?? computers.find((computer) => computer.id === "local");
    const paired = computers.filter((computer) => computer.id !== "local");
    let panels: DetailsInput["panels"];
    try {
        panels = (await connectionPool.getClient(active?.id ?? "local").listPanels()).map((panel) => ({ id: panel.id, version: panel.version }));
    } catch (err) {
        // quiet: an unreadable panel list is itself a finding, and the details say so
        panels = { error: err instanceof Error ? err.message : String(err) };
    }
    return buildDetails(
        {
            computer: {
                kind: active && active.id !== "local" ? "paired" : "this",
                os: active?.os,
                osVersion: active?.osVersion,
                connected: active?.status.connected ?? false,
            },
            pairedCount: paired.length,
            panels,
            log: readLogTail(getLogsDir()),
        },
        // every computer's name, this one's included: the app logs a custom name it was given.
        // The default name says nothing, and "this computer" in the details is Paperboard's own wording.
        localScrubber(
            [...computers, ...discovery.list()]
                .filter((computer) => computer.name !== LOCAL_COMPUTER_NAME)
                .flatMap((computer) => [computer.name, computer.host]),
        ),
    );
}

export function createShellInvokeHandlers(deps: ShellHandlerDeps): CallHandlers<BrowserShellCall, unknown> {
    // the diagnostics the person last saw. They stay here and issue-send
    // sends exactly these, so the form never carries up to 60 KB back (the
    // browser-mode bridge refuses bodies over 64 KiB), and what's sent is
    // what was shown.
    let gathered: string | null = null;
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
        "issue-details": async () => {
            gathered = null;
            gathered = await collectIssueDetails();
            return gathered;
        },
        "issue-send": ({ text, includeDetails }) => {
            if (typeof text !== "string") throw new Error("Invalid parameter: text");
            if (typeof includeDetails !== "boolean") throw new Error("Invalid parameter: includeDetails");
            if (includeDetails && gathered === null) throw new Error("The logs weren't gathered. Reopen Report an Issue and try again.");
            return deps.sendIssue(text, includeDetails ? gathered! : "");
        },
    };
}
