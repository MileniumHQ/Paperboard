// Files over calls: sent and read back in pieces, and the blob URLs a page
// keeps of what it read.
import { describe, expect, test } from "bun:test";
import { createBlobUrlCache, readInPieces, sendInPieces, type PieceUpload } from "../src/pieces";

/** A service's side of uploads and reads, kept in memory: what a contract's calls would reach. */
function fakeService(pieceBytes: number) {
    const files = new Map<string, Uint8Array>();
    const log: string[] = [];
    let failPutAt = -1;
    const begin = (name: string) => async (): Promise<PieceUpload<string>> => {
        const parts: Uint8Array[] = [];
        let at = 0;
        log.push(`begin ${name}`);
        return {
            put: async (offset, data) => {
                if (offset !== at) throw new Error(`a piece at ${offset}, expected ${at}`);
                if (offset === failPutAt) throw new Error("the disk is full");
                const bytes = Buffer.from(data, "base64");
                parts.push(bytes);
                at += bytes.length;
            },
            finish: async () => {
                files.set(name, Buffer.concat(parts));
                log.push(`finish ${name}`);
                return name;
            },
            cancel: async () => void log.push(`cancel ${name}`),
        };
    };
    const piece = (name: string) => async (offset: number) => {
        const file = files.get(name)!;
        return { data: Buffer.from(file.subarray(offset, offset + pieceBytes)).toString("base64"), size: file.length };
    };
    return { files, log, begin, piece, failAt: (offset: number) => (failPutAt = offset) };
}

const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256);

describe("sendInPieces and readInPieces", () => {
    test("a file goes up in pieces and comes back the same bytes, with progress each piece", async () => {
        const service = fakeService(1000);
        const sent: number[] = [];
        const original = bytesOf(2500);
        expect(await sendInPieces(new Blob([original]), { pieceBytes: 1000, begin: service.begin("a.bin"), onProgress: (n) => sent.push(n) })).toBe("a.bin");
        expect(sent).toEqual([1000, 2000, 2500]);
        const read: number[] = [];
        const blob = await readInPieces({ piece: service.piece("a.bin"), type: "image/png", onProgress: (n) => read.push(n) });
        expect(blob.type).toBe("image/png");
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(original);
        expect(read).toEqual([1000, 2000, 2500]);
    });

    test("an empty file sends no pieces and reads back empty", async () => {
        const service = fakeService(1000);
        await sendInPieces(new Blob([]), { pieceBytes: 1000, begin: service.begin("empty") });
        expect((await readInPieces({ piece: service.piece("empty") })).size).toBe(0);
    });

    test("a piece that fails, or an abort, cancels the upload on the service and rejects with why", async () => {
        const service = fakeService(1000);
        service.failAt(1000);
        await expect(sendInPieces(new Blob([bytesOf(2500)]), { pieceBytes: 1000, begin: service.begin("full") })).rejects.toThrow("the disk is full");
        const stop = new AbortController();
        const upload = sendInPieces(new Blob([bytesOf(2500)]), { pieceBytes: 1000, begin: service.begin("stopped"), signal: stop.signal, onProgress: () => stop.abort() });
        await expect(upload).rejects.toThrow();
        expect(service.log).toEqual(["begin full", "cancel full", "begin stopped", "cancel stopped"]);
        expect(service.files.size).toBe(0);
    });

    test("a file that ends before its size, or runs past it, is an error, never a short Blob", async () => {
        await expect(readInPieces({ name: "cut.bin", piece: async (offset) => ({ data: offset === 0 ? btoa("abc") : "", size: 10 }) })).rejects.toThrow(
            "“cut.bin” ended before its size.",
        );
        await expect(readInPieces({ piece: async () => ({ data: btoa("abcdef"), size: 4 }) })).rejects.toThrow("longer than its size");
    });
});

describe("createBlobUrlCache", () => {
    const blob = (n: number) => new Blob([new Uint8Array(n)]);

    test("a key is made once and shared, and the oldest goes once there are too many", async () => {
        const cache = createBlobUrlCache({ files: 2, bytes: 1e9 });
        let made = 0;
        const make = async () => (made++, blob(10));
        const a = await cache.get("a", make);
        expect(await cache.get("a", make)).toBe(a);
        expect(made).toBe(1);
        await cache.get("b", make);
        // a was used last, so b is the oldest when c arrives
        await cache.get("a", make);
        await cache.get("c", make);
        await cache.get("b", make);
        expect(made).toBe(4);
        expect(await cache.get("a", make)).not.toBe(a);
    });

    test("a held URL stays however full the cache is, and goes once released", async () => {
        const cache = createBlobUrlCache({ files: 1, bytes: 1e9 });
        let made = 0;
        const make = async () => (made++, blob(10));
        const release = cache.hold("film");
        const film = await cache.get("film", make);
        await cache.get("other", make);
        expect(await cache.get("film", make)).toBe(film);
        release();
        release();
        await cache.get("third", make);
        expect(await cache.get("film", make)).not.toBe(film);
        expect(made).toBe(4);
    });

    test("bytes count each URL at its Blob's size once made", async () => {
        const cache = createBlobUrlCache({ files: 10, bytes: 100 });
        let made = 0;
        // a guess of 0 is corrected to 80 once read, so the next 80 pushes it out
        const first = await cache.get("big", async () => (made++, blob(80)));
        await cache.get("next", async () => (made++, blob(80)));
        expect(await cache.get("big", async () => (made++, blob(80)))).not.toBe(first);
        expect(made).toBe(3);
    });

    test("nothing is let go while it's being made, so every caller gets a live URL", async () => {
        const revoked = new Set<string>();
        const revoke = URL.revokeObjectURL;
        URL.revokeObjectURL = (url) => void revoked.add(url);
        try {
            const cache = createBlobUrlCache({ files: 1, bytes: 1e9 });
            let finish!: () => void;
            const slow = cache.get("slow", () => new Promise<Blob>((r) => (finish = () => r(blob(10)))));
            // two more arrive and are made while the first is still on its way
            const fast = await cache.get("fast", async () => blob(10));
            await cache.get("faster", async () => blob(10));
            finish();
            const url = await slow;
            expect(revoked.has(url)).toBe(false);
            expect(revoked.has(fast)).toBe(true);
        } finally {
            URL.revokeObjectURL = revoke;
        }
    });

    test("a make that fails isn't kept: the next ask tries again", async () => {
        const cache = createBlobUrlCache({ files: 10, bytes: 1e9 });
        await expect(cache.get("x", async () => Promise.reject(new Error("unreadable")))).rejects.toThrow("unreadable");
        expect((await cache.get("x", async () => blob(1))).startsWith("blob:")).toBe(true);
    });
});
