import { serverSoftware, serverStatus, serverVersion } from "../server";
import { installModpack, listModpackVersions, readModpack, removeModpack, searchModpacks } from "../modpacks";
import { SOFTWARE } from "../../software/catalog";
import { versionLabel } from "./presentation";
import type { ModpackRecord } from "../../core/modpack";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Modpacks: one Modrinth pack for the server's loader. Installing replaces
// the mod set and may switch the Minecraft version and loader build; the
// service does all of it (service/modpacks.ts).

export const loaderName = () => SOFTWARE[serverSoftware()].name;
const offline = () => serverStatus() === "offline";

export function installedModpack(pack: ModpackRecord): InstalledAddon {
    return {
        id: "modpack",
        title: pack.title,
        subtitle: `Minecraft ${pack.mcVersion} · ${loaderName()} ${pack.loaderVersion}`,
        iconUrl: pack.iconUrl,
        badge: { label: versionLabel(pack.versionNumber), variant: "success" },
        footer: `${pack.files.length} files`,
        project: { projectId: pack.projectId, slug: pack.slug },
        version: pack.versionNumber,
        uploaded: false,
    };
}

export const modpacksKind: AddonKind<ModpackRecord | null> = {
    title: "Modpacks",
    icon: "package_2",
    glyph: "package_2",
    noun: "modpack",
    modrinthPath: "modpack",
    browseUrl: "https://modrinth.com/modpacks",
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

    search: (query, signal) => searchModpacks(query, signal),
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
