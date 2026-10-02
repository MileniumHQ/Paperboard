// A loopback registry for install tests: serves /panel/<id>.json records and
// /panel/<id>/download archives the way Origami does, so the daemon's own
// registry lookup runs for real. Tests set records with publish().
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as tar from "tar";
import { releaseMessage } from "../papercrane/releaseSignature";

// a throwaway release key standing in for the offline Paperboard key:
// engines under test are constructed with FIXTURE_RELEASE_PUBLIC_KEY
const fixtureKeys = crypto.generateKeyPairSync("ed25519");
export const FIXTURE_RELEASE_PUBLIC_KEY = fixtureKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
export function fixtureSign(msg: Buffer): string {
    return crypto.sign(null, msg, fixtureKeys.privateKey).toString("base64");
}

export interface FixtureRelease {
    record: Record<string, unknown>;
    archive: Uint8Array;
}

export interface FixtureRegistry {
    url: string;
    releases: Map<string, FixtureRelease>;
    /** packs `files` (relative path → contents) and lists it as the panel's release */
    publish(id: string, version: string, files: Record<string, string>, recordOverrides?: Record<string, unknown>): Promise<FixtureRelease>;
    stop(): Promise<void>;
}

export async function startFixtureRegistry(workDir: string): Promise<FixtureRegistry> {
    const releases = new Map<string, FixtureRelease>();
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
            const { pathname } = new URL(request.url);
            const download = /^\/panel\/([^/]+)\/download$/.exec(pathname);
            if (download) {
                const release = releases.get(decodeURIComponent(download[1]));
                return release ? new Response(release.archive) : new Response("not found", { status: 404 });
            }
            const record = /^\/panel\/([^/]+?)(?:\.json)?$/.exec(pathname);
            if (record) {
                const release = releases.get(decodeURIComponent(record[1]));
                return release ? Response.json(release.record) : Response.json({ error: "Panel not found" }, { status: 404 });
            }
            return new Response("not found", { status: 404 });
        },
    });
    const url = `http://127.0.0.1:${server.port}`;
    let n = 0;
    return {
        url,
        releases,
        async publish(id, version, files, recordOverrides = {}) {
            const source = path.join(workDir, `release-src-${++n}`);
            fs.rmSync(source, { recursive: true, force: true });
            for (const [rel, contents] of Object.entries(files)) {
                fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
                fs.writeFileSync(path.join(source, rel), contents);
            }
            const archivePath = path.join(workDir, `release-${n}.tar.gz`);
            await tar.c({ file: archivePath, cwd: source, gzip: true }, fs.readdirSync(source));
            const archive = new Uint8Array(fs.readFileSync(archivePath));
            const sha256 = crypto.createHash("sha256").update(archive).digest("hex");
            const release = {
                record: {
                    id,
                    name: id,
                    version,
                    sha256,
                    signature: fixtureSign(releaseMessage.panel(id, version, sha256)),
                    downloadUrl: `${url}/panel/${id}/download`,
                    ...recordOverrides,
                },
                archive,
            };
            releases.set(id, release);
            return release;
        },
        async stop() {
            await server.stop(true);
        },
    };
}

export function manifestFile(id: string, version: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ id, name: id, version, ...extra });
}
