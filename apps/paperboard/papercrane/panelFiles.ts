// /panel-files/<panelId>/<path>: one panel's file storage as a byte stream,
// for the host's save and open dialogs. The daemon owns the files, so the
// path check lives here, in the same resolver file:read and file:write use
// (engine.resolveSecureTargetPath). Host credential only: the shell asks on
// behalf of the panel frame the user is looking at.
import type * as http from "http";
import * as fs from "fs";
import * as path from "path";
import type { PaperCraneEngine } from "./engine";
import type { PaperCraneAuth } from "./auth";
import { davMaxUploadBytes, isMainBearer } from "./dav";
import { receiveFileAtomic, UploadTooLargeError } from "./atomicUpload";
import { isPanelId } from "../../../packages/paperapi/src/panelIdentity";
import { logger } from "./logger";
import { openResolvedFile } from "./storage";

export const PANEL_FILES_PREFIX = "/panel-files/";
export const PANEL_FILE_PATH_MAX = 1024;

function reply(res: http.ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, { "Content-Type": "text/plain", ...extra });
    res.end(text);
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
    const raw = (req.url || "").split("?")[0];
    const parsed = raw.startsWith(PANEL_FILES_PREFIX) ? parsePanelFilePath(raw.slice(PANEL_FILES_PREFIX.length)) : null;
    if (!parsed) {
        req.resume();
        reply(res, 400, "Invalid panel id or file path");
        return;
    }
    const validate = () => engine.resolveSecureTargetPath(parsed.filePath, parsed.panelId);
    let target: string;
    try {
        target = validate();
    } catch (err) {
        req.resume();
        reply(res, 403, (err as Error).message);
        return;
    }
    const base = engine.resolveSecureTargetPath("", parsed.panelId);
    if (target === base) {
        req.resume();
        reply(res, 400, "A file path is required");
        return;
    }
    const method = (req.method || "GET").toUpperCase();

    if (method === "GET" || method === "HEAD") {
        let st: fs.Stats;
        try {
            st = fs.lstatSync(target);
        } catch {
            reply(res, 404, "No such file");
            return;
        }
        // a symlink is never followed out of the panel's storage
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
        const body = fs.createReadStream(target, { fd, autoClose: true });
        body.on("error", (error) => res.destroy(error));
        res.once("close", () => body.destroy());
        body.pipe(res);
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
