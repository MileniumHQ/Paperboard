import { minecraftSoftware } from "../games/minecraft/index";
import { SOFTWARE } from "../software/catalog";
import { CROSSPLAY, GEYSER_MODRINTH_ID, type CrossplayPlatform } from "../software/crossplay";
import type { CrossplayView } from "../service/crossplay";
import { BEDROCK_PORT_NAME, NETHERNET_PORT_NAME } from "../core/portNames";
import { PANEL_ID } from "../service/types";
import type { ServerPage } from "./server";
import { getProject, installGeyserMCProject, modrinthFetch } from "./plugins";

// Turning crossplay on installs Geyser and Floodgate the same way the
// Plugins tab installs anything (Modrinth, checksummed, recorded, so updates
// show there too). Floodgate for Paper is only on GeyserMC's own download
// API; it is recorded too, so Update plugins covers it the same way.

export function crossplayPlatform(software: string): CrossplayPlatform | null {
    return CROSSPLAY[minecraftSoftware(software)] ?? null;
}

function requirePlatform(software: string): CrossplayPlatform {
    const platform = crossplayPlatform(software);
    if (!platform) throw new Error(`Crossplay needs Paper, Fabric or NeoForge, not ${SOFTWARE[minecraftSoftware(software)].name}.`);
    return platform;
}

/** the newest build made for this server's software and Minecraft version, installed with its dependencies */
async function installFromModrinth(server: ServerPage, projectId: string): Promise<void> {
    const software = SOFTWARE[minecraftSoftware(server.serverSoftware())];
    const addons = software.addons!;
    const mcVersion = server.serverVersion();
    if (!mcVersion) throw new Error("Install a Minecraft version first, so Paperboard knows which build to pick.");
    const project = await getProject(projectId);
    const versions = await modrinthFetch<{ id: string }[]>(`/project/${encodeURIComponent(projectId)}/version`, {
        loaders: JSON.stringify([addons.modrinthLoader]),
        game_versions: JSON.stringify([mcVersion]),
    });
    const latest = versions[0];
    if (!latest) {
        throw new Error(`${project.title} has no build for ${software.name} ${mcVersion} yet.`);
    }
    await server.calls.installPluginVersion({
        projectId,
        slug: project.slug,
        title: project.title,
        iconUrl: project.iconUrl,
        versionId: latest.id,
    });
}

/** installs whichever of the two is missing, then sets Geyser to log Bedrock players in through Floodgate */
export async function enableCrossplay(server: ServerPage, current: CrossplayView): Promise<CrossplayView> {
    const platform = requirePlatform(server.serverSoftware());
    if (!current.geyser) await installFromModrinth(server, GEYSER_MODRINTH_ID);
    if (!current.floodgate) {
        if (platform.floodgate.kind === "modrinth") await installFromModrinth(server, platform.floodgate.projectId);
        else {
            const { kind, project, platform: target, filename } = platform.floodgate;
            await installGeyserMCProject(server, { kind, project, platform: target }, filename, "Floodgate");
        }
    }
    return server.calls.prepareCrossplay();
}

/** removes both jars and gives the Bedrock ports back; their settings folders
 * stay, so turning it back on keeps them */
export async function disableCrossplay({ calls, ports }: ServerPage, current: CrossplayView): Promise<CrossplayView> {
    if (current.geyser) await calls.deletePlugin({ filename: current.geyser });
    if (current.floodgate) await calls.deletePlugin({ filename: current.floodgate });
    await ports.release(PANEL_ID, BEDROCK_PORT_NAME);
    await ports.release(PANEL_ID, NETHERNET_PORT_NAME);
    return calls.readCrossplay();
}
