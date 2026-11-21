// Releasing: Publish binaries starts the release workflow, makes the draft
// it leaves public, and moves the live index to it; republish-index moves
// the index again from a release that is already public.
import * as p from "@clack/prompts";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { KeyObject } from "node:crypto";
import {
    assetFileName,
    buildCraneIndex,
    buildLatestYml,
    buildSha256Sums,
    dlFileUrl,
    expectedReleaseAssets,
    feedOf,
    GH_REPO,
    isUpdatePayload,
    isValidVersionSegment,
    kvKeyFor,
    mergeVersionRecord,
    SHA256SUMS_KEY,
    tagFor,
    type DlApp,
    type Feed,
    type VersionFileEntry,
    type YmlEntry,
} from "./publishLib";
import { releaseGateCheck } from "./releaseGate";
import { loadReleaseSigningKey, releaseMessage } from "./releaseSigning";
import type { BuiltBinary } from "./binaries";
import { ensureCloudflareAuth, ensureGithubAuth, kvReadRecord, kvWriteRecord, r2PutText } from "./cloud";
import { bar, cancelled, checkCancel, cmdOk, fail, hashFile, mb, printTable, REPO_ROOT, sh, signVerified, version } from "./common";

const RELEASE_WORKFLOW = "release.yml";

// The commit the release workflow will build: HEAD, with no uncommitted
// changes to tracked files (CI never sees them), already on origin/main, and
// passed by a full Gate run (releaseGate.ts).
async function releaseCommit(): Promise<string> {
    const changed = await sh(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: REPO_ROOT, quiet: true });
    if (changed) {
        fail(`The release workflow builds commits, not this working tree. Commit or stash these first:\n${changed}`);
    }
    const commit = await sh(["git", "rev-parse", "HEAD"], { cwd: REPO_ROOT, quiet: true });
    await sh(["git", "fetch", "--quiet", "origin", "main"], { cwd: REPO_ROOT, quiet: true });
    if (!(await cmdOk(["git", "merge-base", "--is-ancestor", commit, "origin/main"], REPO_ROOT))) {
        fail(`HEAD (${commit.slice(0, 10)}) is not on origin/main yet. Push it first; releases build only from main.`);
    }
    const problem = await releaseGateCheck(commit);
    if (problem) fail(problem);
    return commit;
}

// Starts the release workflow and returns its run's id. The run is found by
// its title, which names the version and commit it was started with.
async function dispatchRelease(commit: string): Promise<string> {
    const title = `Release v${version} from ${commit}`;
    const started = Date.now();
    await sh(
        ["gh", "workflow", "run", RELEASE_WORKFLOW, "--repo", GH_REPO, "--ref", "main", "-f", `version=${version}`, "-f", `commit=${commit}`],
        { quiet: true },
    );
    while (Date.now() - started < 60_000) {
        const listed = JSON.parse(await sh(
            ["gh", "run", "list", "--repo", GH_REPO, "--workflow", RELEASE_WORKFLOW, "--event", "workflow_dispatch", "--limit", "20", "--json", "databaseId,displayTitle,createdAt"],
            { quiet: true },
        )) as { databaseId: number; displayTitle: string; createdAt: string }[];
        const run = listed.find((r) => r.displayTitle === title && Date.parse(r.createdAt) >= started - 10_000);
        if (run) return String(run.databaseId);
        await Bun.sleep(3000);
    }
    throw new Error(`GitHub accepted the release workflow but no run titled "${title}" appeared within a minute. Check https://github.com/${GH_REPO}/actions/workflows/${RELEASE_WORKFLOW}`);
}

// ─── Flow: publish binaries (release workflow + live index) ─────────────────

export async function flowPublishBinaries(): Promise<void> {
    p.intro("Publish binaries");
    if (!isValidVersionSegment(version)) {
        fail(
            `Refusing to publish version ${JSON.stringify(version)}: it is not a safe URL/tag segment. Fix package.json first.`,
        );
    }
    // daemons refuse unsigned self-updates: no key, nothing is built
    const signingKey = loadReleaseSigningKey();
    await ensureGithubAuth();
    const commit = await releaseCommit();
    const tag = tagFor(version);
    p.log.info(`Paperboard v${version} + Paperboard Server v${version}, from ${commit.slice(0, 10)}`);
    p.log.warn("The release workflow builds and smoke-tests every target on its own runner, then leaves them on a draft release. Nothing is public until you confirm again.");
    if (!checkCancel(await p.confirm({ message: `Build v${version} in the release workflow?`, initialValue: false }))) {
        cancelled();
    }

    const runId = await dispatchRelease(commit);
    const runUrl = `https://github.com/${GH_REPO}/actions/runs/${runId}`;
    p.log.step(`Release workflow: ${runUrl}`);
    try {
        await sh(["gh", "run", "watch", runId, "--repo", GH_REPO, "--exit-status", "--interval", "30"], { quiet: false });
    } catch (err) {
        fail(`The release workflow failed, so nothing was published. See ${runUrl}\n${err instanceof Error ? err.message : String(err)}`);
    }

    const release = await readRelease(tag);
    if (!release.isDraft) fail(`${tag} is already public; the workflow only ever leaves a draft. Nothing was changed.`);
    if (release.targetCommitish !== commit) {
        fail(`The draft ${tag} was built from ${release.targetCommitish}, not ${commit}. Nothing was changed.`);
    }
    const staged = await hashReleaseAssets(tag, release.assets);
    p.log.info("Built by the release workflow, hashed as hosted on the draft:");
    printTable([
        ["file", "size", "sha256"],
        ...staged.map((b) => [b.filename, `${mb(b.size)} MB`, b.sha256.slice(0, 16)]),
    ]);
    if (
        !checkCancel(
            await p.confirm({
                message: `Make ${tag} public and move the live "latest" pointer to v${version}?`,
                initialValue: false,
            }),
        )
    ) {
        cancelled();
    }

    await ensureCloudflareAuth();
    await sh(["gh", "release", "edit", tag, "--repo", GH_REPO, "--draft=false"], { quiet: true });
    p.log.success(`${tag} is public.`);
    await publishIndex(signingKey, version, staged);

    p.log.success("Published:");
    printTable([
        ["what", "url"],
        [`release`, `https://github.com/${GH_REPO}/releases/tag/${tag}`],
        [`latest pb`, dlFileUrl("pb", "latest", assetFileName("pb", "macos-arm64"))],
        [`latest crane`, dlFileUrl("crane", "latest", assetFileName("crane", "linux-x64"))],
    ]);
    p.outro(`Paperboard v${version} is live.`);
}

interface ReleaseAsset {
    size: number;
    digest: string | null;
}

interface HostedRelease {
    isDraft: boolean;
    targetCommitish: string;
    assets: Map<string, ReleaseAsset>;
}

async function readRelease(tag: string): Promise<HostedRelease> {
    let raw: string;
    try {
        raw = await sh(["gh", "release", "view", tag, "--repo", GH_REPO, "--json", "assets,isDraft,targetCommitish"], { quiet: true });
    } catch (err) {
        fail(`Release ${tag} not found or unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = JSON.parse(raw) as {
        isDraft: boolean;
        targetCommitish: string;
        assets: { name: string; size: number; digest?: string | null }[];
    };
    return {
        isDraft: parsed.isDraft,
        targetCommitish: parsed.targetCommitish,
        assets: new Map(parsed.assets.map((a) => [a.name, { size: a.size, digest: a.digest ?? null }])),
    };
}

// Hashes every asset a release must hold, as hosted: the bytes are
// downloaded and checked against GitHub's own size and sha256, so the index
// can only ever record files that are really there. The downloads are
// removed however it ends, so the result carries no file path.
type IndexedAsset = Omit<BuiltBinary, "filePath">;

async function hashReleaseAssets(tag: string, releaseAssets: Map<string, ReleaseAsset>): Promise<IndexedAsset[]> {
    const jobs = expectedReleaseAssets(new Set(releaseAssets.keys()), version);
    const missing = jobs.filter((j) => !releaseAssets.has(j.file)).map((j) => j.file);
    if (missing.length) {
        fail(`Release ${tag} is missing expected asset(s):\n  ${missing.join("\n  ")}`);
    }
    const dir = mkdtempSync(join(tmpdir(), "paperboard-index-"));
    const staged: IndexedAsset[] = [];
    try {
        const dl = bar(jobs.length);
        for (const j of jobs) {
            const release = releaseAssets.get(j.file)!;
            await sh(
                ["gh", "release", "download", tag, "--repo", GH_REPO, "--pattern", j.file, "--dir", dir, "--clobber"],
                { quiet: true },
            );
            const filePath = join(dir, j.file);
            if (!existsSync(filePath)) throw new Error(`gh did not download ${j.file}`);
            const { sha256, sha512, size } = await hashFile(filePath);
            if (size !== release.size) {
                throw new Error(`${j.file}: hashed size ${size} does not match the release's ${release.size}`);
            }
            if (release.digest) {
                const expected = release.digest.replace(/^sha256:/i, "");
                if (expected && expected !== sha256) {
                    throw new Error(`${j.file}: sha256 does not match the release digest; refusing to index changed bytes`);
                }
            }
            staged.push({ app: j.app, target: j.target, filename: j.file, releaseFile: j.file, sha256, sha512, size });
            dl.increment(1, { task: j.file });
        }
        dl.stop();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
    return staged;
}

// Move the live index to a finished release: KV version records, the signed
// crane update index on R2, and the electron-updater feeds.
async function publishIndex(signingKey: KeyObject, v: string, staged: IndexedAsset[]): Promise<void> {
    // one signature per file, recorded in KV and (for the server) in the crane index
    const signatures = new Map(
        staged.map((b) => [
            b.filename,
            b.app === "crane"
                ? signVerified(signingKey, releaseMessage.crane(v, b.sha256), b.filename)
                : signVerified(signingKey, releaseMessage.app(v, b.filename, b.sha512), b.filename),
        ]),
    );
    for (const app of ["pb", "crane"] as DlApp[]) {
        const prev = await kvReadRecord(app);
        const files: VersionFileEntry[] = staged
            .filter((b) => b.app === app)
            .map((b) => ({
                file: b.filename,
                sha256: b.sha256,
                sha512: b.sha512,
                size: b.size,
                signature: signatures.get(b.filename)!,
            }));
        const next = mergeVersionRecord(prev, v, files);
        await kvWriteRecord(app, next);
        p.log.success(
            `Index ${kvKeyFor(app)}: recorded v${v} (${prev ? Object.keys(prev.versions).length : 0} → ${Object.keys(next.versions).length} versions, latest → v${v}).`,
        );
    }

    // The host's crane update planner reads this R2 projection, not KV. It
    // carries the signed version/sha256 facts the daemon verifies, so a
    // remote self-update has an authoritative entry to act on.
    const craneIndex = buildCraneIndex(
        v,
        staged
            .filter((b) => b.app === "crane")
            .map((b) => ({
                target: b.target,
                file: b.filename,
                sha256: b.sha256,
                signature: signatures.get(b.filename)!,
            })),
    );
    await r2PutText("crane/index.json", JSON.stringify(craneIndex, null, 2), "application/json");
    p.log.success(
        `Index paperdl/crane/index.json: signed entries for ${Object.keys(craneIndex).length} targets.`,
    );

    // electron-updater feeds (paperboard only) stay on Origami/R2; their
    // file URLs point at the dl "latest" alias, which 302s to GitHub.
    const releaseDate = new Date().toISOString();
    const byFeed = new Map<Feed, YmlEntry[]>();
    for (const b of staged) {
        if (b.app !== "pb" || !isUpdatePayload(b.filename)) continue;
        const feed = feedOf(b.target);
        if (!byFeed.has(feed)) byFeed.set(feed, []);
        byFeed.get(feed)!.push({ target: b.target, file: b.filename, sha512: b.sha512, size: b.size });
    }
    for (const [feed, entries] of byFeed) {
        const { key, text } = buildLatestYml(feed, v, entries, releaseDate);
        await r2PutText(key, text, "text/yaml");
        p.log.success(`Feed ${key} uploaded.`);
    }

    // the install scripts' checksums: every Paperboard download of v
    const sums = buildSha256Sums(staged.filter((b) => b.app === "pb").map((b) => ({ file: b.filename, sha256: b.sha256 })));
    await r2PutText(SHA256SUMS_KEY, sums, "text/plain; charset=utf-8");
    p.log.success(`Checksums ${SHA256SUMS_KEY} uploaded.`);
}

// ─── Flow: repair the live index from an existing release ───────────────────
// Publish binaries makes the release public, then writes the index. If the
// release went public but the index write did not, the release exists but
// nothing can download. This re-derives the index from the bytes actually hosted on the
// release — it hashes the released assets and refuses when an expected one
// is missing, so it can never record a file that is not there.
export async function flowRepublishIndex(yes: boolean): Promise<void> {
    p.intro(`Republish download index for v${version} (from the GitHub release)`);
    if (!isValidVersionSegment(version)) {
        fail(`Refusing version ${JSON.stringify(version)}: not a safe tag segment.`);
    }
    const signingKey = loadReleaseSigningKey();
    const tag = tagFor(version);

    await ensureGithubAuth();
    await ensureCloudflareAuth();

    const release = await readRelease(tag);
    if (release.isDraft) {
        fail(`${tag} is still a draft: its files can't be downloaded yet. Publish binaries makes it public and moves the index.`);
    }
    const expected = expectedReleaseAssets(new Set(release.assets.keys()), version).length;

    if (!yes) {
        if (!process.stdin.isTTY) {
            fail("Refusing to move the live index without a TTY; pass --yes to confirm.");
        }
        if (
            !checkCancel(
                await p.confirm({
                    message: `Hash the ${expected} assets on ${tag} and move "latest" to v${version}?`,
                    initialValue: false,
                }),
            )
        ) {
            cancelled();
        }
    }

    const staged = await hashReleaseAssets(tag, release.assets);
    p.log.info("Hashed as hosted on the release:");
    printTable([
        ["file", "size", "sha256"],
        ...staged.map((b) => [b.filename, `${mb(b.size)} MB`, b.sha256.slice(0, 16)]),
    ]);

    await publishIndex(signingKey, version, staged);
    p.outro(`Index for v${version} is live.`);
}
