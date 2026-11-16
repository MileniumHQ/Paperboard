import { minecraftSoftware } from "../../games/minecraft/index";
import type { ServerPage } from "../server";
import type { ServerCalls } from "../api";
import { getEcosystem, listProjectVersions, pluginDirName, searchModrinth } from "../plugins";
import { discardUpload, listAdded, pickFiles, type UploadOutcome } from "./upload";
import { modrinthHits, modrinthSource } from "./sources";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";
import { versionLabel } from "./presentation";

// Plugins on a plugin server, mods on a mod loader: the same tab, the same
// folder rules, a different word. Installing runs here in the page (lib/plugins);
// listing and removing belong to the service.

type Listed = Awaited<ReturnType<ServerCalls["listInstalledPlugins"]>>["plugins"];

export const pluginTitle = (filename: string) => filename.replace(/\.jar$/i, "");

/** the version a record or the jar itself gives, or what is known instead */
function pluginFooter(entry: Listed[number]): string {
    const version = entry.record?.version ?? entry.described?.version;
    if (version) return versionLabel(version);
    if (entry.described?.error) return `Couldn't read this jar: ${entry.described.error}`;
    return entry.uploaded ? "Uploaded by you" : "Unknown version";
}

export function installedPlugins(plugins: Listed): InstalledAddon[] {
    return plugins.map((entry) => ({
        id: entry.filename,
        title: entry.record?.title ?? entry.record?.slug ?? entry.described?.name ?? pluginTitle(entry.filename),
        subtitle: entry.filename,
        iconUrl: entry.record?.iconUrl,
        badge: entry.uploaded ? { label: "Uploaded", variant: "monochrome" } : { label: "Installed", variant: "success" },
        footer: pluginFooter(entry),
        // a GeyserMC build has no Modrinth page to open
        project: entry.record && !entry.record.source ? { projectId: entry.record.projectId, slug: entry.record.slug } : undefined,
        version: entry.record?.version,
        uploaded: entry.uploaded === true,
    }));
}

export function pluginsKind(server: ServerPage): AddonKind {
    const { calls, files, serverSoftware, serverVersion } = server;
    const isMods = () => getEcosystem(minecraftSoftware(serverSoftware()))?.kind === "mod";
    return {
    get title() {
        return isMods() ? "Mods" : "Plugins";
    },
    icon: "extension",
    glyph: "extension",
    get noun() {
        return isMods() ? "mod" : "plugin";
    },
    source: modrinthSource("project", "https://modrinth.com"),
    searchScope: () => "Projects",
    emptySearch: () => `No ${isMods() ? "mod" : "plugin"}s matched your search.`,
    get installedTitle() {
        return isMods() ? "Installed Mods" : "Installed Plugins";
    },
    resultBadge: "Installed",
    watch: () => [minecraftSoftware(serverSoftware()), serverVersion()],

    async list(): Promise<AddonListing> {
        // service-owned (service/plugins.ts): listing verifies hashes against install records
        const { plugins, warning } = await calls.listInstalledPlugins();
        const dir = pluginDirName(minecraftSoftware(serverSoftware()));
        return {
            items: installedPlugins(plugins),
            warning: warning ? { title: `Couldn't list ${dir}/`, message: warning } : undefined,
            meta: undefined,
        };
    },
    listFailureTitle: () => `Couldn't read ${pluginDirName(minecraftSoftware(serverSoftware()))}/`,

    search: async (query, signal) => modrinthHits(await searchModrinth(server, query, signal)),
    async versions(projectId) {
        return (await listProjectVersions(server, projectId)).map((option) => ({
            id: option.versionId,
            label: `v${option.versionNumber || "?"}${option.recommended ? " · Recommended" : ""}`,
            recommended: option.recommended,
        }));
    },

    detail: true,
    itemClick: "detail",

    upload: {
        get sources() {
            return [pickFiles(files, isMods() ? "Upload mods" : "Upload plugins", ["jar"])];
        },
        failureTitle: "Not added",
        commit: (stage) => calls.uploadPlugins({ stage }),
        discard: discardUpload(calls),
        describe: (result) => ({
            title: "Added",
            message: `${listAdded((result as UploadOutcome).added)} will load the next time the server starts.`,
        }),
    },

    install: {
        title: (target) => `Install ${target.title}`,
        action: "Install",
        busyAction: "Installing…",
        icon: "download",
        errorTitle: "Install failed",
        noVersions: () => ({
            title: "No compatible build",
            text: `This ${isMods() ? "mod" : "plugin"} has no build for Minecraft ${serverVersion()}.`,
        }),
        run: (target, versionId, payload) =>
            calls.installPluginVersion({
                projectId: target.projectId,
                slug: target.slug,
                title: target.title,
                iconUrl: target.iconUrl,
                versionId,
                includeOptionalKeys: Array.isArray(payload) ? (payload as string[]) : [],
            }),
    },

    remove: {
        title: (item) => `Uninstall ${item.id}`,
        action: "Uninstall",
        busyAction: "Uninstalling…",
        errorTitle: "Couldn't uninstall",
        describe: () =>
            `This moves the jar out of the server's ${pluginDirName(minecraftSoftware(serverSoftware()))}/ folder into a .trash folder inside the server folder, where it can be restored. The change takes effect after a restart.`,
        // service-owned: trash-first delete, never a bare fileApi.delete
        run: (item) => calls.deletePlugin({ filename: item.id }).then(() => undefined),
    },
    };
}
