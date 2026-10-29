import { serverVersion } from "../server";
import { readServerPropertiesStrict } from "../properties";
import {
    listResourcePackVersions,
    readResourcePack,
    removeResourcePack,
    searchResourcePacks,
    selectModrinthResourcePack,
    type ResourcePackView,
} from "../resourcepack";
import { promptFromProperty } from "../../core/resourcepack";
import { versionLabel } from "./presentation";
import type { AddonKind, AddonListing, InstalledAddon } from "./kind";

// Resource Pack: one pack at a time, written to server.properties. The
// service points the pack's URL and sha1 at a Modrinth build or a pasted
// URL; players download it from there, so there is nothing to upload.

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

export const resourcePackKind: AddonKind<ResourcePackMeta> = {
    title: "Resource Pack",
    icon: "texture",
    glyph: "texture",
    noun: "resource pack",
    modrinthPath: "resourcepack",
    browseUrl: "https://modrinth.com/resourcepacks",
    searchPlaceholder: "Search Resource Packs",
    searchScope: () => `Resource packs for Minecraft ${serverVersion()}`,
    emptySearch: () => `No resource packs for Minecraft ${serverVersion()} matched your search.`,
    installedTitle: "Current Resource Pack",
    resultBadge: "In use",
    watch: serverVersion,

    async list(): Promise<AddonListing<ResourcePackMeta>> {
        const [view, stored] = await Promise.all([readResourcePack(), readServerPropertiesStrict()]);
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

    search: (query, signal) => searchResourcePacks(query, signal),
    async versions(projectId) {
        return (await listResourcePackVersions(projectId)).map((v) => ({ id: v.id, label: v.versionNumber || v.name }));
    },

    itemClick: "none",
    itemActions: [{ label: "Remove", icon: "delete", does: "remove", variant: "danger" }],

    install: {
        title: (target) => `Use ${target.title}`,
        action: "Use pack",
        busyAction: "Setting…",
        icon: "check",
        errorTitle: "Resource pack not set",
        noVersions: () => ({
            title: "No compatible build",
            text: `This resource pack has no build for Minecraft ${serverVersion()}.`,
        }),
        run: (target, versionId) => selectModrinthResourcePack(target.projectId, versionId),
    },

    remove: {
        title: () => "Remove resource pack",
        action: "Remove",
        busyAction: "Removing…",
        errorTitle: "Resource pack not removed",
        describe: (item) =>
            `Stop offering ${item.title} to players? server.properties no longer points at it. Players get the change the next time the server starts.`,
        run: () => removeResourcePack().then(() => undefined),
    },
};
