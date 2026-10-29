import { fileApi } from "@mileniumhq/paperapi";
import { pluginDirName } from "../core/plugins";
import { SOFTWARE } from "../software/catalog";
import { CROSSPLAY, GEYSER_MODRINTH_ID, type CrossplayPlatform, type FloodgateSource } from "../software/crossplay";
import { ACTION_IDS, PANEL_ID } from "../service/contract";
import type { CrossplayView } from "../service/crossplay";
import { serverBridge, serverSoftware, serverVersion } from "./server";
import { getProject, installProjectVersion, modrinthFetch, uninstallPlugin } from "./plugins";
import { apiFetch } from "./userAgent";

// Turning crossplay on installs Geyser and Floodgate the same way the
// Plugins tab installs anything (Modrinth, checksummed, recorded, so updates
// show there too), except Floodgate for Paper: GeyserMC publishes that build
// only on its own download API, which gives a sha256 for every file.

const GEYSERMC_API = "https://download.geysermc.org/v2/projects";

export function crossplayPlatform(): CrossplayPlatform | null {
    return CROSSPLAY[serverSoftware()] ?? null;
}

function requirePlatform(): CrossplayPlatform {
    const platform = crossplayPlatform();
    if (!platform) throw new Error(`Crossplay needs Paper, Fabric or NeoForge, not ${SOFTWARE[serverSoftware()].name}.`);
    return platform;
}

/** the newest build made for this server's software and Minecraft version, installed with its dependencies */
async function installFromModrinth(projectId: string): Promise<void> {
    const addons = SOFTWARE[serverSoftware()].addons!;
    const mcVersion = serverVersion();
    if (!mcVersion) throw new Error("Install a Minecraft version first, so Paperboard knows which build to pick.");
    const project = await getProject(projectId);
    const versions = await modrinthFetch<{ id: string }[]>(`/project/${encodeURIComponent(projectId)}/version`, {
        loaders: JSON.stringify([addons.modrinthLoader]),
        game_versions: JSON.stringify([mcVersion]),
    });
    const latest = versions[0];
    if (!latest) {
        throw new Error(`${project.title} has no build for ${SOFTWARE[serverSoftware()].name} ${mcVersion} yet.`);
    }
    await installProjectVersion({
        projectId,
        slug: project.slug,
        title: project.title,
        iconUrl: project.iconUrl,
        versionId: latest.id,
    });
}

interface GeyserBuild {
    build: number;
    downloads: Record<string, { name: string; sha256: string }>;
}

async function installFromGeyserMC(source: Extract<FloodgateSource, { kind: "geysermc" }>): Promise<void> {
    const res = await apiFetch(`${GEYSERMC_API}/${source.project}/versions/latest/builds/latest`, {
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GeyserMC's download service answered HTTP ${res.status}`);
    const latest = (await res.json()) as GeyserBuild;
    const file = latest.downloads?.[source.platform];
    if (!Number.isInteger(latest.build) || !file?.sha256) {
        throw new Error(`GeyserMC's latest ${source.project} build has no ${source.platform} download`);
    }
    await fileApi.download({
        // the build number pins the file the sha256 describes
        url: `${GEYSERMC_API}/${source.project}/versions/latest/builds/${latest.build}/downloads/${source.platform}`,
        targetPath: `${pluginDirName(serverSoftware())}/${source.filename}`,
        appId: PANEL_ID,
        sha256: file.sha256,
    });
}

export async function readCrossplay(): Promise<CrossplayView> {
    return serverBridge.call<CrossplayView>(ACTION_IDS.readCrossplay);
}

/** installs whichever of the two is missing, then sets Geyser to log Bedrock players in through Floodgate */
export async function enableCrossplay(current: CrossplayView): Promise<CrossplayView> {
    const platform = requirePlatform();
    if (!current.geyser) await installFromModrinth(GEYSER_MODRINTH_ID);
    if (!current.floodgate) {
        if (platform.floodgate.kind === "modrinth") await installFromModrinth(platform.floodgate.projectId);
        else await installFromGeyserMC(platform.floodgate);
    }
    return serverBridge.call<CrossplayView>(ACTION_IDS.prepareCrossplay);
}

/** removes both jars; their settings folders stay, so turning it back on keeps them */
export async function disableCrossplay(current: CrossplayView): Promise<CrossplayView> {
    if (current.geyser) await uninstallPlugin(current.geyser);
    if (current.floodgate) await uninstallPlugin(current.floodgate);
    return readCrossplay();
}
