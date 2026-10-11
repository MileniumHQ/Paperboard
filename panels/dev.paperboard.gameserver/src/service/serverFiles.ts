import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { isListableDirArg, isValidEntryName } from "../core/dirs";
import { serializedFileTask, writeFileAtomic } from "./fileWrites";

// The Files tab's owner: lists, reads and saves files under the server
// folder. Every path is checked here, at the boundary: "/"-joined safe
// segments, no symlink anywhere on the way, regular files only, and sizes
// capped. A save names the version it read, so a file the server rewrote
// in the meantime is refused instead of overwritten.

export const MAX_LISTED_ENTRIES = 1000;
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;

export interface ServerFilesDeps {
    serverDir(): Promise<string>;
}

export interface ServerFileEntry {
    name: string;
    path: string;
    kind: "file" | "folder";
}

export interface ServerFileListing {
    entries: ServerFileEntry[];
    note?: string;
}

export type ServerFileContent =
    | { kind: "text"; text: string; version: string }
    | { kind: "image"; src: string; alt: string }
    | { kind: "unavailable"; reason: string };

const IMAGE_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};

/** the path, or a folder on the way to it, is not there */
export class ServerFileMissingError extends Error {}

function errorCode(err: unknown): string | undefined {
    return (err as { code?: string } | null)?.code;
}

function assertPath(path: unknown, what: "folder" | "file"): string {
    if (!isListableDirArg(path) || (what === "file" && path === "")) {
        throw new Error(`Not a ${what} path Paperboard can open: ${JSON.stringify(path)}`);
    }
    return path;
}

/**
 * The absolute path for `relative`, after checking that no segment on the
 * way is a symlink (a link could point anywhere on the machine).
 */
async function resolveInside(root: string, relative: string) {
    let absolute = root;
    let stat = await nodeFs.lstat(root);
    for (const segment of relative ? relative.split("/") : []) {
        absolute = nodePath.join(absolute, segment);
        try {
            stat = await nodeFs.lstat(absolute);
        } catch (err) {
            if (errorCode(err) === "ENOENT") throw new ServerFileMissingError(`${relative} does not exist any more.`);
            throw err;
        }
        if (stat.isSymbolicLink()) throw new Error(`${relative} goes through a link, which the Files tab does not follow.`);
    }
    return { absolute, stat };
}

export async function listServerFiles(dir: unknown, deps: ServerFilesDeps): Promise<ServerFileListing> {
    const relative = assertPath(dir, "folder");
    const { absolute, stat } = await resolveInside(await deps.serverDir(), relative);
    if (!stat.isDirectory()) throw new Error(`${relative || "The server folder"} is not a folder.`);

    const entries: ServerFileEntry[] = [];
    let hidden = 0;
    let total = 0;
    const handle = await nodeFs.opendir(absolute);
    // read the directory as a stream so a folder of a million files costs
    // a count, not a million entries in memory
    for await (const dirent of handle) {
        const kind = dirent.isDirectory() ? "folder" : dirent.isFile() ? "file" : null;
        if (!kind || !isValidEntryName(dirent.name) || dirent.name.endsWith(".paperboard-tmp")) {
            hidden++;
            continue;
        }
        total++;
        if (entries.length < MAX_LISTED_ENTRIES) {
            entries.push({ name: dirent.name, kind, path: relative ? `${relative}/${dirent.name}` : dirent.name });
        }
    }
    entries.sort((a, b) =>
        a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

    const notes: string[] = [];
    if (total > entries.length) notes.push(`Showing ${entries.length} of ${total} items.`);
    if (hidden > 0) {
        notes.push(`${hidden} ${hidden === 1 ? "item is" : "items are"} not shown (links, hidden files, or names Paperboard cannot open).`);
    }
    return notes.length > 0 ? { entries, note: notes.join(" ") } : { entries };
}

function versionOf(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

interface TextShape {
    text: string;
    bom: boolean;
    crlf: boolean;
}

// ignoreBOM keeps the BOM in the decoded text, so a save can write it back
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

/** the text of `bytes` with LF line ends (what a text box holds), or null for binary */
function decodeText(bytes: Uint8Array): TextShape | null {
    if (bytes.subarray(0, 8192).includes(0) || !isUtf8(bytes)) return null;
    let raw = utf8.decode(bytes);
    const bom = raw.startsWith("\uFEFF");
    if (bom) raw = raw.slice(1);
    const crlf = raw.includes("\r\n");
    return { text: crlf ? raw.replace(/\r\n/g, "\n") : raw, bom, crlf };
}

function encodeText(text: string, shape: { bom: boolean; crlf: boolean }): string {
    const body = shape.crlf ? text.replace(/\r?\n/g, "\r\n") : text;
    return shape.bom ? `\uFEFF${body}` : body;
}

async function readRegularFile(root: string, relative: string) {
    const { absolute, stat } = await resolveInside(root, relative);
    if (!stat.isFile()) throw new Error(`${relative} is not a file.`);
    return { absolute, stat };
}

export async function readServerFile(path: unknown, deps: ServerFilesDeps): Promise<ServerFileContent> {
    const relative = assertPath(path, "file");
    const { absolute, stat } = await readRegularFile(await deps.serverDir(), relative);
    const name = nodePath.basename(absolute);
    if (stat.size > MAX_EDITABLE_BYTES) {
        return { kind: "unavailable", reason: `${name} is larger than 2 MB, too big to open here.` };
    }
    const bytes = await nodeFs.readFile(absolute);
    if (bytes.length > MAX_EDITABLE_BYTES) {
        return { kind: "unavailable", reason: `${name} is larger than 2 MB, too big to open here.` };
    }
    const mime = IMAGE_TYPES[nodePath.extname(name).slice(1).toLowerCase()];
    if (mime) return { kind: "image", src: `data:${mime};base64,${bytes.toString("base64")}`, alt: name };

    const shape = decodeText(bytes);
    if (!shape) return { kind: "unavailable", reason: `${name} is not UTF-8 text (it may be a binary file), so it cannot be opened here.` };
    return { kind: "text", text: shape.text, version: versionOf(bytes) };
}

export interface ServerFileSaved {
    version: string;
    message: string;
}

export async function writeServerFile(
    path: unknown,
    text: unknown,
    expectedVersion: unknown,
    serverRunning: boolean,
    deps: ServerFilesDeps,
): Promise<ServerFileSaved> {
    const relative = assertPath(path, "file");
    if (typeof text !== "string") throw new Error("The file's contents must be text.");
    if (typeof expectedVersion !== "string" || !/^[0-9a-f]{64}$/.test(expectedVersion)) {
        throw new Error("Open the file again before saving it.");
    }
    if (Buffer.byteLength(text, "utf8") > MAX_EDITABLE_BYTES) {
        throw new Error("The file would be larger than 2 MB, which is too big to save here.");
    }
    const root = await deps.serverDir();
    const { absolute } = await readRegularFile(root, relative);

    return serializedFileTask(absolute, async () => {
        // checked again inside the queue: the version must be the one on disk
        // right before the write, not before an earlier queued save
        const { stat } = await readRegularFile(root, relative);
        if (stat.size > MAX_EDITABLE_BYTES) throw new Error("The file on disk is larger than 2 MB.");
        const current = await nodeFs.readFile(absolute);
        if (versionOf(current) !== expectedVersion) {
            throw new Error("This file changed on disk since you opened it. Reload it to see the new version.");
        }
        const shape = decodeText(current);
        if (!shape) throw new Error("The file on disk is not text, so it cannot be saved from here.");
        const bytes = Buffer.from(encodeText(text, shape), "utf8");
        await writeFileAtomic(nodeFs, absolute, bytes, stat.mode);
        return {
            version: versionOf(bytes),
            message: serverRunning
                ? "Saved. The server is running: restart it, or reload the plugin, to apply the change."
                : "Saved. It applies the next time the server starts.",
        };
    });
}
