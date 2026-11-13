import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "../src/contract";
import { Attachments, cleanName, sniff } from "../src/service/attachments";
import { messagesToolset } from "../src/service/messages";
import { tempDir } from "./support/host";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup() {
    const root = tempDir("uploads");
    dirs.push(root);
    return { root, files: new Attachments(() => root), stored: () => (fs.existsSync(path.join(root, "attachments")) ? fs.readdirSync(path.join(root, "attachments")).sort() : []) };
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

// Uploads are bounded and safe.
describe("uploads", () => {
    test("chunks arrive in order, once, within the declared size; a file is listed only when complete", () => {
        const { files, stored } = setup();
        const { id } = files.begin("notes.txt", 10);
        expect(() => files.put(id, 5, b64("world"))).toThrow("expected the chunk at 0");
        expect(files.put(id, 0, b64("hello"))).toEqual({ written: 5 });
        // the same chunk again is out of order now
        expect(() => files.put(id, 0, b64("hello"))).toThrow("expected the chunk at 5");
        expect(() => files.put(id, 5, b64("world!"))).toThrow("that's more than the file's size");
        expect(() => files.finish(id)).toThrow("the file has 5 of its 10 bytes");
        expect(() => files.get(id)).toThrow(/no file/);
        expect(stored()).toEqual([`${id}.part`]);
        files.put(id, 5, b64("world"));
        expect(files.finish(id)).toEqual({ id, name: "notes.txt", kind: "file", type: "text/plain", bytes: 10 });
        expect(files.bytes(id).toString()).toBe("helloworld");
        expect(stored()).toEqual([id, `${id}.json`]);
        expect(() => files.put(id, 10, b64("x"))).toThrow("that upload isn't under way");
    });

    test("a cancelled upload leaves nothing behind", () => {
        const { files, stored } = setup();
        const { id } = files.begin("big.bin", 100);
        files.put(id, 0, b64("partial"));
        expect(files.cancel(id)).toEqual({ canceled: true });
        expect(stored()).toEqual([]);
        expect(() => files.get(id)).toThrow(/no file/);
    });

    test("size is capped at 25 MB and ids are checked before any path is made", () => {
        const { root, files } = setup();
        expect(LIMITS.attachments.fileBytes).toBe(25 * 1024 * 1024);
        expect(() => files.begin("huge.bin", LIMITS.attachments.fileBytes + 1)).toThrow("files are limited to 25 MB");
        expect(() => files.begin("empty", 0)).toThrow("that file is empty");
        fs.writeFileSync(path.join(root, "secret.json"), JSON.stringify({ id: "x", name: "x", kind: "file", type: "text/plain", bytes: 1 }));
        for (const id of ["../secret", "../../etc/passwd", "..\\..\\secret"]) {
            expect(() => files.get(id)).toThrow("that isn't a file's id");
            expect(() => files.read(id, 0)).toThrow("that isn't a file's id");
            expect(() => files.put(id, 0, b64("x"))).toThrow("that upload isn't under way");
        }
    });

    test("what a file is comes from its bytes, never its name", () => {
        const { files } = setup();
        const kinds: [string, Buffer, string][] = [
            ["innocent.txt", Buffer.from("89504e470d0a1a0a00", "hex"), "image/png"],
            ["photo.png", Buffer.from("%PDF-1.7 ..."), "application/pdf"],
            ["page.html", Buffer.from([0x00, 0x01, 0x02, 0xff]), "application/octet-stream"],
            ["clip.jpg", Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42")]), "video/mp4"],
        ];
        for (const [name, data, type] of kinds) {
            const { id } = files.begin(name, data.length);
            files.put(id, 0, data.toString("base64"));
            expect(files.finish(id).type).toBe(type);
        }
    });

    test("names lose their folders and control characters", () => {
        expect(cleanName("../../etc/passwd")).toBe("passwd");
        expect(cleanName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
        expect(cleanName("in\u0000voice\u001b[31m\n.pdf")).toBe("invoice[31m.pdf");
        expect(cleanName("..")).toBe("file");
        expect(cleanName("")).toBe("file");
        expect(cleanName(`${"a".repeat(300)}.txt`)).toHaveLength(LIMITS.attachments.nameChars);
        const { files } = setup();
        const { id } = files.begin("../../../evil\u0007.txt", 2);
        files.put(id, 0, b64("hi"));
        expect(files.finish(id).name).toBe("evil.txt");
    });
});

// What a file is comes from its bytes, never its name: it decides how the chat plays it.
describe("what a file is", () => {
    const head = (...parts: (string | number[])[]) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

    test("recordings are audio, an MP4 with only sound included; a film stays video", () => {
        expect(sniff(head("RIFF", [0x24, 0, 0, 0], "WAVEfmt "))).toEqual({ kind: "audio", type: "audio/wav" });
        expect(sniff(head("ID3", [4, 0, 0, 0, 0, 0, 0]))).toEqual({ kind: "audio", type: "audio/mpeg" });
        expect(sniff(head([0xff, 0xfb, 0x90, 0x64]))).toEqual({ kind: "audio", type: "audio/mpeg" });
        expect(sniff(head("OggS", [0, 2]))).toEqual({ kind: "audio", type: "audio/ogg" });
        expect(sniff(head("fLaC", [0, 0, 0, 0x22]))).toEqual({ kind: "audio", type: "audio/flac" });
        expect(sniff(head([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 0, 0]))).toEqual({ kind: "audio", type: "audio/mp4" });
        expect(sniff(head([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0]))).toEqual({ kind: "video", type: "video/mp4" });
        // a WebP is RIFF too, and still a picture
        expect(sniff(head("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "))).toEqual({ kind: "image", type: "image/webp" });
    });
});

// The agent sends files as messages, in a chat as well as to a flow.
describe("the agent's files in a message", () => {
    const texter = () => {
        const said: { text: string; files?: string[] }[] = [];
        return { said, tools: messagesToolset({ say: (text, _replyTo, files) => (said.push({ text, files }), { id: "m1" }) }) };
    };

    test("send_message carries file ids in a chat, and refuses a list that isn't one", async () => {
        const { said, tools } = texter();
        expect(tools.tools({ fromFlow: false }).find((t) => t.name === "send_message")?.inputSchema.properties).toHaveProperty("files");
        expect((await tools.call("send_message", { text: "", files: ["0123456789ab"] }, { fromFlow: false })).isError).toBeFalsy();
        expect(said).toEqual([{ text: "", files: ["0123456789ab"] }]);
        expect((await tools.call("send_message", { text: "hi", files: "0123456789ab" }, { fromFlow: false })).isError).toBe(true);
        expect(said).toHaveLength(1);
    });
});
