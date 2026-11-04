// fileApi.download checks the checksum it is given, or refuses it (bun test).
// A checksum naming any algorithm but sha1 or sha256 used to be ignored, so
// a panel that passed { algorithm: "md5" } or "sha512" installed bytes
// nothing verified. This downloads through the SDK and a real daemon.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startPaperCraneServer } from "../papercrane/index";
import { closeTransport, initPaperApi } from "../../../packages/paperapi/src/ipc";
import { fileApi } from "../../../packages/paperapi/src/file";

const PANEL = "dev.test.checksum";
const BYTES = Buffer.from("the file the panel asked for\n");
let root = "";
let savedDir: string | undefined;
let daemon: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let requests = 0;

beforeAll(async () => {
    savedDir = process.env.PAPERBOARD_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-download-checksum-"));
    process.env.PAPERBOARD_DIR = root;
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { requests++; return new Response(BYTES); } });
    daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    await initPaperApi();
});

afterAll(async () => {
    try {
        closeTransport("local");
        daemon?.stop();
        await server?.stop(true);
    } finally {
        if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
        else process.env.PAPERBOARD_DIR = savedDir;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

const url = () => `http://127.0.0.1:${server!.port}/file`;
const sha512 = (data: Buffer) => new Bun.CryptoHasher("sha512").update(data).digest("hex");

test("an unsupported algorithm is refused before anything is fetched", async () => {
    const before = requests;
    await expect(
        fileApi.download({ url: url(), targetPath: "md5.txt", appId: PANEL, checksum: { algorithm: "md5", value: "0".repeat(32) } }),
    ).rejects.toThrow('Download refused: checksum algorithm "md5" is not supported (use sha1, sha256, sha512)');
    expect(requests).toBe(before);
});

test("a sha512 that does not match fails the download", async () => {
    await expect(
        fileApi.download({ url: url(), targetPath: "bad.txt", appId: PANEL, checksum: { algorithm: "sha512", value: sha512(Buffer.from("other")) } }),
    ).rejects.toThrow("SHA512 mismatch");
});

test("a sha512 that matches lands the file", async () => {
    const dest = await fileApi.download({ url: url(), targetPath: "good.txt", appId: PANEL, checksum: { algorithm: "sha512", value: sha512(BYTES) } });
    expect(fs.readFileSync(dest).equals(BYTES)).toBe(true);
});
