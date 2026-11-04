// Fetch, verify and run the Paperboard server daemon (papercrane) for this
// computer. The daemon is the same signed binary Paperboard's own releases
// ship: this package carries no daemon code, only the way to get it.
//
//   1. read the signed crane index the desktop app's updater reads
//      (<registry>/paperdl/crane/index.json)
//   2. check the entry's release signature against the Paperboard release
//      key, with the daemon's own verifier (papercrane/releaseSignature.ts)
//   3. download the archive, check its sha256 against the signed one
//   4. unpack it into a per-version folder that outlives npx's cache (a
//      service installed from here keeps pointing at it), then run it
//
// Nothing runs that the release key did not sign: the signature covers the
// version and the archive's sha256, and the archive is hashed before it is
// unpacked.
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { RELEASE_PUBLIC_KEY, releaseMessage, verifyRelease } from "../../../apps/paperboard/papercrane/releaseSignature";
import { semverGt } from "../../../apps/paperboard/papercrane/util";

export const DEFAULT_REGISTRY = "https://origami.ariapis.com";
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const VERSION = /^[0-9][A-Za-z0-9._+-]{0,63}$/;

export interface CraneEntry {
    version: string;
    sha256: string;
    downloadUrl: string;
    signature: string;
}

export interface InstalledCrane {
    binary: string;
    version: string;
    downloaded: boolean;
}

// the release target names publish.ts uses (crane-<target>.tar.gz)
export function craneTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
    const os = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : null;
    if (!os || (arch !== "x64" && arch !== "arm64") || (os === "windows" && arch !== "x64")) {
        throw new Error(`The Paperboard server daemon has no build for ${platform} ${arch}. It runs on Linux and macOS (x64, arm64) and Windows (x64).`);
    }
    return `${os}-${arch}`;
}

// a data folder, not a cache: a service installed with this binary runs it
// from here, so clearing npx's cache must not take it away
export function defaultInstallRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
    if (platform === "win32") {
        const local = env.LOCALAPPDATA;
        if (!local) throw new Error("LOCALAPPDATA is not set, so there is nowhere to keep the daemon.");
        return path.join(local, "papercrane");
    }
    if (platform === "darwin") return path.join(home, "Library", "Application Support", "papercrane");
    return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "papercrane");
}

function isAllowedUrl(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch (err) {
        throw new Error(`The index lists a download that is not a URL (${raw}): ${(err as Error).message}`);
    }
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

function parseEntry(target: string, entry: unknown): CraneEntry {
    const e = entry as Partial<CraneEntry> | undefined;
    if (!e || typeof e !== "object") throw new Error(`The release index has no Paperboard server daemon for ${target}.`);
    if (typeof e.version !== "string" || !VERSION.test(e.version)) throw new Error(`The release index lists an invalid version for ${target}.`);
    if (typeof e.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(e.sha256)) throw new Error(`The release index has no valid sha256 for ${target}.`);
    if (typeof e.signature !== "string" || !e.signature) throw new Error(`The ${e.version} release for ${target} is not signed.`);
    if (typeof e.downloadUrl !== "string" || !isAllowedUrl(e.downloadUrl)) throw new Error(`The ${e.version} release for ${target} has a download URL that is not https.`);
    return { version: e.version, sha256: e.sha256.toLowerCase(), downloadUrl: e.downloadUrl, signature: e.signature };
}

export async function fetchCraneEntry(registry: string, target: string): Promise<CraneEntry> {
    const url = `${registry.replace(/\/+$/, "")}/paperdl/crane/index.json`;
    let response: Response;
    try {
        response = await fetch(url, { headers: { accept: "application/json" } });
    } catch (err) {
        throw new Error(`Could not reach ${url}: ${(err as Error).message}`);
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status} ${response.statusText}.`);
    const text = await response.text();
    if (text.length > MAX_INDEX_BYTES) throw new Error(`${url} is larger than a release index can be.`);
    let index: Record<string, unknown>;
    try {
        index = JSON.parse(text);
    } catch (err) {
        throw new Error(`${url} is not JSON: ${(err as Error).message}`);
    }
    return parseEntry(target, index?.[target]);
}

async function download(url: string, file: string, expectedSha256: string): Promise<void> {
    let response: Response;
    try {
        response = await fetch(url);
    } catch (err) {
        throw new Error(`Could not download ${url}: ${(err as Error).message}`);
    }
    if (!response.ok || !response.body) throw new Error(`Downloading ${url} answered ${response.status} ${response.statusText}.`);
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(file, { mode: 0o600 });
    let bytes = 0;
    try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            bytes += chunk.length;
            if (bytes > MAX_ARCHIVE_BYTES) throw new Error(`${url} is larger than a daemon release can be.`);
            hash.update(chunk);
            if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        }
    } finally {
        await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    }
    const actual = hash.digest("hex");
    if (actual !== expectedSha256) {
        throw new Error(`The download from ${url} does not match its signed checksum (expected ${expectedSha256}, got ${actual}). Nothing was installed.`);
    }
}

function binaryName(target: string): string {
    return target.startsWith("windows") ? "papercrane.exe" : "papercrane";
}

// Unpacks a verified archive. The bytes are signed, so this is about a
// clean layout, not hostile input: only plain files and folders, nothing
// outside the folder.
async function unpack(archive: string, target: string, into: string): Promise<string> {
    const shipped = target.startsWith("windows") ? `papercrane-${target}.exe` : `papercrane-${target}`;
    if (target.startsWith("windows")) {
        const zip = new AdmZip(archive);
        const root = path.resolve(into) + path.sep;
        for (const entry of zip.getEntries()) {
            const dest = path.resolve(into, entry.entryName);
            if (!dest.startsWith(root)) throw new Error(`The archive has an entry outside its folder: ${entry.entryName}`);
        }
        zip.extractAllTo(into, true);
    } else {
        await tar.x({
            file: archive,
            cwd: into,
            strict: true,
            filter: (_p, entry) => {
                const type = (entry as { type?: string }).type;
                return type === "File" || type === "Directory";
            },
        });
    }
    const binary = path.join(into, shipped);
    if (!fs.existsSync(binary) || !fs.lstatSync(binary).isFile()) {
        throw new Error(`The release archive does not contain ${shipped}.`);
    }
    const named = path.join(into, binaryName(target));
    fs.renameSync(binary, named);
    if (!target.startsWith("windows")) fs.chmodSync(named, 0o755);
    return named;
}

interface ReleaseRecord {
    version: string;
    sha256: string;
}

function readRecord(dir: string): ReleaseRecord | null {
    const file = path.join(dir, "release.json");
    if (!fs.existsSync(file)) return null;
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof record?.version !== "string" || typeof record?.sha256 !== "string") {
        throw new Error(`${file} is damaged. Delete ${dir} and run this again.`);
    }
    return record;
}

export interface EnsureOptions {
    registry?: string;
    target?: string;
    installRoot?: string;
    // the oldest daemon this launcher can drive (its own version)
    minVersion: string;
    // tests sign their own releases; the published launcher never sets this
    publicKey?: string;
    log?: (line: string) => void;
}

export async function ensureCrane(options: EnsureOptions): Promise<InstalledCrane> {
    const target = options.target ?? craneTarget();
    const root = options.installRoot ?? defaultInstallRoot();
    const log = options.log ?? (() => {});
    const entry = await fetchCraneEntry(options.registry ?? DEFAULT_REGISTRY, target);
    if (semverGt(options.minVersion, entry.version)) {
        throw new Error(`The newest published Paperboard server daemon is ${entry.version}, but this launcher needs ${options.minVersion} or newer. Try again once Paperboard ${options.minVersion} is released.`);
    }
    // the trust anchor: a release signature over (version, sha256) by the
    // Paperboard release key, checked before a byte is downloaded
    if (!verifyRelease(releaseMessage.crane(entry.version, entry.sha256), entry.signature, options.publicKey ?? RELEASE_PUBLIC_KEY)) {
        throw new Error(`The ${entry.version} release for ${target} is not signed by the Paperboard release key. Nothing was downloaded.`);
    }

    const dir = path.join(root, entry.version);
    const binary = path.join(dir, binaryName(target));
    const record = readRecord(dir);
    if (record) {
        if (record.sha256 !== entry.sha256) {
            throw new Error(`${dir} holds a different ${entry.version} build than the signed release (sha256 ${record.sha256}, signed ${entry.sha256}). Delete it and run this again.`);
        }
        if (!fs.existsSync(binary)) throw new Error(`${binary} is missing. Delete ${dir} and run this again.`);
        return { binary, version: entry.version, downloaded: false };
    }
    if (fs.existsSync(dir)) throw new Error(`${dir} exists but is not a finished install. Delete it and run this again.`);

    fs.mkdirSync(root, { recursive: true });
    const staging = fs.mkdtempSync(path.join(root, `.${entry.version}-`));
    try {
        const archive = path.join(staging, path.basename(new URL(entry.downloadUrl).pathname) || "release");
        log(`Downloading the Paperboard server daemon ${entry.version} for ${target}...`);
        await download(entry.downloadUrl, archive, entry.sha256);
        const contents = path.join(staging, "contents");
        fs.mkdirSync(contents);
        await unpack(archive, target, contents);
        fs.writeFileSync(path.join(contents, "release.json"), JSON.stringify({ version: entry.version, sha256: entry.sha256 }, null, 2));
        fs.renameSync(contents, dir);
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
    log(`Installed it in ${dir}.`);
    return { binary, version: entry.version, downloaded: true };
}

// Runs the daemon in this terminal and exits with its code. Ctrl+C reaches
// it through the terminal's process group, so the launcher only ignores it;
// a SIGTERM or SIGHUP sent to the launcher alone is passed on.
export function runCrane(binary: string, args: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: "inherit" });
        const forward = (signal: NodeJS.Signals) => () => { child.kill(signal); };
        const onTerm = forward("SIGTERM");
        const onHup = forward("SIGHUP");
        const onInt = () => { /* the child got the same Ctrl+C */ };
        process.on("SIGTERM", onTerm);
        process.on("SIGHUP", onHup);
        process.on("SIGINT", onInt);
        const done = () => {
            process.off("SIGTERM", onTerm);
            process.off("SIGHUP", onHup);
            process.off("SIGINT", onInt);
        };
        child.once("error", (err) => {
            done();
            reject(new Error(`Could not start ${binary}: ${err.message}`));
        });
        child.once("exit", (code, signal) => {
            done();
            resolve(code ?? 128 + (signal ? os.constants.signals[signal] ?? 0 : 0));
        });
    });
}
