// Shell document serving, shared by every shell host: the Electron
// paperboard:// protocol handler and the browser-mode HTTP host both read
// the built renderer through readShellFile — one implementation of
// containment and response headers. Imports nothing from Electron.
//
// The packaged Electron shell is served from paperboard://shell, never
// file://. The daemon's WebSocket origin allowlist refuses file:// (any
// local HTML file would share it), so a file:// shell cannot reach its
// own local server.
import * as fs from "fs";
import * as path from "path";
import { lookupMime } from "../../papercrane/mime";

export const SHELL_SCHEME = "paperboard";
export const SHELL_HOST = "shell";
export const SHELL_ORIGIN = `${SHELL_SCHEME}://${SHELL_HOST}`;

export type ShellFile =
    | { ok: true; data: Buffer; headers: Record<string, string> }
    | { ok: false; status: 400 | 403 | 404 };

export async function readShellFile(rendererDir: string, pathname: string): Promise<ShellFile> {
    const root = path.resolve(rendererDir);
    let rel: string;
    try {
        rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    } catch (err) {
        if (err instanceof URIError) return { ok: false, status: 400 };
        throw err;
    }
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return { ok: false, status: 403 };
    let data: Buffer;
    try {
        data = await fs.promises.readFile(file);
    } catch (err: any) {
        if (err?.code === "ENOENT" || err?.code === "EISDIR") return { ok: false, status: 404 };
        throw err;
    }
    const ext = path.extname(file).toLowerCase();
    return {
        ok: true,
        data,
        headers: {
            "Content-Type": lookupMime(ext),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
            // the shell is never framed by anyone
            "Content-Security-Policy": "frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
        },
    };
}
