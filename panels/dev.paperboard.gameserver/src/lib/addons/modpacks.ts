import { minecraftSoftware } from "../../games/minecraft/index";
import { serverSoftware, serverStatus, serverVersion } from "../server";
import { installModpack, listModpackVersions, readModpack, removeModpack, searchModpacks } from "../modpacks";
import { SOFTWARE } from "../../software/catalog";
import { versionLabel } from "./presentation";
import type { ModpackRecord } from "../../core/modpack";
import { commitModpack, discardUpload, pickModpackFile } from "./upload";
import { modrinthHits, modrinthSource } from "./sources";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Modpacks: one Modrinth pack for the server's loader. Installing replaces
// the mod set and may switch the Minecraft version and loader build; the
// service does all of it (service/modpacks.ts).

export const loaderName = () => SOFTWARE[minecraftSoftware(serverSoftware())].name;
const offline = () => serverStatus() === "offline";

export function installedModpack(pack: ModpackRecord): InstalledAddon {
    return {
        id: "modpack",
        title: pack.title,
        subtitle: `Minecraft ${pack.mcVersion} · ${loaderName()} ${pack.loaderVersion}`,
        iconUrl: pack.iconUrl,
        badge: pack.uploaded ? { label: "Uploaded", variant: "monochrome" } : { label: versionLabel(pack.versionNumber), variant: "success" },
        footer: `${versionLabel(pack.versionNumber)} · ${pack.files.length} files`,
        project: pack.projectId && pack.slug ? { projectId: pack.projectId, slug: pack.slug } : undefined,
        uploaded: pack.uploaded === true,
        version: pack.versionNumber,
    };
}

export const modpacksKind: AddonKind<ModpackRecord | null> = {
    title: "Modpacks",
    icon: "package_2",
    glyph: "package_2",
    noun: "modpack",
    source: modrinthSource("modpack", "https://modrinth.com/modpacks"),
    searchPlaceholder: "Search Modpacks",
    searchScope: () => `${loaderName()} modpacks that run on a server`,
    emptySearch: () => `No ${loaderName()} modpacks matched your search.`,
    installedTitle: "Installed Modpack",
    resultBadge: "Installed",
    watch: serverSoftware,

    async list(): Promise<AddonListing<ModpackRecord | null>> {
        const { modpack } = await readModpack();
        return { items: modpack ? [installedModpack(modpack)] : [], meta: modpack };
    },
    listFailureTitle: () => "Could not read the installed modpack",
    recover: {
        label: "Forget it (files stay)",
        errorTitle: "Not forgotten",
        disabled: () => !offline(),
        run: () => removeModpack().then(() => undefined),
    },

    search: async (query, signal) => modrinthHits(await searchModpacks(query, signal)),
    async versions(projectId) {
        return (await listModpackVersions(projectId)).map((v) => ({
            id: v.id,
            label: `${v.versionNumber || v.name} · Minecraft ${v.gameVersions.join(", ")}`,
            gameVersions: v.gameVersions,
        }));
    },
    // the newest for this Minecraft version, so a pick does not move the
    // server unasked; else the newest there is
    pickVersion: (versions) => versions.find((v) => v.gameVersions?.includes(serverVersion())) ?? versions[0],

    itemClick: "none",
    upload: {
        sources: [pickModpackFile("Upload .mrpack")],
        failureTitle: "Not installed",
        confirm: {
            title: "Install this modpack",
            text: "Every jar in mods/ moves to the server folder's trash, and configs the pack ships replace yours (the old ones go to the trash too). The server switches to the pack's Minecraft version and loader build if they differ; a world opened by a newer version cannot go back. Worlds and server.properties are kept.",
            action: "Install",
        },
        disabled: () => !offline(),
        commit: commitModpack,
        discard: discardUpload,
        // the tab shows the install's outcome like any other install
        describe: () => null,
    },
    itemActions: [
        { label: "Change version", icon: "update", does: "install", disabled: () => !offline() },
        { label: "Remove", icon: "delete", does: "remove", variant: "danger", disabled: () => !offline() },
    ],

    install: {
        title: (target) => `Install ${target.title}`,
        action: "Install",
        busyAction: "Installing…",
        icon: "download",
        errorTitle: "Not installed",
        noVersions: () => ({ title: "No compatible version", text: `This modpack has no ${loaderName()} version.` }),
        disabled: () => !offline(),
        run: (target, versionId) => installModpack(target.projectId, versionId),
    },

    remove: {
        title: () => "Remove modpack",
        action: "Remove",
        busyAction: "Removing…",
        errorTitle: "Not removed",
        describe: (item, listing) =>
            `Move the ${listing?.meta?.files.length} files ${item.title} placed into the server folder's trash? ${loaderName()} ${listing?.meta?.loaderVersion} stays installed, and so do mods and configs you added.`,
        disabled: () => !offline(),
        run: () => removeModpack().then(() => undefined),
    },
};
