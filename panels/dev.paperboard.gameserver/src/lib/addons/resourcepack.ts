import type { ServerPage } from "../server";
import { readServerPropertiesStrict } from "../properties";
import { searchProjects } from "../modrinth";
import type { ResourcePackView } from "../../service/resourcepack";
import { promptFromProperty, RESOURCEPACK_PROJECT_TYPE } from "../../core/resourcepack";
import { versionLabel } from "./presentation";
import { modrinthHits, modrinthSource } from "./sources";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Resource Pack: one pack at a time, written to server.properties. The
// service points the pack's URL and sha1 at a Modrinth build or a pasted
// URL; players download it from there, so there is nothing to upload.
// Modrinth search runs in the page like the Datapacks tab's.

export interface PackSettings {
    require: boolean;
    prompt: string;
    id: string;
}

export interface ResourcePackMeta {
    view: ResourcePackView;
    settings: PackSettings;
}

export function currentPack(view: ResourcePackView): InstalledAddon | null {
    if (!view.url) return null;
    const selection = view.selection;
    return {
        id: "resource-pack",
        title: selection?.title ?? "Custom resource pack",
        subtitle: view.url,
        iconUrl: selection?.iconUrl,
        badge: view.sha1 ? { label: "Verified", variant: "success" } : { label: "No sha1", variant: "warning" },
        footer: selection?.version ? versionLabel(selection.version) : selection ? "Direct URL" : "Set outside Paperboard",
        project: selection?.projectId && selection.slug ? { projectId: selection.projectId, slug: selection.slug } : undefined,
        version: selection?.version,
        uploaded: false,
    };
}

export const resourcePackKind = ({ calls, files, serverVersion }: ServerPage): AddonKind<ResourcePackMeta> => ({
    title: "Resource Pack",
    icon: "texture",
    glyph: "texture",
    noun: "resource pack",
    source: modrinthSource("resourcepack", "https://modrinth.com/resourcepacks"),
    searchScope: () => `Resource packs for Minecraft ${serverVersion()}`,
    emptySearch: () => `No resource packs for Minecraft ${serverVersion()} matched your search.`,
    installedTitle: "Current Resource Pack",
    resultBadge: "In use",
    watch: serverVersion,

    async list(): Promise<AddonListing<ResourcePackMeta>> {
        const [view, stored] = await Promise.all([calls.readResourcePack(), readServerPropertiesStrict(files)]);
        const current = currentPack(view);
        return {
            items: current ? [current] : [],
            meta: {
                view,
                settings: {
                    require: stored["require-resource-pack"] === "true",
                    prompt: promptFromProperty(stored["resource-pack-prompt"] ?? ""),
                    id: stored["resource-pack-id"] ?? "",
                },
            },
        };
    },
    listFailureTitle: () => "Couldn't read the resource pack settings",

    async search(query, signal) {
        const mcVersion = serverVersion();
        if (!mcVersion) throw new Error("Choose a server version before browsing resource packs.");
        return modrinthHits(await searchProjects({ query, signal, facets: [[`project_type:${RESOURCEPACK_PROJECT_TYPE}`], [`versions:${mcVersion}`]] }));
    },
    async versions(projectId) {
        return (await calls.listResourcePackVersions({ projectId })).map((v) => ({ id: v.id, label: v.versionNumber || v.name }));
    },

    itemClick: "none",
    itemActions: [{ label: "Remove", icon: "delete", does: "remove", variant: "danger" }],

    install: {
        title: (target) => `Use ${target.title}`,
        action: "Use pack",
        busyAction: "Setting…",
        icon: "check",
        errorTitle: (target) => `Couldn't use ${target.title}`,
        noVersions: () => ({
            title: "No compatible build",
            text: `This resource pack has no build for Minecraft ${serverVersion()}.`,
        }),
        run: (target, versionId) => calls.selectResourcePack({ projectId: target.projectId, versionId }),
    },

    remove: {
        title: () => "Remove resource pack",
        action: "Remove",
        busyAction: "Removing…",
        errorTitle: () => "Couldn't remove the resource pack",
        describe: (item) =>
            `Stop offering ${item.title} to players? server.properties no longer points at it. Players get the change the next time the server starts.`,
        run: () => calls.removeResourcePack().then(() => undefined),
    },
});
