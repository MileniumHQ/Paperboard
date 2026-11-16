import type { ServerPage } from "../server";
import { searchProjects } from "../modrinth";
import { versionLabel } from "./presentation";
import type { DatapackListing } from "../../service/datapacks";
import { discardUpload, listAdded, pickFiles, pickFolder, type UploadOutcome } from "./upload";
import { modrinthHits, modrinthSource } from "./sources";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Datapacks: the active world's datapacks/ folder, plus Modrinth's datapack
// builds for this Minecraft version. Modrinth search runs in the page like
// the Mods tab's; the service lists, installs and removes.

export function installedDatapacks(listing: DatapackListing): InstalledAddon[] {
    return listing.packs.map((pack) => ({
        id: pack.name,
        title: pack.record?.title ?? pack.name.replace(/\.zip$/i, ""),
        subtitle: pack.name,
        iconUrl: pack.record?.iconUrl,
        badge: pack.uploaded
            ? { label: "Uploaded", variant: "monochrome" }
            : pack.kind === "folder"
              ? { label: "Folder", variant: "monochrome" }
              : { label: "Installed", variant: "success" },
        footer: pack.record?.version ? versionLabel(pack.record.version) : pack.uploaded ? "Uploaded by you" : "Added by hand",
        project: pack.record ? { projectId: pack.record.projectId, slug: pack.record.slug } : undefined,
        version: pack.record?.version,
        uploaded: pack.uploaded === true,
    }));
}

export const datapacksKind = ({ calls, files, serverStatus, serverVersion }: ServerPage): AddonKind<DatapackListing> => ({
    title: "Datapacks",
    icon: "dataset",
    glyph: "dataset",
    noun: "datapack",
    source: modrinthSource("datapack", "https://modrinth.com/datapacks"),
    searchScope: () => `Datapacks for Minecraft ${serverVersion()}`,
    emptySearch: () => `No datapacks for Minecraft ${serverVersion()} matched your search.`,
    installedTitle: "Installed Datapacks",
    resultBadge: "Installed",
    watch: serverVersion,

    async list(): Promise<AddonListing<DatapackListing>> {
        const listing = await calls.listDatapacks();
        return {
            items: installedDatapacks(listing),
            note: listing.truncated ? `Showing the first ${listing.packs.length} entries of the folder.` : undefined,
            meta: listing,
        };
    },
    listFailureTitle: () => "Could not read the datapacks folder",

    async search(query, signal) {
        const mcVersion = serverVersion();
        if (!mcVersion) throw new Error("Choose a server version before browsing datapacks.");
        return modrinthHits(await searchProjects({ query, signal, facets: [["project_type:datapack"], [`versions:${mcVersion}`]] }));
    },
    async versions(projectId) {
        return (await calls.listDatapackVersions({ projectId })).map((v) => ({ id: v.id, label: v.versionNumber || v.name }));
    },

    itemClick: "remove",

    upload: {
        sources: [pickFiles(files, "Upload zips", ["zip"]), pickFolder(files, "Upload folder")],
        failureTitle: "Not added",
        commit: (stage) => calls.uploadDatapacks({ stage }),
        discard: discardUpload(calls),
        describe: (result) => ({
            title: "Added",
            message: `${listAdded((result as UploadOutcome).added)} loads after a reload or restart.`,
        }),
    },

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
        run: (target, versionId) => calls.installDatapack({ projectId: target.projectId, versionId }),
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
        run: (item) => calls.removeDatapack({ name: item.id }).then(() => undefined),
    },
});
