// Sources and packaged harness adjustments for Report an Issue. Kept free of
// Electron imports so it is tested directly against local HTTP servers and
// temporary archives without launching Electron.
import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import { StoppedError, type FetchedSource, type Harness } from "trissue-embedded";

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;

export interface ReleaseFetchOptions {
    /** Cancels the download and cleans up the partial temp folder. */
    signal?: AbortSignal;
    /** Origin serving `/{repo}/archive/refs/tags/{tag}.tar.gz` (defaults to https://github.com). */
    baseUrl?: string;
    /** Byte limit for the downloaded tarball (defaults to 200 MB). */
    maxBytes?: number;
}

/**
 * Downloads a GitHub release tag as a tarball over HTTPS and unpacks it into a
 * temporary folder, without needing `git` installed (and avoiding macOS's
 * Xcode Command Line Tools popup from `/usr/bin/git`). GitHub embeds the tag's
 * commit SHA in the tarball's PAX global comment; if absent, `tag` stands in.
 */
export async function fetchReleaseSource(repo: string, tag: string, options: ReleaseFetchOptions = {}): Promise<FetchedSource> {
    if (!GITHUB_REPO.test(repo)) throw new Error(`"${repo}" is not a GitHub repository.`);
    const [org, name] = repo.split("/");
    const base = (options.baseUrl ?? "https://github.com").replace(/\/+$/, "");
    const origin = new URL(base).host;
    const url = `${base}/${org}/${name}/archive/refs/tags/${encodeURIComponent(tag)}.tar.gz`;
    const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES;

    if (options.signal?.aborted) throw new StoppedError();

    const root = await mkdtemp(path.join(os.tmpdir(), "paperboard-issue-"));
    const archive = path.join(root, "source.tar.gz");
    const dir = path.join(root, "repo");
    let keep = false;

    try {
        await fs.promises.mkdir(dir);
        let response: Response;
        try {
            response = await fetch(url, { signal: options.signal });
        } catch (err) {
            if (options.signal?.aborted) throw new StoppedError();
            throw new Error(`Couldn't download Paperboard ${tag}'s code from ${origin}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!response.ok || !response.body) {
            throw new Error(`Couldn't download Paperboard ${tag}'s code from ${origin} (HTTP ${response.status}).`);
        }

        const file = await fs.promises.open(archive, "w", 0o600);
        let bytes = 0;
        try {
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
                if (options.signal?.aborted) throw new StoppedError();
                bytes += chunk.length;
                if (bytes > maxBytes) throw new Error(`Paperboard ${tag}'s source archive is larger than expected.`);
                for (let offset = 0; offset < chunk.length; ) {
                    const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
                    if (bytesWritten === 0) throw new Error(`Couldn't write Paperboard ${tag}'s source archive.`);
                    offset += bytesWritten;
                }
            }
        } catch (err) {
            if (options.signal?.aborted) throw new StoppedError();
            throw err;
        } finally {
            await file.close();
        }

        if (options.signal?.aborted) throw new StoppedError();

        let commit = "";
        await tar.x({
            file: archive,
            cwd: dir,
            strip: 1,
            strict: true,
            onReadEntry: (entry) => {
                const comment = (entry as { comment?: unknown }).comment;
                if (!commit && typeof comment === "string" && COMMIT_SHA.test(comment)) {
                    commit = comment.toLowerCase();
                }
            },
            // only plain files and directories: symlinks and device entries are skipped
            filter: (_entryPath, entry) => {
                const type = (entry as { type?: string }).type;
                return type === "File" || type === "Directory";
            },
        });
        await rm(archive, { force: true });

        if (options.signal?.aborted) throw new StoppedError();

        keep = true;
        return {
            kind: "remote",
            org,
            name,
            origin,
            url,
            ref: tag,
            github: repo,
            dir,
            commit: commit || tag,
            dispose: () => rm(root, { recursive: true, force: true }),
        };
    } finally {
        if (!keep) await rm(root, { recursive: true, force: true });
    }
}

/**
 * Points an `app.asar` path at its `app.asar.unpacked` twin when that file
 * exists on disk. Child Node processes spawned with `ELECTRON_RUN_AS_NODE=1`
 * (such as trissue's bundled Codex ACP adapter) cannot read scripts from
 * inside an ASAR archive.
 */
export function unpackedAsarPath(filePath: string, exists: (candidate: string) => boolean = fs.existsSync): string {
    const unpacked = filePath.replace(/(^|[/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2");
    return unpacked !== filePath && exists(unpacked) ? unpacked : filePath;
}

/** Rewrites any ASAR-packed script paths in a harness's launch args for packaged Electron builds. */
export function unpackAsarHarness(harness: Harness, isPackaged: boolean, exists: (candidate: string) => boolean = fs.existsSync): Harness {
    if (!isPackaged) return harness;
    const launch = harness.launch;
    const args = launch.args.map((arg) => unpackedAsarPath(arg, exists));
    return { ...harness, launch: { ...launch, args } };
}
