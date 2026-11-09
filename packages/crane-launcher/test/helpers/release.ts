// A signed crane release served by a real HTTP registry on loopback: the
// index at /paperdl/crane/index.json and the archive beside it, with every
// request path recorded so a test can tell whether anything was downloaded.
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { releaseMessage } from "../../../../apps/paperboard/papercrane/releaseSignature";

export interface TestKey {
    publicKey: string;
    sign(version: string, sha256: string): string;
}

export function makeKey(): TestKey {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    return {
        publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
        sign: (version, sha256) => Buffer.from(crypto.sign(null, releaseMessage.crane(version, sha256), privateKey)).toString("base64"),
    };
}

export function tempDir(label: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `crane-launcher-${label}-`));
}

// Packs `files` (relative path -> source file) the way publish.ts ships a
// target: a zip for Windows, a gzipped tar everywhere else.
export async function packRelease(target: string, files: Record<string, string>, into: string): Promise<string> {
    if (target.startsWith("windows")) {
        const zip = new AdmZip();
        for (const [rel, src] of Object.entries(files)) {
            zip.addFile(rel.split(path.sep).join("/"), fs.readFileSync(src));
        }
        const out = path.join(into, `crane-${target}.zip`);
        zip.writeZip(out);
        return out;
    }
    const stage = fs.mkdtempSync(path.join(into, "stage-"));
    for (const [rel, src] of Object.entries(files)) {
        const dest = path.join(stage, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
    const out = path.join(into, `crane-${target}.tar.gz`);
    await tar.c({ gzip: true, file: out, cwd: stage, portable: true }, Object.keys(files));
    return out;
}

export function sha256(file: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export interface Registry {
    url: string;
    requests: string[];
    archiveUrl: string;
    setIndex(index: Record<string, unknown>): void;
    // the bytes served at archiveUrl
    setArchive(file: string): void;
    close(): Promise<void>;
}

export async function startRegistry(): Promise<Registry> {
    let index: Record<string, unknown> = {};
    let archive: Buffer | null = null;
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
        const url = req.url ?? "";
        requests.push(url);
        if (url === "/paperdl/crane/index.json") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(index));
            return;
        }
        if (url === "/dl/crane/archive" && archive) {
            res.writeHead(200, { "content-type": "application/octet-stream", "content-length": archive.length });
            res.end(archive);
            return;
        }
        res.writeHead(404);
        res.end(`no ${url}`);
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;
    return {
        url,
        requests,
        archiveUrl: `${url}/dl/crane/archive`,
        setIndex: (next) => {
            index = next;
        },
        setArchive: (file) => {
            archive = fs.readFileSync(file);
        },
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((err) => (err ? reject(err) : resolve()));
            }),
    };
}
