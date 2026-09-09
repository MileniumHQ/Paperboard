import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawnSync } from "child_process";
import * as tar from "tar";

export const PANEL_ID_REGEX = /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+){2,}$/;

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

    if (!manifest.id || !PANEL_ID_REGEX.test(manifest.id)) {
        throw new Error(
            `Invalid panel id: "${manifest.id}". Must match reverse-domain pattern (e.g. ext.host.app)`,
        );
    }
    if (!manifest.name) {
        throw new Error("Panel manifest must specify a 'name'");
    }

    const version = manifest.version || "1.0.0";
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

    const outDir = options.outputDir
        ? path.resolve(options.outputDir)
        : path.join(panelDir, "out");

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const archiveName = `${manifest.id}-${version}.tar.gz`;
    const archivePath = path.join(outDir, archiveName);

    const entriesToPack = ["manifest.json"];
    if (fs.existsSync(path.join(panelDir, "dist"))) entriesToPack.push("dist");
    if (fs.existsSync(path.join(panelDir, "branding"))) entriesToPack.push("branding");
    else if (fs.existsSync(path.join(panelDir, "icon.png"))) entriesToPack.push("icon.png");

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
