import { youTubeId } from "../src/lib/youtube";
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIMITS } from "../src/contract";
import { Attachments, cleanName, sniff } from "../src/service/attachments";
import { filesToolset } from "../src/service/attachmentTools";

const dirs: string[] = [];
const stores: Attachments[] = [];
afterEach(() => {
    for (const s of stores.splice(0)) s.closeUploads();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function store() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-files-"));
    dirs.push(dir);
    const s = new Attachments(() => dir);
    stores.push(s);
    return { s, dir };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

/** upload in chunks the way the UI does */
function upload(s: Attachments, name: string, data: Buffer, chunk = 4) {
    const { id } = s.begin(name, data.length);
    for (let o = 0; o < data.length; o += chunk) s.put(id, o, b64(data.subarray(o, o + chunk)));
    return s.finish(id);
}

describe("the conversation's files", () => {
    test("an upload arrives in order and is described from its bytes, not its name", () => {
        const { s } = store();
        const a = upload(s, "holiday.txt", PNG);
        expect(a).toMatchObject({ name: "holiday.txt", kind: "image", type: "image/png", bytes: PNG.length });
        expect(s.get(a.id)).toEqual(a);
        expect(Buffer.from(s.read(a.id, 0).data, "base64")).toEqual(PNG);
        expect(s.read(a.id, 0)).toMatchObject({ done: true, file: a });
    });

    test("chunks come once each, in order, within the declared size; a file is listed only when whole", () => {
        const { s, dir } = store();
        const { id } = s.begin("a.bin", 6);
        expect(() => s.put(id, 3, b64("abc"))).toThrow("expected the chunk at 0");
        s.put(id, 0, b64("abc"));
        expect(() => s.put(id, 0, b64("abc"))).toThrow("expected the chunk at 3");
        expect(() => s.put(id, 3, b64("defg"))).toThrow("more than the file's size");
        expect(() => s.finish(id)).toThrow("3 of its 6 bytes");
        expect(() => s.get(id)).toThrow("no file");
        s.cancel(id);
        expect(fs.readdirSync(path.join(dir, "attachments"))).toEqual([]);
        expect(() => s.put(id, 3, b64("def"))).toThrow("isn't under way");
    });

    test("bounded: a file's size, a chunk's size, uploads under way, and ids are checked", () => {
        const { s } = store();
        expect(() => s.begin("big.mp4", LIMITS.attachments.fileBytes + 1)).toThrow("limited to 25 MB");
        expect(() => s.begin("empty", 0)).toThrow("empty");
        const { id } = s.begin("x", LIMITS.attachments.chunkBytes + 1);
        expect(() => s.put(id, 0, b64(Buffer.alloc(LIMITS.attachments.chunkBytes + 1)))).toThrow("chunks are 1 to");
        for (let i = 1; i < LIMITS.attachments.uploading; i++) s.begin("x", 1);
        expect(() => s.begin("x", 1)).toThrow("a lot of files at once");
        s.closeUploads();
        expect(() => s.begin("x", 1)).not.toThrow();
        expect(() => s.get("../../etc/passwd")).toThrow("isn't a file's id");
        expect(() => s.read("0123456789ab", 0)).toThrow("no file");
    });

    test("what a file is comes from its first bytes", () => {
        const ascii = (t: string) => Buffer.from(t, "latin1");
        expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: "image", type: "image/jpeg" });
        expect(sniff(ascii("GIF89a..."))).toEqual({ kind: "image", type: "image/gif" });
        expect(sniff(ascii("RIFF\0\0\0\0WEBPVP8 "))).toEqual({ kind: "image", type: "image/webp" });
        expect(sniff(ascii("\0\0\0\x18ftypmp42"))).toEqual({ kind: "video", type: "video/mp4" });
        expect(sniff(ascii("\0\0\0\x14ftypqt  "))).toEqual({ kind: "video", type: "video/quicktime" });
        expect(sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toEqual({ kind: "video", type: "video/webm" });
        expect(sniff(ascii("%PDF-1.7"))).toEqual({ kind: "file", type: "application/pdf" });
        expect(sniff(Buffer.from("héllo, plain text"))).toEqual({ kind: "file", type: "text/plain" });
        expect(sniff(Buffer.from([0, 1, 2, 3]))).toEqual({ kind: "file", type: "application/octet-stream" });
    });

    test("a name loses its folders and control characters and stays short", () => {
        expect(cleanName("../../etc/passwd")).toBe("passwd");
        expect(cleanName("C:\\Users\\me\\cat.jpg")).toBe("cat.jpg");
        expect(cleanName("a\nb\u0007.txt")).toBe("ab.txt");
        expect(cleanName("..")).toBe("file");
        const long = cleanName("x".repeat(500) + ".jpeg");
        expect(long.length).toBe(LIMITS.attachments.nameChars);
        expect(long.endsWith("….jpeg")).toBe(true);
    });
});

describe("the agent's file tools", () => {
    function tools() {
        const { s } = store();
        const computer = new Map<string, Buffer>([["/home/agent/Downloads/clip.mp4", Buffer.from("\0\0\0\x18ftypmp42rest", "latin1")]]);
        const set = filesToolset({
            files: () => s,
            getFile: async (p) => {
                const full = p.replace(/^~/, "/home/agent");
                const data = computer.get(full);
                if (!data) throw new Error(`there's no file at ${full}`);
                return { path: full, data };
            },
            putFile: async (p, data) => {
                const full = p.replace(/^~/, "/home/agent");
                computer.set(full, data);
                return full;
            },
        });
        return { s, set, computer };
    }

    test("open_file shows an image as itself, with its type, and reads a text file out", async () => {
        const { s, set } = tools();
        const img = upload(s, "dot.png", PNG);
        const r = await set.call("open_file", { id: img.id });
        expect(r).toEqual({ text: "dot.png, image, 11 B", image: b64(PNG), imageType: "image/png" });
        const txt = upload(s, "notes.txt", Buffer.from("buy milk"));
        expect((await set.call("open_file", { id: txt.id })).text).toBe("notes.txt, text/plain, 8 B:\n\nbuy milk");
        expect(await set.call("open_file", { id: "0123456789ab" })).toEqual({ isError: true, text: "there's no file [0123456789ab] in this conversation" });
    });

    test("a file goes to the computer, and one comes back from it to be shown", async () => {
        const { s, set, computer } = tools();
        const img = upload(s, "dot.png", PNG);
        expect((await set.call("put_file_on_computer", { id: img.id })).text).toBe("It's at /home/agent/Downloads/dot.png");
        expect(computer.get("/home/agent/Downloads/dot.png")).toEqual(PNG);

        const shared = await set.call("share_file", { path: "~/Downloads/clip.mp4" });
        const id = /\[file ([a-f0-9]{12})\]/.exec(shared.text)![1]!;
        expect(shared.text).toContain(`![a caption](attachment:${id})`);
        expect(s.get(id)).toMatchObject({ name: "clip.mp4", kind: "video", type: "video/mp4" });
        expect((await set.call("share_file", { path: "~/nope" })).isError).toBe(true);
    });
});

describe("youTubeId", () => {
    test("finds the video in the usual links and nothing else", () => {
        const id = "dQw4w9WgXcQ";
        for (const link of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://m.youtube.com/shorts/${id}`, `https://youtube.com/embed/${id}?t=3`]) {
            expect(youTubeId(link)).toBe(id);
        }
        for (const link of [`http://www.youtube.com/watch?v=${id}`, `https://evil.example/watch?v=${id}`, "https://youtu.be/short", "not a url", `https://youtube.com.evil.example/watch?v=${id}`]) {
            expect(youTubeId(link)).toBeNull();
        }
    });
});
