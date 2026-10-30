import { minecraftSoftware } from "../games/minecraft/index";
import { portApi } from "./api";
import { SOFTWARE } from "../software/catalog";
import { CROSSPLAY, GEYSER_MODRINTH_ID, type CrossplayPlatform } from "../software/crossplay";
import { ACTION_IDS } from "../service/contract";
import type { CrossplayView } from "../service/crossplay";
import { BEDROCK_PORT_NAME } from "../core/portNames";
import { PANEL_ID } from "../service/types";
import { serverBridge, serverSoftware, serverVersion } from "./server";
import { getProject, installGeyserMCProject, installProjectVersion, modrinthFetch, uninstallPlugin } from "./plugins";

// Turning crossplay on installs Geyser and Floodgate the same way the
// Plugins tab installs anything (Modrinth, checksummed, recorded, so updates
// show there too). Floodgate for Paper is only on GeyserMC's own download
// API; it is recorded too, so Update plugins covers it the same way.

export function crossplayPlatform(): CrossplayPlatform | null {
    return CROSSPLAY[minecraftSoftware(serverSoftware())] ?? null;
}

function requirePlatform(): CrossplayPlatform {
    const platform = crossplayPlatform();
    if (!platform) throw new Error(`Crossplay needs Paper, Fabric or NeoForge, not ${SOFTWARE[minecraftSoftware(serverSoftware())].name}.`);
    return platform;
}

/** the newest build made for this server's software and Minecraft version, installed with its dependencies */
async function installFromModrinth(projectId: string): Promise<void> {
    const addons = SOFTWARE[minecraftSoftware(serverSoftware())].addons!;
    const mcVersion = serverVersion();
    if (!mcVersion) throw new Error("Install a Minecraft version first, so Paperboard knows which build to pick.");
    const project = await getProject(projectId);
    const versions = await modrinthFetch<{ id: string }[]>(`/project/${encodeURIComponent(projectId)}/version`, {
        loaders: JSON.stringify([addons.modrinthLoader]),
        game_versions: JSON.stringify([mcVersion]),
    });
    const latest = versions[0];
    if (!latest) {
        throw new Error(`${project.title} has no build for ${SOFTWARE[minecraftSoftware(serverSoftware())].name} ${mcVersion} yet.`);
    }
    await installProjectVersion({
        projectId,
        slug: project.slug,
        title: project.title,
        iconUrl: project.iconUrl,
        versionId: latest.id,
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
        else {
            const { kind, project, platform: target, filename } = platform.floodgate;
            await installGeyserMCProject({ kind, project, platform: target }, filename, "Floodgate");
        }
    }
    return serverBridge.call<CrossplayView>(ACTION_IDS.prepareCrossplay);
}

/** removes both jars and gives the Bedrock port back; their settings folders
 * stay, so turning it back on keeps them */
export async function disableCrossplay(current: CrossplayView): Promise<CrossplayView> {
    if (current.geyser) await uninstallPlugin(current.geyser);
    if (current.floodgate) await uninstallPlugin(current.floodgate);
    await portApi.release(PANEL_ID, BEDROCK_PORT_NAME);
    return readCrossplay();
}
