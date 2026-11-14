// Where publishing writes: the operator's own Cloudflare (wrangler) and
// GitHub (gh) sessions, the KV version records and the small R2 files the
// download worker serves. Sign-ins are per run and never stored.
import * as p from "@clack/prompts";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { KV_PACKAGES_BINDING, PAPERDL_R2_BUCKET, kvKeyFor, type DlApp, type DlAppRecord } from "../publishLib";
import { cmdOk, fail, ORIGAMI_DIR, sh } from "./common";

let wranglerBin: string[] | null = null;

async function wrBin(): Promise<string[]> {
    if (!wranglerBin) {
        if (await cmdOk(["wrangler", "--version"])) {
            wranglerBin = ["wrangler"];
        } else {
            p.log.warn(
                "wrangler is not on PATH — running it via `bun x wrangler` (downloads on first use).",
            );
            wranglerBin = [process.execPath, "x", "wrangler"];
        }
    }
    return wranglerBin;
}

async function wr(args: string[]): Promise<string> {
    return sh([...(await wrBin()), ...args], { cwd: ORIGAMI_DIR, quiet: true });
}

export async function ensureCloudflareAuth(): Promise<void> {
    const bin = await wrBin();
    if (await cmdOk([...bin, "whoami"], ORIGAMI_DIR)) {
        p.log.success("Cloudflare: already logged in.");
        return;
    }
    p.log.warn("Cloudflare: not logged in — opening `wrangler login`…");
    await sh([...bin, "login"], { cwd: ORIGAMI_DIR, quiet: false });
    if (!(await cmdOk([...bin, "whoami"], ORIGAMI_DIR))) {
        fail("Cloudflare login did not complete. Aborting before anything uploads.");
    }
    p.log.success("Cloudflare: logged in.");
}

export async function ensureGithubAuth(): Promise<void> {
    if (!(await cmdOk(["gh", "--version"]))) {
        fail("GitHub CLI (gh) not found. Install it from https://cli.github.com, then re-run.");
    }
    if (await cmdOk(["gh", "auth", "status"])) {
        p.log.success("GitHub: already authenticated.");
        return;
    }
    p.log.warn("GitHub: not authenticated — opening `gh auth login`…");
    await sh(["gh", "auth", "login"], { quiet: false });
    if (!(await cmdOk(["gh", "auth", "status"]))) {
        fail("GitHub login did not complete. Aborting before anything uploads.");
    }
    p.log.success("GitHub: authenticated.");
}

export async function kvReadRecord(app: DlApp): Promise<DlAppRecord | null> {
    // List-then-get: a missing key is a legitimate "no record yet", but an
    // unreadable record must never be silently treated as empty and
    // overwritten (that would drop every previous version).
    const key = kvKeyFor(app);
    let listed: { name: string }[];
    try {
        listed = JSON.parse(
            await wr([
                "kv",
                "key",
                "list",
                "--binding",
                KV_PACKAGES_BINDING,
                "--prefix",
                key,
                "--remote",
            ]),
        );
    } catch (err) {
        throw new Error(
            `Could not list KV keys: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (!listed.some((k) => k.name === key)) return null;
    const raw = await wr([
        "kv",
        "key",
        "get",
        "--binding",
        KV_PACKAGES_BINDING,
        key,
        "--remote",
    ]);
    let rec: unknown;
    try {
        rec = JSON.parse(raw);
    } catch {
        fail(
            `KV record ${key} exists but is not valid JSON. Refusing to overwrite it — inspect it with \`wrangler kv key get --binding ${KV_PACKAGES_BINDING} "${key}" --remote\` first.`,
        );
    }
    if (
        typeof rec !== "object" ||
        rec === null ||
        typeof (rec as DlAppRecord).latest !== "string" ||
        typeof (rec as DlAppRecord).versions !== "object"
    ) {
        fail(`KV record ${key} has an unexpected shape. Refusing to overwrite it.`);
    }
    return rec as DlAppRecord;
}

export async function kvWriteRecord(app: DlApp, rec: DlAppRecord): Promise<void> {
    // --remote is load-bearing: without it wrangler writes to local
    // miniflare state and the publish "succeeds" while production stays
    // empty (the index then never reaches i.paperboard.dev).
    await wr([
        "kv",
        "key",
        "put",
        "--binding",
        KV_PACKAGES_BINDING,
        kvKeyFor(app),
        JSON.stringify(rec),
        "--remote",
    ]);
}

// Uploads `text` to the download bucket at `key`. wrangler reads the body
// from a file, which lives in a temp dir only for the upload.
export async function r2PutText(key: string, text: string, contentType: string): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "paperboard-r2-"));
    try {
        const file = join(dir, basename(key));
        writeFileSync(file, text);
        await wr([
            "r2",
            "object",
            "put",
            `${PAPERDL_R2_BUCKET}/${key}`,
            "--file",
            file,
            "--content-type",
            contentType,
            "--remote",
        ]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
