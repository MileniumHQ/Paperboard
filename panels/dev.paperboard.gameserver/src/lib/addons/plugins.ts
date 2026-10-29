import { serverSoftware, serverVersion } from "../server";
import {
    deletePlugin,
    getEcosystem,
    installProjectVersion,
    listInstalledPlugins,
    listProjectVersions,
    pluginDirName,
    searchModrinth,
} from "../plugins";
import { commitPlugins, discardUpload, listAdded, pickFiles, type UploadOutcome } from "./upload";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Plugins on a plugin server, mods on a mod loader: the same tab, the same
// folder rules, a different word. Installing runs here in the page (lib/plugins);
// listing and removing belong to the service.

const isMods = () => getEcosystem(serverSoftware())?.kind === "mod";

export const pluginTitle = (filename: string) => filename.replace(/\.jar$/i, "");

export function installedPlugins(
    plugins: Awaited<ReturnType<typeof listInstalledPlugins>>["plugins"],
): InstalledAddon[] {
    return plugins.map((entry) => ({
        id: entry.filename,
        title: entry.record?.title ?? entry.record?.slug ?? pluginTitle(entry.filename),
        subtitle: entry.filename,
        iconUrl: entry.record?.iconUrl,
        badge: entry.uploaded ? { label: "Uploaded", variant: "monochrome" } : { label: "Installed", variant: "success" },
        footer: entry.record?.version ? `v${entry.record.version}` : entry.uploaded ? "Uploaded by you" : "Unknown version",
        project: entry.record ? { projectId: entry.record.projectId, slug: entry.record.slug } : undefined,
        version: entry.record?.version,
        uploaded: entry.uploaded === true,
    }));
}

export const pluginsKind: AddonKind = {
    get title() {
        return isMods() ? "Mods" : "Plugins";
    },
    icon: "extension",
    glyph: "extension",
    get noun() {
        return isMods() ? "mod" : "plugin";
    },
    modrinthPath: "project",
    browseUrl: "https://modrinth.com",
    get searchPlaceholder() {
        return isMods() ? "Search Mods" : "Search Plugins";
    },
    searchScope: () => "Projects",
    emptySearch: () => `No ${isMods() ? "mod" : "plugin"}s matched your search.`,
    get installedTitle() {
        return isMods() ? "Installed Mods" : "Installed Plugins";
    },
    resultBadge: "Installed",
    watch: () => [serverSoftware(), serverVersion()],

    async list(): Promise<AddonListing> {
        const { plugins, warning } = await listInstalledPlugins();
        const dir = pluginDirName(serverSoftware());
        return {
            items: installedPlugins(plugins),
            warning: warning ? { title: `Couldn't list ${dir}/`, message: warning } : undefined,
            meta: undefined,
        };
    },
    listFailureTitle: () => `Couldn't read ${pluginDirName(serverSoftware())}/`,

    search: (query, signal) => searchModrinth(query, signal),
    async versions(projectId) {
        return (await listProjectVersions(projectId)).map((option) => ({
            id: option.versionId,
            label: `v${option.versionNumber || "?"}${option.recommended ? " · Recommended" : ""}`,
            recommended: option.recommended,
        }));
    },

    detail: true,
    itemClick: "detail",

    upload: {
        get sources() {
            return [pickFiles(isMods() ? "Upload mods" : "Upload plugins", ["jar"])];
        },
        failureTitle: "Not added",
        commit: commitPlugins,
        discard: discardUpload,
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
            installProjectVersion({
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
            `This moves the jar out of the server's ${pluginDirName(serverSoftware())}/ folder into a .trash folder inside the server folder, where it can be restored. The change takes effect after a restart.`,
        run: (item) => deletePlugin(item.id),
    },
};
