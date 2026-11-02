import { createSignal } from "solid-js";
import { serverBridge, serverVersion } from "../server";
import { formatCount } from "./presentation";
import { discardUpload, listAdded, pickFiles } from "./upload";
import type { WorkshopItem, WorkshopMeta, WorkshopPage } from "../../games/steam/modscan";
import type { InstalledMod } from "../../games/terraria/modStore";
import type { AddonHit, AddonKind, AddonListing, AddonNotice, AddonSource, InstalledAddon } from "./kind";

// tModLoader's Mods: the Steam Workshop through modscan, searched and
// installed by the service (modscan sends no CORS headers, and SteamCMD runs
// there). The Workshop gives one build per item, so there is no version to
// choose; the service picks the folder this server's tModLoader can load.

/** what a mod change reports: its own result, and whether a running server must restart to load it */
export interface ModChange<T> {
    result: T;
    restart: boolean;
}

const STEAM = "https://store.steampowered.com/";

// Valve's terms ask for the attribution wherever results are; the last answer's
// meta is what the search card shows
const [meta, setMeta] = createSignal<WorkshopMeta | null>(null);
// what the last answers said about each item, for its page and its version line
const known = new Map<string, WorkshopItem>();

const remember = (page: WorkshopPage) => {
    setMeta(page.meta);
    for (const item of page.items) known.set(item.id, item);
    return page.items;
};

export const lookupMods = async (ids: string[]): Promise<WorkshopItem[]> =>
    remember(await serverBridge.call<WorkshopPage>("terraria-mod-items", { ids }));

/** what `ids` require, and what that requires in turn, as the service installs them */
export async function requiredChain(ids: string[]): Promise<WorkshopItem[]> {
    const found = new Map<string, WorkshopItem>();
    for (let next = ids, round = 0; next.length > 0 && round < 8; round++) {
        const items = await lookupMods(next);
        const missing = next.filter((id) => !items.some((i) => i.id === id));
        if (missing.length > 0) throw new Error(`Steam Workshop has no public item ${missing.join(", ")}, which this mod requires.`);
        for (const item of items) found.set(item.id, item);
        next = [...new Set(items.flatMap((i) => i.children ?? []))].filter((id) => !found.has(id));
    }
    return [...found.values()];
}

const lookupMod = async (id: string): Promise<WorkshopItem> => {
    const item = (await lookupMods([id])).find((i) => i.id === id);
    if (!item) throw new Error(`Steam Workshop has no public item ${id}`);
    return item;
};

const formatDate = (seconds: number) =>
    new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const mb = bytes / (1024 * 1024);
    return mb < 1024 ? `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

/** Steam's short descriptions are plain text; markdown must not read them as syntax */
const escapeMarkdown = (text: string) => text.replace(/([\\`*_{}[\]()#+\-.!|>~<])/g, "\\$1");

/** A card's blurb: authors open their short descriptions with banner and link addresses, which say nothing there */
export const cardDescription = (text: string) => text.replace(/\bhttps?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();

export const workshopHits = (items: WorkshopItem[]): AddonHit[] =>
    items.map((item) => ({
        projectId: item.id,
        slug: item.id,
        title: item.title,
        description: cardDescription(item.description),
        iconUrl: item.previewImageUrl ?? undefined,
        dependencies: item.children ?? undefined,
        stat: item.subscriptions === null ? `Updated ${formatDate(item.timeUpdated)}` : `${formatCount(item.subscriptions)} subscribers`,
    }));

export const workshopSource: AddonSource = {
    name: "Steam Workshop",
    url: "https://steamcommunity.com/app/1281930/workshop/",
    pageLabel: "Open on Steam Workshop",
    pageUrl: (target) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${target.projectId}`,
    async project(target) {
        const item = known.get(target.projectId) ?? (await lookupMod(target.projectId));
        return {
            title: item.title,
            description: item.description,
            iconUrl: item.previewImageUrl ?? undefined,
            body: escapeMarkdown(item.description),
            // an author's own hosts; nothing reviews them
            allowImages: false,
            info: [
                { label: "Subscribers", value: item.subscriptions === null ? "Unknown" : formatCount(item.subscriptions) },
                { label: "Favorites", value: item.favorites === null ? "Unknown" : formatCount(item.favorites) },
                { label: "Last Updated", value: formatDate(item.timeUpdated) },
                { label: "Size", value: formatSize(item.fileSize) },
                { label: "Tags", value: item.tags.length ? item.tags.join(", ") : "None" },
            ],
        };
    },
    notices(): AddonNotice[] {
        const terms = meta();
        if (!terms) return [];
        return [
            { text: "", link: { label: terms.attribution, href: terms.source || STEAM } },
            { text: terms.disclaimer },
            { text: terms.legal },
        ];
    },
};

export function installedMods(mods: InstalledMod[]): InstalledAddon[] {
    return mods.map((mod) => {
        const title = mod.record?.title ?? mod.info?.displayName ?? mod.file.replace(/\.tmod$/, "");
        const uploaded = mod.record?.uploaded === true;
        return {
            id: mod.file,
            title,
            subtitle: mod.file,
            iconUrl: mod.record?.previewImageUrl ?? undefined,
            badge: !mod.info
                ? { label: "Unreadable", variant: "warning" }
                : !mod.enabled
                  ? { label: "Off", variant: "warning" }
                  : uploaded
                    ? { label: "Uploaded", variant: "monochrome" }
                    : { label: "Installed", variant: "success" },
            footer: !mod.info
                ? (mod.problem ?? "Not a tModLoader mod")
                : !mod.enabled
                  ? "Not in enabled.json, so tModLoader skips it"
                  : `v${mod.info.version}`,
            project: mod.record?.workshopId ? { projectId: mod.record.workshopId, slug: mod.record.workshopId } : undefined,
            version: mod.info?.version,
            uploaded,
        };
    });
}

/** the notice after a change: what it did, and when the server loads it */
export const changeMessage = (did: string, restart: boolean) =>
    `${did} ${restart ? "Restart the server to load the change." : "It loads the next time the server starts."}`;

export const workshopModsKind: AddonKind = {
    title: "Mods",
    icon: "extension",
    glyph: "extension",
    noun: "mod",
    source: workshopSource,
    searchPlaceholder: "Search Mods",
    searchScope: () => "tModLoader mods",
    emptySearch: () => "No mods matched your search.",
    installedTitle: "Installed Mods",
    resultBadge: "Installed",

    async list(): Promise<AddonListing> {
        const { mods } = await serverBridge.call<{ mods: InstalledMod[] }>("terraria-mods");
        return { items: installedMods(mods), meta: undefined };
    },
    listFailureTitle: () => "Couldn't read tModLoader/Mods/",

    async search(query, signal) {
        const page = await serverBridge.call<WorkshopPage>("terraria-mod-search", {
            query,
            sort: query ? "relevance" : "subscriptions",
        });
        if (signal.aborted) return [];
        return workshopHits(remember(page));
    },
    async versions(projectId) {
        const item = known.get(projectId) ?? (await lookupMod(projectId));
        // one upload per item; the service picks the folder built for this tModLoader
        return [{ id: "latest", label: `Latest · updated ${formatDate(item.timeUpdated)}`, recommended: true }];
    },

    detail: true,
    itemClick: "detail",

    upload: {
        sources: [pickFiles("Upload mods", ["tmod"])],
        failureTitle: "Not added",
        // checking the files and their references waits on any running change
        commit: (stage) => serverBridge.call("terraria-mod-upload", { stage }, { timeoutMs: null }),
        discard: discardUpload,
        describe: (outcome) => {
            const { result, restart } = outcome as ModChange<{ added: string[] }>;
            return { title: "Added", message: changeMessage(`${listAdded(result.added)} ${result.added.length === 1 ? "is" : "are"} on.`, restart) };
        },
    },

    install: {
        title: (target) => `Install ${target.title}`,
        action: "Install",
        busyAction: "Installing…",
        icon: "download",
        errorTitle: "Install failed",
        noVersions: () => ({ title: "Nothing to install", text: `Steam Workshop has no file for tModLoader ${serverVersion()}.` }),
        // SteamCMD's first run updates itself, then downloads; minutes, not seconds
        run: (target, _versionId, payload) =>
            serverBridge.call<ModChange<string[]>>(
                "terraria-mod-install",
                { id: target.projectId, dependencies: Array.isArray(payload) ? payload : (target.dependencies ?? []) },
                { timeoutMs: null },
            ),
    },

    remove: {
        title: (item) => `Uninstall ${item.title}`,
        action: "Uninstall",
        busyAction: "Uninstalling…",
        errorTitle: "Couldn't uninstall",
        describe: () =>
            "This moves the mod out of tModLoader/Mods/ into a .trash folder inside the server folder, where it can be restored, and turns it off. The change takes effect after a restart.",
        run: async (item) => {
            await serverBridge.call("terraria-mod-remove", { file: item.id });
        },
    },
};
