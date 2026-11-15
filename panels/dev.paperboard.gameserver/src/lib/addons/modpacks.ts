import { minecraftSoftware } from "../../games/minecraft/index";
import type { ServerPage } from "../server";
import { searchProjects } from "../modrinth";
import { SOFTWARE } from "../../software/catalog";
import { versionLabel } from "./presentation";
import { MODPACK_LOADER, type ModpackRecord } from "../../core/modpack";
import { discardUpload, pickModpackFile } from "./upload";
import { modrinthHits, modrinthSource } from "./sources";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Modpacks: one Modrinth pack for the server's loader. Installing replaces
// the mod set and may switch the Minecraft version and loader build; the
// service does all of it (service/modpacks.ts). Modrinth search runs in the
// page like the Mods tab's.

export const loaderName = (software: string) => SOFTWARE[minecraftSoftware(software)].name;

export function installedModpack(pack: ModpackRecord, loader: string): InstalledAddon {
    return {
        id: "modpack",
        title: pack.title,
        subtitle: `Minecraft ${pack.mcVersion} · ${loader} ${pack.loaderVersion}`,
        iconUrl: pack.iconUrl,
        badge: pack.uploaded ? { label: "Uploaded", variant: "monochrome" } : { label: versionLabel(pack.versionNumber), variant: "success" },
        footer: `${versionLabel(pack.versionNumber)} · ${pack.files.length} files`,
        project: pack.projectId && pack.slug ? { projectId: pack.projectId, slug: pack.slug } : undefined,
        uploaded: pack.uploaded === true,
        version: pack.versionNumber,
    };
}

export function modpacksKind({ calls, files, serverSoftware, serverStatus, serverVersion }: ServerPage): AddonKind<ModpackRecord | null> {
    const loader = () => loaderName(serverSoftware());
    const offline = () => serverStatus() === "offline";
    return {
    title: "Modpacks",
    icon: "package_2",
    glyph: "package_2",
    noun: "modpack",
    source: modrinthSource("modpack", "https://modrinth.com/modpacks"),
    searchPlaceholder: "Search Modpacks",
    searchScope: () => `${loader()} modpacks that run on a server`,
    emptySearch: () => `No ${loader()} modpacks matched your search.`,
    installedTitle: "Installed Modpack",
    resultBadge: "Installed",
    watch: serverSoftware,

    async list(): Promise<AddonListing<ModpackRecord | null>> {
        const { modpack } = await calls.readModpack();
        return { items: modpack ? [installedModpack(modpack, loader())] : [], meta: modpack };
    },
    listFailureTitle: () => "Could not read the installed modpack",
    recover: {
        label: "Forget it (files stay)",
        errorTitle: "Not forgotten",
        disabled: () => !offline(),
        run: () => calls.removeModpack().then(() => undefined),
    },

    async search(query, signal) {
        const pack = MODPACK_LOADER[minecraftSoftware(serverSoftware())];
        if (!pack) return [];
        const hits = await searchProjects({
            query,
            signal,
            facets: [["project_type:modpack"], [`categories:${pack.modrinth}`], ["server_side:required", "server_side:optional"]],
            // the facet lets a few client-only packs through; they install nothing on a server
            keep: (hit) => hit.server_side !== "unsupported",
        });
        return modrinthHits(hits);
    },
    async versions(projectId) {
        return (await calls.listModpackVersions({ projectId })).map((v) => ({
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
        sources: [pickModpackFile(files, "Upload .mrpack")],
        failureTitle: "Not installed",
        confirm: {
            title: "Install this modpack",
            text: "Every jar in mods/ moves to the server folder's trash, and configs the pack ships replace yours (the old ones go to the trash too). The server switches to the pack's Minecraft version and loader build if they differ; a world opened by a newer version cannot go back. Worlds and server.properties are kept.",
            action: "Install",
        },
        disabled: () => !offline(),
        // reading, downloading and placing a pack runs for minutes: the contract waits it out
        commit: (stage) => calls.uploadModpack({ stage }),
        discard: discardUpload(calls),
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
        noVersions: () => ({ title: "No compatible version", text: `This modpack has no ${loader()} version.` }),
        disabled: () => !offline(),
        // downloading and placing a pack runs for minutes: the contract waits it out (progress arrives through state)
        run: (target, versionId) => calls.installModpack({ projectId: target.projectId, versionId }),
    },

    remove: {
        title: () => "Remove modpack",
        action: "Remove",
        busyAction: "Removing…",
        errorTitle: "Not removed",
        describe: (item, listing) =>
            `Move the ${listing?.meta?.files.length} files ${item.title} placed into the server folder's trash? ${loader()} ${listing?.meta?.loaderVersion} stays installed, and so do mods and configs you added.`,
        disabled: () => !offline(),
        run: () => calls.removeModpack().then(() => undefined),
    },
};
}
