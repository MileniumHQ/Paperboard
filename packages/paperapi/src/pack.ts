import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawnSync } from "child_process";
import * as tar from "tar";
import { requirePanelId } from "./panelIdentity";

export interface PackOptions {
    targetDir?: string;
    outputDir?: string;
    autoBuild?: boolean;
}

export interface PackResult {
    id: string;
    name: string;
    version: string;
    description?: string;
    archivePath: string;
    archiveName: string;
    sha256: string;
    sizeBytes: number;
    manifest: any;
}

// packages a panel project into a release archive
export function packPanel(options: PackOptions = {}): PackResult {
    const panelDir = path.resolve(options.targetDir || process.cwd());
    const manifestPath = path.join(panelDir, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
        throw new Error(`manifest.json not found in ${panelDir}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    requirePanelId(manifest.id);
    if (!manifest.name) {
        throw new Error("Panel manifest must specify a 'name'");
    }
    if (!manifest.version) {
        throw new Error(
            `Panel manifest must specify a 'version' (refusing to pack ${manifest.name}); a versionless archive cannot be released`,
        );
    }

    const version = manifest.version;
    const base = manifest.base || "./dist/index.html";
    const baseAbsolutePath = path.resolve(panelDir, base);

    // auto-build when entry is missing
    if (!fs.existsSync(baseAbsolutePath)) {
        if (options.autoBuild !== false) {
            console.log(`[Packager] Building panel in ${panelDir}...`);
            const buildRes = spawnSync("bun", ["run", "build"], {
                cwd: panelDir,
                stdio: "inherit",
            });
            if (buildRes.status !== 0) {
                throw new Error(`Build failed with exit code ${buildRes.status}`);
            }
        } else {
            throw new Error(`Panel entry point not found at ${baseAbsolutePath}`);
        }
    }

    // manifest.base says where the panel entry lives; the directory holding
    // it must be packed — previously base was validated but the archive
    // silently hardcoded dist/, so a base outside dist was dropped on the
    // floor
    const baseDirRel: string | null = (() => {
        const rel = path.relative(panelDir, path.dirname(baseAbsolutePath));
        return rel === "" ? null : rel;
    })();

    const outDir = options.outputDir
        ? path.resolve(options.outputDir)
        : path.join(panelDir, "out");

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const archiveName = `${manifest.id}-${version}.tar.gz`;
    const archivePath = path.join(outDir, archiveName);

    const entriesToPack = ["manifest.json"];

    const addEntry = (entry: string): void => {
        if (!entriesToPack.includes(entry) && fs.existsSync(path.join(panelDir, entry))) {
            entriesToPack.push(entry);
        }
    };

    addEntry(baseDirRel ?? "dist");
    addEntry("dist");
    if (fs.existsSync(path.join(panelDir, "branding"))) addEntry("branding");
    else if (fs.existsSync(path.join(panelDir, "icon.png"))) addEntry("icon.png");

    console.log(`[Packager] Archiving into ${archiveName}...`);
    tar.create(
        {
            gzip: true,
            file: archivePath,
            cwd: panelDir,
            sync: true,
        },
        entriesToPack,
    );

    if (!fs.existsSync(archivePath)) {
        throw new Error(`Failed to create tar.gz archive at ${archivePath}`);
    }

    const archiveBuffer = fs.readFileSync(archivePath);
    const sha256 = crypto.createHash("sha256").update(archiveBuffer).digest("hex");
    const sizeBytes = archiveBuffer.length;

    console.log(`[Packager] Packed ${manifest.id}@${version} (${(sizeBytes / 1024).toFixed(1)} KB)`);

    return {
        id: manifest.id,
        name: manifest.name,
        version,
        description: manifest.description,
        archivePath,
        archiveName,
        sha256,
        sizeBytes,
        manifest,
    };
}
