// The conversation's files: the ones the user attaches and the ones the
// agent shares from its computer. They live in the conversation's folder
// (attachments/<id>, with <id>.json beside it), so they move with it into
// the history and back, and starting over forgets them with it.
//
// The user's files arrive in chunks over the UI's actions (a message can't
// carry 25 MB): begin with the name and size, put the chunks in order, then
// finish, which checks the size and reads what the file is from its bytes.
// Everything is bounded: one file's size, the uploads under way (an upload
// left alone is dropped), and the conversation's files, by count and bytes.

import { isUtf8 } from "node:buffer";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ATTACHMENT_ID, LIMITS, type Attachment } from "../contract";

const DIR = "attachments";
const L = LIMITS.attachments;

interface Upload {
    name: string;
    bytes: number;
    written: number;
    idle: ReturnType<typeof setTimeout>;
}

/** What a file is, from its first bytes; a name says nothing reliable. */
export function sniff(head: Buffer): Pick<Attachment, "kind" | "type"> {
    const at = (i: number, sig: number[]) => sig.every((b, j) => head[i + j] === b);
    const ascii = (i: number, text: string) => head.subarray(i, i + text.length).toString("latin1") === text;
    if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", type: "image/png" };
    if (at(0, [0xff, 0xd8, 0xff])) return { kind: "image", type: "image/jpeg" };
    if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return { kind: "image", type: "image/gif" };
    if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { kind: "image", type: "image/webp" };
    if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", type: "video/webm" };
    if (ascii(4, "ftyp")) return { kind: "video", type: ascii(8, "qt  ") ? "video/quicktime" : "video/mp4" };
    if (ascii(0, "%PDF-")) return { kind: "file", type: "application/pdf" };
    // text: valid UTF-8 with no NULs, as far as the head goes (a cut multi-byte character at its end is fine)
    if (head.length && !head.includes(0) && isUtf8(head.subarray(0, Math.max(0, head.length - 3)))) return { kind: "file", type: "text/plain" };
    return { kind: "file", type: "application/octet-stream" };
}

/** A name to show and save under: no folders, no control characters, not too long, never empty. */
export function cleanName(raw: unknown): string {
    const base = String(raw ?? "")
        .split(/[\\/]/)
        .pop()!
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim();
    const name = base === "." || base === ".." ? "" : base;
    if (name.length <= L.nameChars) return name || "file";
    const ext = path.extname(name).slice(0, 16);
    return name.slice(0, L.nameChars - ext.length - 1) + "…" + ext;
}

export class Attachments {
    private uploads = new Map<string, Upload>();

    /** `root`: the current conversation's folder */
    constructor(private root: () => string) {}

    private dir() {
        return path.join(this.root(), DIR);
    }

    private file(id: unknown, suffix = ""): string {
        if (typeof id !== "string" || !ATTACHMENT_ID.test(id)) throw new Error("that isn't a file's id");
        return path.join(this.dir(), id + suffix);
    }

    private newId(): string {
        for (;;) {
            const id = randomBytes(6).toString("hex");
            if (!this.uploads.has(id) && !fs.existsSync(this.file(id, ".json"))) return id;
        }
    }

    /** The conversation's files as stored: count and bytes, uploads under way included. */
    private usage() {
        let files = this.uploads.size;
        let bytes = [...this.uploads.values()].reduce((n, u) => n + u.bytes, 0);
        if (fs.existsSync(this.dir())) {
            for (const name of fs.readdirSync(this.dir())) {
                if (!name.endsWith(".json")) continue;
                files++;
                bytes += this.get(name.slice(0, -5)).bytes;
            }
        }
        return { files, bytes };
    }

    private room(bytes: number) {
        if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("that file is empty");
        if (bytes > L.fileBytes) throw new Error(`files are limited to ${L.fileBytes / 1024 / 1024} MB`);
        const used = this.usage();
        if (used.files >= L.conversationFiles || used.bytes + bytes > L.conversationBytes) {
            throw new Error("this conversation has as many files as it can hold; start a new one to send more");
        }
    }

    // ------------------------------------------------------------- the user's uploads

    begin(name: unknown, bytes: unknown): { id: string } {
        if (this.uploads.size >= L.uploading) throw new Error("that's a lot of files at once; wait for these to finish");
        this.room(Number(bytes));
        fs.mkdirSync(this.dir(), { recursive: true });
        const id = this.newId();
        fs.writeFileSync(this.file(id, ".part"), "");
        this.uploads.set(id, { name: cleanName(name), bytes: Number(bytes), written: 0, idle: this.idleTimer(id) });
        return { id };
    }

    /** The next chunk, at the offset the upload has reached: chunks come in order, once each. */
    put(id: unknown, offset: unknown, data: unknown): { written: number } {
        const u = this.upload(id);
        if (offset !== u.written) throw new Error(`expected the chunk at ${u.written}`);
        if (typeof data !== "string") throw new Error("a chunk is base64 text");
        const chunk = Buffer.from(data, "base64");
        if (chunk.length === 0 || chunk.length > L.chunkBytes) throw new Error(`chunks are 1 to ${L.chunkBytes} bytes`);
        if (u.written + chunk.length > u.bytes) throw new Error("that's more than the file's size");
        fs.appendFileSync(this.file(id, ".part"), chunk);
        u.written += chunk.length;
        clearTimeout(u.idle);
        u.idle = this.idleTimer(id as string);
        return { written: u.written };
    }

    finish(id: unknown): Attachment {
        const u = this.upload(id);
        if (u.written !== u.bytes) throw new Error(`the file has ${u.written} of its ${u.bytes} bytes`);
        this.drop(id as string, false);
        const part = this.file(id, ".part");
        return this.keep(id as string, u.name, () => fs.renameSync(part, this.file(id)), readHead(part));
    }

    cancel(id: unknown): { canceled: true } {
        this.upload(id);
        this.drop(id as string, true);
        return { canceled: true };
    }

    // ------------------------------------------------------------- everyone's files

    /** A file from somewhere else (the agent's computer), kept as it is. */
    add(name: string, data: Buffer): Attachment {
        this.room(data.length);
        fs.mkdirSync(this.dir(), { recursive: true });
        const id = this.newId();
        return this.keep(id, cleanName(name), () => fs.writeFileSync(this.file(id), data), data.subarray(0, 64));
    }

    get(id: unknown): Attachment {
        const meta = this.file(id, ".json");
        if (!fs.existsSync(meta)) throw new Error(`there's no file [${id}] in this conversation`);
        return JSON.parse(fs.readFileSync(meta, "utf8")) as Attachment;
    }

    /** One chunk of a file, base64, from an offset; `done` when it reaches the end. It says what the file is, too. */
    read(id: unknown, offset: unknown): { data: string; done: boolean; file: Attachment } {
        const a = this.get(id);
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > a.bytes) throw new Error("that's not a place in the file");
        const fd = fs.openSync(this.file(id), "r");
        try {
            const buf = Buffer.alloc(Math.min(L.chunkBytes, a.bytes - offset));
            const n = fs.readSync(fd, buf, 0, buf.length, offset);
            return { data: buf.subarray(0, n).toString("base64"), done: offset + n >= a.bytes, file: a };
        } finally {
            fs.closeSync(fd);
        }
    }

    /** The whole file, for the agent's tools; bounded by the file size limit. */
    bytes(id: unknown): Buffer {
        this.get(id);
        return fs.readFileSync(this.file(id));
    }

    /** Uploads under way end with the conversation they were for. */
    closeUploads() {
        for (const id of [...this.uploads.keys()]) this.drop(id, true);
    }

    // ------------------------------------------------------------- inside

    private upload(id: unknown): Upload {
        const u = typeof id === "string" ? this.uploads.get(id) : undefined;
        if (!u) throw new Error("that upload isn't under way");
        return u;
    }

    private idleTimer(id: string) {
        const t = setTimeout(() => this.drop(id, true), L.uploadIdleMinutes * 60_000);
        t.unref?.();
        return t;
    }

    private drop(id: string, removePart: boolean) {
        const u = this.uploads.get(id);
        if (!u) return;
        clearTimeout(u.idle);
        this.uploads.delete(id);
        if (removePart) fs.rmSync(this.file(id, ".part"), { force: true });
    }

    /** The bytes go in first and the description last: a file is listed only once it's whole. */
    private keep(id: string, name: string, write: () => void, head: Buffer): Attachment {
        const a: Attachment = { id, name, ...sniff(head), bytes: 0 };
        write();
        a.bytes = fs.statSync(this.file(id)).size;
        fs.writeFileSync(this.file(id, ".json"), JSON.stringify(a));
        return a;
    }
}

function readHead(file: string): Buffer {
    const fd = fs.openSync(file, "r");
    try {
        const buf = Buffer.alloc(64);
        return buf.subarray(0, fs.readSync(fd, buf, 0, 64, 0));
    } finally {
        fs.closeSync(fd);
    }
}

/** "1.2 MB", for the agent's view of a file. */
export const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
