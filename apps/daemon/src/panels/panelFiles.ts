// /panel-files/<panelId>/<path>: one panel's file storage as a byte stream,
// for the host's save and open dialogs. The daemon owns the files, so the
// path check lives here, in the same resolver file:read and file:write use
// (engine.resolveSecureTargetPath). Host credential only: the shell asks on
// behalf of the panel frame the user is looking at.
//
// /panel-files/<panelId>?path=<absolute path>: a file anywhere on this
// computer, for a panel that shows files outside its storage (Drive's
// disks and linked folders). Panels are trusted and their services already
// reach every file, so this only lets the save and open dialogs reach them too.
import type * as http from "http";
import * as fs from "fs";
import * as path from "path";
import type { PaperCraneEngine } from "../engine/index";
import type { PaperCraneAuth } from "../security/auth";
import { davMaxUploadBytes, replyText as reply, sendFileStream } from "../server/dav";
import { isMainBearer } from "../server/davAuth";
import { receiveFileAtomic, UploadTooLargeError } from "../server/atomicUpload";
import { isPanelId } from "@mileniumhq/paperapi/panelIdentity";
import { logger } from "../core/logger";
import { isMissingPathError, openResolvedFile } from "../core/pathContainment";

export const PANEL_FILES_PREFIX = "/panel-files/";
export const PANEL_FILE_PATH_MAX = 1024;

export interface PanelFileTarget {
    panelId: string;
    filePath: string;
    /** a path anywhere on this computer, not in the panel's storage */
    absolute: boolean;
}

/**
 * What a /panel-files request names: "<panelId>/<path>" in the panel's
 * storage, or "<panelId>?path=<absolute path>"; null when malformed.
 */
export function parsePanelFileTarget(url: string): PanelFileTarget | null {
    if (!url.startsWith(PANEL_FILES_PREFIX)) return null;
    const question = url.indexOf("?");
    const rest = url.slice(PANEL_FILES_PREFIX.length, question < 0 ? undefined : question);
    if (!rest.includes("/")) {
        const filePath = question < 0 ? null : new URLSearchParams(url.slice(question + 1)).get("path");
        let panelId: string;
        try {
            panelId = decodeURIComponent(rest);
        } catch (err) {
            logger.debug("[panel-files] undecodable panel id:", err);
            return null;
        }
        if (!isPanelId(panelId) || !filePath || filePath.length > PANEL_FILE_PATH_MAX || filePath.includes("\0") || !path.isAbsolute(filePath)) return null;
        return { panelId, filePath: path.resolve(filePath), absolute: true };
    }
    const parsed = parsePanelFilePath(rest);
    return parsed && { ...parsed, absolute: false };
}

/** "<panelId>/<path>" after the prefix, decoded; null when malformed */
export function parsePanelFilePath(rest: string): { panelId: string; filePath: string } | null {
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    let panelId: string;
    let filePath: string;
    try {
        panelId = decodeURIComponent(rest.slice(0, slash));
        filePath = rest.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
    } catch (err) {
        logger.debug("[panel-files] undecodable path:", err);
        return null;
    }
    if (!isPanelId(panelId) || !filePath || filePath.length > PANEL_FILE_PATH_MAX || filePath.includes("\0")) return null;
    return { panelId, filePath };
}

export async function handlePanelFileRequest(
    engine: PaperCraneEngine,
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    try {
        await servePanelFile(engine, auth, req, res);
    } catch (err) {
        logger.warn("[panel-files] request failed:", (err as Error)?.message ?? err);
        if (res.headersSent) res.destroy();
        else reply(res, 500, "Panel file request failed");
    }
}

async function servePanelFile(
    engine: PaperCraneEngine,
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    if (!isMainBearer(auth, req)) {
        req.resume();
        reply(res, 401, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="Paperboard Server"' });
        return;
    }
    // the raw request path, never a URL-normalized one: normalizing turns
    // "<panel>/../<other>/x" and its %2e%2e spelling into another panel's
    // path before the resolver could refuse the traversal
    const parsed = parsePanelFileTarget(req.url || "");
    if (!parsed) {
        req.resume();
        reply(res, 400, "Invalid panel id or file path");
        return;
    }
    const method = (req.method || "GET").toUpperCase();
    // a file named anywhere on the computer is read through its links, as the
    // panel's service would read it; only the panel's storage is a boundary
    let validate: () => string;
    if (parsed.absolute) {
        let real = parsed.filePath;
        if (method === "GET" || method === "HEAD") {
            try {
                real = fs.realpathSync(parsed.filePath);
            } catch (err) {
                if (!isMissingPathError(err)) throw err;
                reply(res, 404, "No such file");
                return;
            }
        }
        validate = () => real;
    } else {
        validate = () => engine.resolveSecureTargetPath(parsed.filePath, parsed.panelId);
    }
    let target: string;
    try {
        target = validate();
    } catch (err) {
        req.resume();
        reply(res, 403, (err as Error).message);
        return;
    }
    if (!parsed.absolute && target === engine.resolveSecureTargetPath("", parsed.panelId)) {
        req.resume();
        reply(res, 400, "A file path is required");
        return;
    }

    if (method === "GET" || method === "HEAD") {
        let st: fs.Stats;
        try {
            st = fs.lstatSync(target);
        } catch (err) {
            // only a missing file is a 404; a permission or I/O failure is
            // the 500 handlePanelFileRequest answers with its reason logged
            if (!isMissingPathError(err)) throw err;
            reply(res, 404, "No such file");
            return;
        }
        // a symlink is never followed out of the panel's storage (an absolute path was resolved through its links above)
        if (!st.isFile() || st.isSymbolicLink()) {
            reply(res, 403, "Not a file");
            return;
        }
        if (method === "HEAD") {
            res.writeHead(200, { "Content-Length": String(st.size) });
            res.end();
            return;
        }
        const fd = openResolvedFile(target, validate);
        const opened = fs.fstatSync(fd);
        res.writeHead(200, { "Content-Length": String(opened.size), "Content-Type": "application/octet-stream" });
        sendFileStream(res, fs.createReadStream(target, { fd, autoClose: true }));
        return;
    }

    if (method === "PUT") {
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) {
                req.resume();
                reply(res, 409, "The target is not a file");
                return;
            }
            const existed = fs.existsSync(target);
            await receiveFileAtomic(req, target, davMaxUploadBytes(), validate);
            res.writeHead(existed ? 204 : 201);
            res.end();
        } catch (err) {
            if (err instanceof UploadTooLargeError) {
                reply(res, 413, `The file is larger than this computer accepts (${err.cap} bytes)`);
                return;
            }
            logger.warn("[panel-files] PUT failed:", (err as Error)?.message ?? err);
            reply(res, 500, "Write failed");
        }
        return;
    }

    req.resume();
    reply(res, 405, "Method not allowed", { Allow: "GET, HEAD, PUT" });
}
