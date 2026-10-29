import { serverStatus, serverVersion } from "../server";
import { installDatapack, listDatapacks, listDatapackVersions, removeDatapack, searchDatapacks } from "../datapacks";
import { versionLabel } from "./presentation";
import type { DatapackListing } from "../../service/datapacks";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Datapacks: the active world's datapacks/ folder, plus Modrinth's datapack
// builds for this Minecraft version. The service lists, installs and removes.

export function installedDatapacks(listing: DatapackListing): InstalledAddon[] {
    return listing.packs.map((pack) => ({
        id: pack.name,
        title: pack.record?.title ?? pack.name.replace(/\.zip$/i, ""),
        subtitle: pack.name,
        iconUrl: pack.record?.iconUrl,
        badge: pack.kind === "folder" ? { label: "Folder", variant: "monochrome" } : { label: "Installed", variant: "success" },
        footer: pack.record?.version ? versionLabel(pack.record.version) : "Added by hand",
        project: pack.record ? { projectId: pack.record.projectId, slug: pack.record.slug } : undefined,
        version: pack.record?.version,
        uploaded: false,
    }));
}

export const datapacksKind: AddonKind<DatapackListing> = {
    title: "Datapacks",
    icon: "dataset",
    glyph: "dataset",
    noun: "datapack",
    modrinthPath: "datapack",
    browseUrl: "https://modrinth.com/datapacks",
    searchPlaceholder: "Search Datapacks",
    searchScope: () => `Datapacks for Minecraft ${serverVersion()}`,
    emptySearch: () => `No datapacks for Minecraft ${serverVersion()} matched your search.`,
    installedTitle: "Installed Datapacks",
    resultBadge: "Installed",
    watch: serverVersion,

    async list(): Promise<AddonListing<DatapackListing>> {
        const listing = await listDatapacks();
        return {
            items: installedDatapacks(listing),
            note: listing.truncated ? `Showing the first ${listing.packs.length} entries of the folder.` : undefined,
            meta: listing,
        };
    },
    listFailureTitle: () => "Could not read the datapacks folder",

    search: (query, signal) => searchDatapacks(query, signal),
    async versions(projectId) {
        return (await listDatapackVersions(projectId)).map((v) => ({ id: v.id, label: v.versionNumber || v.name }));
    },

    itemClick: "remove",

    install: {
        title: (target) => `Install ${target.title}`,
        action: "Install",
        busyAction: "Installing…",
        icon: "download",
        errorTitle: "Not installed",
        noVersions: () => ({
            title: "No compatible build",
            text: `This datapack has no build for Minecraft ${serverVersion()}.`,
        }),
        run: (target, versionId) => installDatapack(target.projectId, versionId),
    },

    remove: {
        title: () => "Remove datapack",
        action: "Remove",
        busyAction: "Removing…",
        errorTitle: "Not removed",
        describe: (item, listing) =>
            `Move ${item.title} out of ${listing?.meta.world}/datapacks/ into the server folder's trash?${
                serverStatus() === "online" ? " It stays loaded until the next reload or restart." : ""
            }`,
        run: (item) => removeDatapack(item.id).then(() => undefined),
    },
};
