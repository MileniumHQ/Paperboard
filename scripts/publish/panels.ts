// Panels on the store: Publish panels packs, signs and writes each picked
// panel to the registry; Unlist panels takes panels off the store. Both go
// through the operator's Cloudflare session (wrangler); there is no publish
// route and no registry key.
import * as p from "@clack/prompts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import * as tar from "tar";
import { createWranglerStorage, publishPanel, unlistPanel, type PanelUpload } from "../../services/origami/scripts/lib/panelPublish";
import { PANELS_INDEX_KEY, type PanelRecord } from "../../services/origami/src/panels";
import { ORIGAMI_HOST, storeUploadParts } from "../publishLib";
import { assertRelativePanelBuild, discoverPanels, PANELS_ROOT, type DiscoveredPanel } from "../publishManifest";
import { loadReleaseSigningKey, releaseMessage } from "../releaseSigning";
import { bar, cancelled, checkCancel, fail, hex, mb, ORIGAMI_URL, printTable, sh, signVerified } from "./common";

function listPanels(): DiscoveredPanel[] {
    return discoverPanels(PANELS_ROOT, (dirName, err) => {
        p.log.warn(
            `Skipping ${dirName}: ${err instanceof Error ? err.message : String(err)}`,
        );
    });
}

interface PackedPanel {
    info: DiscoveredPanel;
    bytes: Buffer;
    sha256: string;
    meta: Record<string, unknown>;
    icon: PanelUpload["icon"];
    store: ReturnType<typeof storeUploadParts>;
}

async function packPanel(info: DiscoveredPanel): Promise<PackedPanel> {
    // listing files and the declared icon are read before the build: a broken
    // listing or a missing icon refuses the publish instead of shipping a
    // release without it
    const manifest = JSON.parse(readFileSync(join(info.dir, "manifest.json"), "utf8"));
    const store = storeUploadParts(manifest.store, (rel) => readFileSync(join(info.dir, rel)));
    let icon: PanelUpload["icon"];
    if (manifest.icon !== undefined) {
        const iconPath = join(info.dir, String(manifest.icon).replace(/^\.\//, ""));
        if (!existsSync(iconPath)) fail(`${info.id}: manifest.json declares icon "${manifest.icon}", but ${iconPath} does not exist.`);
        icon = { name: basename(iconPath), bytes: readFileSync(iconPath) };
    }
    await sh([process.execPath, "run", "build"], { cwd: info.dir, quiet: false });
    assertRelativePanelBuild(info.dir, info.id);

    const entriesToPack = ["manifest.json"];
    if (existsSync(join(info.dir, "dist"))) entriesToPack.push("dist");
    if (existsSync(join(info.dir, "branding"))) entriesToPack.push("branding");
    else if (existsSync(join(info.dir, "icon.png"))) entriesToPack.push("icon.png");

    // the archive is held in memory from here on; its file is only for tar
    const outDir = mkdtempSync(join(tmpdir(), `paperboard-pack-${info.id}-`));
    let bytes: Buffer;
    try {
        const archivePath = join(outDir, `${info.id}-${info.version}.tar.gz`);
        tar.create({ gzip: true, file: archivePath, cwd: info.dir, sync: true }, entriesToPack);
        bytes = readFileSync(archivePath);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    return {
        info,
        bytes,
        sha256,
        icon,
        store,
        meta: {
            id: info.id,
            name: info.name,
            version: info.version,
            description: manifest.description,
            icon: manifest.icon,
            sha256,
            sizeBytes: bytes.byteLength,
            manifest,
        },
    };
}

// Writes a packed panel straight to the registry through wrangler (the
// operator's Cloudflare session). The record URLs are baked from the
// canonical production origin.
async function publishPackedPanel(packed: PackedPanel): Promise<void> {
    const { info, bytes, meta, icon, store } = packed;
    const files = new Map<string, Uint8Array>();
    for (const part of store.files) files.set(part.field, part.bytes);

    const upload: PanelUpload = {
        id: info.id,
        name: info.name,
        version: info.version,
        description:
            typeof meta["description"] === "string" ? meta["description"] : undefined,
        signature: String(meta["signature"]),
        manifest: meta["manifest"] as Record<string, unknown>,
        icon,
        store: { about: store.about, files },
        archive: bytes,
    };
    await publishPanel(upload, {
        storage: createWranglerStorage(),
        origin: `https://${ORIGAMI_HOST}`,
    });
}

// ─── Flow: publish panels ───────────────────────────────────────────────────

export async function flowPublishPanels(): Promise<void> {
    p.intro("Publish panels");
    const panels = listPanels();
    if (!panels.length) fail("No panels with a valid manifest.json found under panels/.");
    const pickedIds = checkCancel(
        await p.multiselect({
            message: "Which panels to publish?",
            options: panels.map((x) => ({
                value: x.id,
                label: x.name,
                hint: `${x.id} v${x.version}`,
            })),
            required: true,
        }),
    ) as string[];
    const picked = panels.filter((x) => pickedIds.includes(x.id));
    // clients refuse unsigned releases: no key, nothing is packed or sent
    const signingKey = loadReleaseSigningKey();

    const packBar = bar(picked.length);
    const packed: PackedPanel[] = [];
    for (const info of picked) {
        p.log.step(`Packing ${info.name} (${info.id} v${info.version})…`);
        const x = await packPanel(info);
        x.meta.signature = signVerified(signingKey, releaseMessage.panel(info.id, info.version, x.sha256), info.id);
        packed.push(x);
        packBar.increment(1, { task: info.id });
    }
    packBar.stop();

    p.log.info("Ready to upload:");
    printTable([
        ["panel", "version", "size", "sha256"],
        ...packed.map((x) => [
            x.info.id,
            `v${x.info.version}`,
            `${mb(x.bytes.byteLength)} MB`,
            x.sha256.slice(0, 16),
        ]),
    ]);
    if (!checkCancel(await p.confirm({ message: `Publish ${packed.length} panel(s) to the registry?`, initialValue: false }))) {
        cancelled();
    }

    const upBar = bar(packed.length);
    for (const x of packed) {
        await publishPackedPanel(x);
        upBar.increment(1, { task: x.info.id });
    }
    upBar.stop();

    p.log.success("Published:");
    printTable(packed.map((x) => [x.info.id, `${ORIGAMI_URL}/panel/${x.info.id}/download`]));
    p.outro("Registry updated. Previous panel versions are retained server-side.");
}

// ─── Flow: unlist panels ────────────────────────────────────────────────────

// Takes panels off the store. Their records and archives stay: installs that
// have one keep it and stop getting updates. Picked from what the registry
// lists, since an unlisted panel may no longer be under panels/.
export async function flowUnlistPanels(): Promise<void> {
    p.intro("Unlist panels");
    const storage = createWranglerStorage();
    const index = await storage.getJson<Record<string, PanelRecord>>(PANELS_INDEX_KEY);
    if (!index || typeof index !== "object") fail("The registry's panels:index is missing or unreadable.");
    const listed = Object.values(index);
    if (!listed.length) fail("The store lists no panels.");
    const pickedIds = checkCancel(
        await p.multiselect({
            message: "Which panels to take off the store?",
            options: listed.map((x) => ({ value: x.id, label: x.name, hint: `${x.id} v${x.version}` })),
            required: true,
        }),
    ) as string[];
    if (!checkCancel(await p.confirm({ message: `Take ${pickedIds.length} panel(s) off the store? Installs keep them, without updates.`, initialValue: false }))) {
        cancelled();
    }
    for (const id of pickedIds) {
        await unlistPanel(id, { storage });
        p.log.success(`${id} is off the store; ${ORIGAMI_URL}/panel/${id} still serves its record.`);
    }
    p.outro("Store updated. Publishing a panel again lists it again.");
}
