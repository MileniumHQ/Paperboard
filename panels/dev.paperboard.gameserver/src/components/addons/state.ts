import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
import { errorMessage } from "../../lib/failure";
import { versionLabel } from "../../lib/addons/presentation";
import {
    defaultVersion,
    type AddonHit,
    type AddonKind,
    type AddonListing,
    type AddonTarget,
    type AddonUploadSource,
    type AddonVersion,
    type InstalledAddon,
} from "../../lib/addons/kind";
import { newStage, stageFolder } from "../../lib/addons/upload";

// The state every add-on tab shares: what is installed, the catalog search,
// the install dialog and the remove confirmation. Each is a function of the
// tab's AddonKind; the browser (AddonBrowser) wires them to the page.

const TYPING_DEBOUNCE_MS = 400;

export function createAddonListing<Meta>(kind: Accessor<AddonKind<Meta>>) {
    const [listing, setListing] = createSignal<AddonListing<Meta> | null>(null);
    const [error, setError] = createSignal("");
    // a read that finishes after a newer one started must not overwrite it
    let latest = 0;
    const reload = async () => {
        const current = ++latest;
        try {
            const next = await kind().list();
            if (current !== latest) return;
            setListing(() => next);
            setError("");
        } catch (err) {
            if (current !== latest) return;
            console.error(`[${kind().title}] Failed to list what is installed:`, err);
            setListing(null);
            setError(errorMessage(err));
        }
    };
    return { listing, error, reload };
}

export function createAddonSearch(kind: Accessor<Pick<AddonKind<unknown>, "title" | "search" | "source">>) {
    const [query, setQuery] = createSignal("");
    const [results, setResults] = createSignal<AddonHit[] | null>(null);
    const [searching, setSearching] = createSignal(false);
    const [error, setError] = createSignal("");
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
        clearTimeout(timer);
        controller?.abort();
    });

    /** searches now; a search still running is cancelled */
    const run = async () => {
        clearTimeout(timer);
        controller?.abort();
        const own = new AbortController();
        controller = own;
        setError("");
        setSearching(true);
        try {
            const hits = await kind().search(query().trim(), own.signal);
            if (!own.signal.aborted) setResults(hits);
        } catch (err) {
            if (own.signal.aborted) return;
            console.error(`[${kind().title}] ${kind().source.name} search failed:`, err);
            setError(errorMessage(err));
        } finally {
            if (controller === own) setSearching(false);
        }
    };

    /** searches once typing pauses */
    const type = (value: string) => {
        setQuery(value);
        clearTimeout(timer);
        timer = setTimeout(() => void run(), TYPING_DEBOUNCE_MS);
    };

    return { query, type, results, searching, error, run };
}

export function createAddonInstall<Meta>(
    kind: Accessor<AddonKind<Meta>>,
    hooks: { reload(): Promise<void>; installed(result: unknown): void },
) {
    const [target, setTarget] = createSignal<AddonTarget | null>(null);
    const [versions, setVersions] = createSignal<AddonVersion[] | null>(null);
    const [loading, setLoading] = createSignal(false);
    const [versionId, setVersionId] = createSignal("");
    const [error, setError] = createSignal("");
    const [installing, setInstalling] = createSignal(false);
    // a kind's dialog extras (dependency checks) hold the install until they are ready
    const [ready, setReady] = createSignal(true);
    const [payload, setPayload] = createSignal<unknown>(undefined);

    createEffect(
        on(target, (next) => {
            setVersions(null);
            setVersionId("");
            setError("");
            setReady(true);
            setPayload(undefined);
            if (!next) return;
            const projectId = next.projectId;
            const current = () => target()?.projectId === projectId;
            setLoading(true);
            kind()
                .versions(projectId)
                .then((list) => {
                    if (!current()) return;
                    setVersions(list);
                    setVersionId(defaultVersion(kind(), list)?.id ?? "");
                })
                .catch((err) => {
                    if (!current()) return;
                    console.error(`[${kind().title}] Failed to load versions of "${next.title}":`, err);
                    setError(errorMessage(err));
                })
                .finally(() => {
                    if (current()) setLoading(false);
                });
        }),
    );

    const chosen = () => versions()?.find((v) => v.id === versionId()) ?? null;
    const canConfirm = () =>
        target() !== null && versionId() !== "" && !installing() && !loading() && ready() && !kind().install.disabled?.();

    // the install runs in its owner either way; closing only stops showing it
    const close = () => {
        if (!installing()) setTarget(null);
    };

    const confirm = async () => {
        const next = target();
        if (!next || !canConfirm()) return;
        setInstalling(true);
        setError("");
        try {
            hooks.installed(await kind().install.run(next, versionId(), payload()));
            setTarget(null);
            await hooks.reload();
        } catch (err) {
            console.error(`[${kind().title}] Failed to install "${next.title}":`, err);
            setError(errorMessage(err));
            // a failure may come after a change that was recorded; show what is there now
            await hooks.reload();
        } finally {
            setInstalling(false);
        }
    };

    return {
        target,
        open: (next: AddonTarget) => setTarget(next),
        close,
        versions,
        loading,
        versionId,
        setVersionId,
        chosen,
        error,
        installing,
        canConfirm,
        confirm,
        report: (state: { ready: boolean; payload?: unknown }) => {
            setReady(state.ready);
            setPayload(() => state.payload);
        },
    };
}

export function createAddonRemove<Meta>(
    kind: Accessor<AddonKind<Meta>>,
    hooks: { reload(): Promise<void>; removed?(): void },
) {
    const [pending, setPending] = createSignal<InstalledAddon | null>(null);
    const [removing, setRemoving] = createSignal(false);
    const [error, setError] = createSignal("");

    const confirm = async () => {
        const item = pending();
        if (!item || removing() || kind().remove.disabled?.()) return;
        setRemoving(true);
        setError("");
        try {
            await kind().remove.run(item);
            setPending(null);
            hooks.removed?.();
            await hooks.reload();
        } catch (err) {
            // the dialog stays open: the entry is still on disk
            console.error(`[${kind().title}] Failed to remove "${item.id}":`, err);
            setError(errorMessage(err));
        } finally {
            setRemoving(false);
        }
    };

    return {
        pending,
        request: (item: InstalledAddon) => {
            setError("");
            setPending(item);
        },
        cancel: () => {
            if (!removing()) setPending(null);
        },
        removing,
        error,
        confirm,
    };
}

/** A project page opens for a catalog project, or for an installed entry the catalog does not know. */
export interface DetailTarget extends AddonTarget {
    /** set for an entry without a catalog project, which only its file identifies */
    local?: InstalledAddon;
}

const asTarget = (hit: AddonHit): AddonTarget => ({
    projectId: hit.projectId,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.iconUrl,
    dependencies: hit.dependencies,
});

/**
 * Everything one add-on tab keeps: what is installed, the search, the
 * install dialog, the remove confirmation and the project page. The tab
 * hands it to AddonBrowser to draw, and may read it for what is its own.
 */
export function createAddonBrowser<Meta = undefined>(options: {
    kind: AddonKind<Meta>;
    /** false while the tab is hidden; what is installed and found is read again when it opens */
    active?: Accessor<boolean>;
    /** an install finished; `result` is what the kind's install returned */
    installed?(result: unknown): void;
    removed?(): void;
}) {
    const { kind } = options;
    const get = () => kind;
    const { listing, error: listError, reload } = createAddonListing(get);
    const search = createAddonSearch(get);
    const install = createAddonInstall(get, { reload, installed: (result) => options.installed?.(result) });
    const remove = createAddonRemove(get, { reload, removed: () => options.removed?.() });
    const [detail, setDetail] = createSignal<DetailTarget | null>(null);
    const [recoverError, setRecoverError] = createSignal("");
    const [recovering, setRecovering] = createSignal(false);

    const [uploading, setUploading] = createSignal(false);
    const [uploadError, setUploadError] = createSignal("");
    const [uploadNotice, setUploadNotice] = createSignal<{ title: string; message: string } | null>(null);

    const busy = () => install.installing() || remove.removing() || uploading();

    const [pendingUpload, setPendingUpload] = createSignal<{ stage: string; name: string } | null>(null);

    /** removes what a pick staged, saying so when it cannot */
    const discardStage = async (stage: string, message = "") => {
        const way = kind.upload!;
        try {
            await way.discard(stage);
        } catch (cleanup) {
            console.error(`[${kind.title}] Could not remove the staged upload:`, cleanup);
            message += ` The files Paperboard staged could not be removed: ${errorMessage(cleanup)}`;
        }
        if (message) setUploadError(message.trim());
    };

    /** has the service check what is staged and add it */
    const commitUpload = async (stage: string) => {
        const way = kind.upload!;
        setUploading(true);
        try {
            const result = await way.commit(stage);
            options.installed?.(result);
            setUploadNotice(way.describe(result));
            await reload();
        } catch (err) {
            console.error(`[${kind.title}] Upload failed:`, err);
            // the service clears the staging folder when it got that far; stopping before it leaves the files
            await discardStage(stage, errorMessage(err));
            await reload();
        } finally {
            setUploading(false);
        }
    };

    /** copies the user's pick into a staging folder; the service checks and adds it, after a confirmation if the kind asks for one */
    const upload = async (source: AddonUploadSource) => {
        const way = kind.upload;
        if (!way || busy() || pendingUpload()) return;
        setUploading(true);
        setUploadError("");
        setUploadNotice(null);
        const stage = newStage();
        try {
            const picked = await source.pick(stageFolder(stage));
            if (picked.status === "canceled") return;
            if (way.confirm) {
                setPendingUpload({ stage, name: picked.name ?? "this file" });
                return;
            }
        } catch (err) {
            console.error(`[${kind.title}] Upload failed:`, err);
            await discardStage(stage, errorMessage(err));
            return;
        } finally {
            setUploading(false);
        }
        await commitUpload(stage);
    };

    const confirmUpload = async () => {
        const pending = pendingUpload();
        if (!pending) return;
        setPendingUpload(null);
        await commitUpload(pending.stage);
    };

    const cancelUpload = async () => {
        const pending = pendingUpload();
        if (!pending) return;
        setPendingUpload(null);
        await discardStage(pending.stage);
    };

    // what exists depends on the server, so the tab reads again whenever it opens
    createEffect(
        on([() => options.active?.() ?? true, () => kind.watch?.()], ([active]) => {
            if (!active) return;
            void reload();
            void search.run();
        }),
    );

    const installedProjects = () => new Set((listing()?.items ?? []).flatMap((item) => (item.project ? [item.project.projectId] : [])));

    /** the installed entry a project page is about */
    const entryOf = (target: DetailTarget | null): InstalledAddon | null => {
        if (!target) return null;
        return (
            listing()?.items.find((item) =>
                target.local
                    ? item.id === target.local.id
                    : item.project?.projectId === target.projectId || item.project?.slug === target.slug,
            ) ?? null
        );
    };

    const detailTarget = (item: InstalledAddon): DetailTarget =>
        item.project
            ? { projectId: item.project.projectId, slug: item.project.slug, title: item.title, description: "", iconUrl: item.iconUrl }
            : { projectId: item.id, slug: item.id, title: item.title, description: item.subtitle, local: item };

    return {
        kind,
        listing,
        listError,
        reload,
        search,
        install,
        remove,
        detail,
        closeDetail: () => setDetail(null),
        busy,
        installedProjects,
        entryOf,
        /** a search result was clicked */
        openResult: (hit: AddonHit) => (kind.detail ? setDetail(asTarget(hit)) : install.open(asTarget(hit))),
        /** an installed card was clicked */
        openItem: (item: InstalledAddon) => {
            if (kind.itemClick === "detail") setDetail(detailTarget(item));
            else if (kind.itemClick === "remove") remove.request(item);
        },
        /** a button on an installed card was clicked */
        itemAction: (item: InstalledAddon, does: "install" | "remove") => {
            if (does === "remove") remove.request(item);
            else if (item.project) {
                install.open({
                    projectId: item.project.projectId,
                    slug: item.project.slug,
                    title: item.title,
                    description: item.version ? `Installed: ${versionLabel(item.version)}` : "",
                    iconUrl: item.iconUrl,
                });
            }
        },
        upload,
        pendingUpload,
        confirmUpload,
        cancelUpload,
        uploading,
        uploadError,
        uploadNotice,
        dismissUploadNotice: () => setUploadNotice(null),
        recoverError,
        recovering,
        recover: async () => {
            const way = kind.recover;
            if (!way || recovering()) return;
            setRecovering(true);
            setRecoverError("");
            try {
                await way.run();
                await reload();
            } catch (err) {
                console.error(`[${kind.title}] ${way.label} failed:`, err);
                setRecoverError(errorMessage(err));
            } finally {
                setRecovering(false);
            }
        },
    };
}

export type AddonBrowserState<Meta = undefined> = ReturnType<typeof createAddonBrowser<Meta>>;
