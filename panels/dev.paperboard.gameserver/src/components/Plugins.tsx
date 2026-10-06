import {
    createEffect,
    createSignal,
    For,
    on,
    onMount,
    onCleanup,
    Show,
    type JSX,
} from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCheckbox,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperTable,
    PaperMarkdown,
    PaperText,
    getVarCss,
    PaperCard,
} from "@mileniumhq/paperui";
import { serverSoftware, serverVersion } from "../lib/server";
import { PaperPageHeader } from "@mileniumhq/paperui";
import {
    checkPluginUpdates,
    deletePlugin,
    getEcosystem,
    getProject,
    installProjectVersion,
    listInstalledPlugins,
    listProjectVersions,
    pluginDirName,
    pluginVersionWarning,
    previewInstall,
    searchModrinth,
    uninstallPlugin,
    updatePlugin,
    type InstalledPlugin,
    type InstallPreview,
    type ModrinthHit,
    type ModrinthProject,
    type PluginUpdateCheck,
    type ProjectVersionOption,
} from "../lib/plugins";

// Third-party markdown goes through PaperMarkdown, which renders PaperUI
// elements instead of HTML; images are allowed because Modrinth bodies are
// reviewed, host-scoped by the panel manifest and CSP-enforced.

function formatCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
}

function formatDate(iso: string): string {
    if (!iso) return "Unknown";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

interface DetailTarget {
    projectId: string;
    slug: string;
    title: string;
    description: string;
    iconUrl?: string;
}

function ProjectIcon(props: { iconUrl?: string; glyph?: string }): JSX.Element {
    return (
        <PaperAvatar
            src={props.iconUrl}
            shape="square"
            size="large"
            fallbackIcon={props.glyph ?? "extension"}
        />
    );
}

export default function Plugins(props: { updateRequest?: number }) {
    const [installed, setInstalled] = createSignal<InstalledPlugin[] | null>(null);
    const [listWarning, setListWarning] = createSignal("");
    const [query, setQuery] = createSignal("");
    const [results, setResults] = createSignal<ModrinthHit[]>([]);
    const [searching, setSearching] = createSignal(false);
    const [searched, setSearched] = createSignal(false);
    const [installingId, setInstallingId] = createSignal<string | null>(null);
    const [uninstallingFile, setUninstallingFile] = createSignal<string | null>(
        null,
    );
    const [pendingDelete, setPendingDelete] = createSignal<InstalledPlugin | null>(
        null,
    );
    const [deleteError, setDeleteError] = createSignal("");
    const [installTarget, setInstallTarget] = createSignal<DetailTarget | null>(null);
    const [installVersions, setInstallVersions] =
        createSignal<ProjectVersionOption[] | null>(null);
    const [installVersionsLoading, setInstallVersionsLoading] = createSignal(false);
    const [installSelectedVersionId, setInstallSelectedVersionId] = createSignal("");
    const [installPreview, setInstallPreview] = createSignal<InstallPreview | null>(null);
    const [installPreviewLoading, setInstallPreviewLoading] = createSignal(false);
    const [installOptional, setInstallOptional] = createSignal<string[]>([]);
    const [installModalError, setInstallModalError] = createSignal("");
    const [detail, setDetail] = createSignal<DetailTarget | null>(null);
    const [project, setProject] = createSignal<ModrinthProject | null>(null);
    const [projectLoading, setProjectLoading] = createSignal(false);
    const [error, setError] = createSignal("");

    const [updating, setUpdating] = createSignal(false);
    const [updateError, setUpdateError] = createSignal("");
    const [failures, setFailures] = createSignal<PluginUpdateCheck[] | null>(null);
    const [uninstallingFailure, setUninstallingFailure] =
        createSignal<string | null>(null);

    const eco = () => getEcosystem(serverSoftware());
    const kindLabel = () => eco()?.kind ?? "plugin";
    const searchTitle = () => (eco()?.kind === "mod" ? "Search Mods" : "Search Plugins");
    const busy = () => installingId() !== null || uninstallingFile() !== null;

    onMount(() => {
        void reloadInstalled();
        void runSearch();
    });

    const runUpdateCheck = async () => {
        if (updating()) return;
        setUpdating(true);
        setUpdateError("");
        try {
            const checks = await checkPluginUpdates();
            const available = checks.filter((c) => c.status === "update-available");
            // "incompatible" (no compatible build) AND "error" (no record /
            // lookup failed) both mean "we could not update this" — drop
            // neither silently
            const failed: PluginUpdateCheck[] = checks.filter(
                (c) => c.status === "incompatible" || c.status === "error",
            );
            for (const check of available) {
                try {
                    await updatePlugin(check);
                } catch (err) {
                    console.error(`[Plugins] Failed to update "${check.filename}":`, err);
                    failed.push({
                        ...check,
                        status: "error",
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            await reloadInstalled();
            if (failed.length > 0) setFailures(failed);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Plugins] Update check failed:", err);
            setUpdateError(message);
        } finally {
            setUpdating(false);
        }
    };

    const uninstallFailure = async (filename: string) => {
        setUninstallingFailure(filename);
        try {
            await uninstallPlugin(filename);
            setFailures((prev) =>
                (prev ?? []).filter((f) => f.filename !== filename),
            );
            await reloadInstalled();
        } catch (err) {
            console.error(`[Plugins] Failed to uninstall "${filename}":`, err);
            setUpdateError(err instanceof Error ? err.message : String(err));
        } finally {
            setUninstallingFailure(null);
        }
    };

    // the Versions tab hands off here after switching the server jar
    createEffect(
        on(
            () => props.updateRequest,
            (value) => {
                if (value && value > 0) void runUpdateCheck();
            },
        ),
    );

    const uninstallAllFailures = async () => {
        for (const failure of failures() ?? []) {
            await uninstallFailure(failure.filename);
        }
        setFailures(null);
    };

    createEffect(() => {
        const target = detail();
        setProject(null);
        if (!target) return;
        setProjectLoading(true);
        getProject(target.projectId)
            .then(setProject)
            .catch((err) => {
                console.error("[Plugins] Failed to load project details:", err);
            })
            .finally(() => setProjectLoading(false));
    });

    const reloadInstalled = async () => {
        try {
            const { plugins, warning } = await listInstalledPlugins();
            setInstalled(plugins);
            setListWarning(warning ?? "");
        } catch (err) {
            console.error("[Plugins] Failed to list installed plugins:", err);
            setListWarning("");
            setError(
                `Failed to read the ${pluginDirName(serverSoftware())}/ directory. Check the console for details.`,
            );
        }
    };

    let searchController: AbortController | undefined;
    onCleanup(() => searchController?.abort());
    const runSearch = async () => {
        searchController?.abort();
        const controller = new AbortController();
        searchController = controller;
        setError("");
        setResults([]);
        setSearching(true);
        setSearched(true);
        try {
            const hits = await searchModrinth(query().trim(), controller.signal);
            if (!controller.signal.aborted) setResults(hits);
        } catch (err) {
            if (controller.signal.aborted) return;
            console.error("[Plugins] Modrinth search failed:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (searchController === controller) setSearching(false);
        }
    };

    const findInstalled = (target: DetailTarget): InstalledPlugin | null =>
        installed()?.find(
            (entry) =>
                entry.record &&
                (entry.record.projectId === target.projectId ||
                    entry.record.slug === target.slug),
        ) ?? null;

    const previewToken = () =>
        `${installTarget()?.projectId ?? ""}:${installSelectedVersionId()}:${[...installOptional()].sort().join(",")}`;

    // opening the modal loads the version list; picking a version (or
    // toggling an optional dep) resolves the preview. Stale responses are
    // dropped by token so a quick reselection can't show the wrong version.
    createEffect(() => {
        const target = installTarget();
        setInstallVersions(null);
        setInstallSelectedVersionId("");
        setInstallPreview(null);
        setInstallOptional([]);
        setInstallModalError("");
        if (!target) return;
        const captured = target.projectId;
        setInstallVersionsLoading(true);
        listProjectVersions(target.projectId)
            .then((options) => {
                if (installTarget()?.projectId !== captured) return;
                setInstallVersions(options);
                const recommended =
                    options.find((o) => o.recommended) ?? options[0];
                if (recommended?.versionId) {
                    setInstallSelectedVersionId(recommended.versionId);
                }
            })
            .catch((err) => {
                if (installTarget()?.projectId !== captured) return;
                setInstallModalError(
                    err instanceof Error ? err.message : String(err),
                );
            })
            .finally(() => {
                if (installTarget()?.projectId === captured) {
                    setInstallVersionsLoading(false);
                }
            });
    });

    createEffect(() => {
        const target = installTarget();
        const versionId = installSelectedVersionId();
        const checked = installOptional();
        setInstallPreview(null);
        if (!target || !versionId) return;
        const token = previewToken();
        setInstallPreviewLoading(true);
        previewInstall(target.projectId, target.title, versionId, checked)
            .then((preview) => {
                if (previewToken() !== token) return;
                setInstallPreview(preview);
            })
            .catch((err) => {
                if (previewToken() !== token) return;
                setInstallModalError(
                    err instanceof Error ? err.message : String(err),
                );
            })
            .finally(() => {
                if (previewToken() === token) setInstallPreviewLoading(false);
            });
    });

    const closeInstallModal = () => {
        setInstallTarget(null);
        setInstallVersions(null);
        setInstallSelectedVersionId("");
        setInstallPreview(null);
        setInstallOptional([]);
        setInstallModalError("");
    };

    const canConfirmInstall = () => {
        const target = installTarget();
        const preview = installPreview();
        if (
            !target ||
            !installSelectedVersionId() ||
            installingId() ||
            installVersionsLoading() ||
            installPreviewLoading() ||
            !preview ||
            !preview.mainFile
        ) {
            return false;
        }
        return preview.failures.length === 0;
    };

    const confirmInstallModal = async () => {
        const target = installTarget();
        const versionId = installSelectedVersionId();
        if (!target || !versionId || installingId()) return;
        setInstallingId(target.projectId);
        setInstallModalError("");
        try {
            await installProjectVersion({
                projectId: target.projectId,
                slug: target.slug,
                title: target.title,
                iconUrl: target.iconUrl,
                versionId,
                includeOptionalKeys: installOptional(),
            });
            closeInstallModal();
            await reloadInstalled();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Plugins] Failed to install "${target.title}":`, err);
            setInstallModalError(message);
        } finally {
            setInstallingId(null);
        }
    };

    const confirmDelete = async () => {
        const target = pendingDelete();
        if (!target) return;
        setUninstallingFile(target.filename);
        setDeleteError("");
        try {
            await deletePlugin(target.filename);
            await reloadInstalled();
            setPendingDelete(null);
        } catch (err) {
            // the modal stays open: a delete that failed must say why, not
            // close as if the jar were gone (it is still on disk)
            console.error(`[Plugins] Failed to delete "${target.filename}":`, err);
            setDeleteError(
                err instanceof Error ? err.message : String(err),
            );
        } finally {
            setUninstallingFile(null);
        }
    };

    const detailInstalled = () => {
        const target = detail();
        return target ? findInstalled(target) : null;
    };

    const detailSummary = () => {
        if (detail()?.description) return detail()!.description;
        return project()?.description || "";
    };

    const detailBody = () => project()?.body ?? "";

    const renderCardIcon = (iconUrl?: string): JSX.Element => (
        <PaperAvatar src={iconUrl} shape="square" size="large" fallbackIcon="extension" />
    );

    return (
        <>
                    <PaperPageHeader
                        icon="extension"
                        title={kindLabel() === "mod" ? "Mods" : "Plugins"}
                    >
                        <PaperEffect variant="primary">
                            <PaperButton
                                disabled={updating()}
                                onClick={() => void runUpdateCheck()}>
                                <PaperIcon>sync</PaperIcon>
                                {updating() ? "Updating…" : "Update plugins"}
                            </PaperButton>
                        </PaperEffect>
                    </PaperPageHeader>
                    <PaperCard>
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperInput
                                fullWidth
                                icon="search"
                                placeholder={searchTitle()}
                                value={query()}
                                onInput={(e) => setQuery(e.currentTarget.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") void runSearch();
                                }}
                            />
                            <PaperText size={2} color="text-subtle">
                                Projects provided by{" "}
                                <PaperLink href="https://modrinth.com" target="_blank">Modrinth</PaperLink>.
                            </PaperText>
                            <Show when={error()}>
                                <PaperQuote variant="danger" icon="warning" title="Error">
                                    {error()}
                                    <PaperButton onClick={() => void runSearch()} disabled={searching()}>
                                        Retry search
                                    </PaperButton>
                                </PaperQuote>
                            </Show>
                            <Show when={listWarning()}>
                                <PaperQuote variant="warning" icon="warning" title="Warning">
                                    {listWarning()}
                                </PaperQuote>
                            </Show>
                            <Show when={updateError()}>
                                <PaperQuote variant="danger" icon="warning" title="Update error">
                                    {updateError()}
                                </PaperQuote>
                            </Show>
                        </PaperFlex>
                    </PaperCard>

                    <PaperFlex direction="column" gap="full">
                    <Show when={installed() !== null && installed()!.length > 0}>
                        <PaperCard>
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperText size={5} weight={700}>
                                Installed {kindLabel() === "mod" ? "Mods" : "Plugins"}
                            </PaperText>
                            <PaperMediaCardGroup minCardWidth={getVarCss("size-card-min")}>
                                <For each={installed()}>
                                    {(entry) => (
                                        <PaperMediaCard
                                            icon={
                                                entry.record?.iconUrl
                                                    ? renderCardIcon(entry.record.iconUrl)
                                                    : undefined
                                            }
                                            title={
                                                entry.record?.title ??
                                                entry.record?.slug ??
                                                entry.filename.replace(/\.jar$/i, "")
                                            }
                                            subtitle={entry.filename}
                                            badge={
                                                <PaperBadge variant="success">
                                                    Installed
                                                </PaperBadge>
                                            }
                                            footerLeft={
                                                <PaperText size={2} color="text-subtle">
                                                    {entry.record?.version
                                                        ? `v${entry.record.version}`
                                                        : "Unknown version"}
                                                </PaperText>
                                            }
                                            onClick={() =>
                                                entry.record
                                                    ? setDetail({
                                                          projectId: entry.record.projectId,
                                                          slug: entry.record.slug,
                                                          title:
                                                              entry.record.title ??
                                                              entry.record.slug,
                                                          description: "",
                                                          iconUrl: entry.record.iconUrl,
                                                      })
                                                    : setDetail({
                                                          projectId: entry.filename.replace(
                                                              /\.jar$/i,
                                                              "",
                                                          ),
                                                          slug: entry.filename.replace(
                                                              /\.jar$/i,
                                                              "",
                                                          ),
                                                          title: entry.filename.replace(
                                                              /\.jar$/i,
                                                              "",
                                                          ),
                                                          description: entry.filename,
                                                      })
                                            }
                                        />
                                    )}
                                </For>
                            </PaperMediaCardGroup>
                        </PaperFlex>
                        </PaperCard>
                    </Show>

                    <Show when={searching()}>
                        <PaperCard>
                        <PaperFlex padding="full" center>
                            <PaperText size={3} color="text-subtle">
                                Searching Modrinth...
                            </PaperText>
                        </PaperFlex>
                        </PaperCard>
                    </Show>

                    <Show when={!searching() && searched() && !error()}>
                        <Show
                            when={results().length > 0}
                            fallback={
                                <PaperCard>
                                <PaperFlex padding="full" center>
                                    <PaperText size={3} color="text-subtle">
                                        No {kindLabel()}s matched your search.
                                    </PaperText>
                                </PaperFlex>
                                </PaperCard>
                            }
                        >
                            <PaperCard>
                            <PaperFlex padding="full">
                            <PaperMediaCardGroup minCardWidth={getVarCss("size-card-min")}>
                                    <For each={results()}>
                                        {(hit) => (
                                            <PaperMediaCard
                                                icon={hit.iconUrl ? renderCardIcon(hit.iconUrl) : undefined}
                                                title={hit.title}
                                                subtitle={truncate(hit.description, 110)}
                                                footerLeft={
                                                    <PaperText size={2} color="text-subtle">
                                                        {formatCount(hit.downloads)} downloads
                                                    </PaperText>
                                                }
                                                onClick={() =>
                                                    setDetail({
                                                        projectId: hit.projectId,
                                                        slug: hit.slug,
                                                        title: hit.title,
                                                        description: hit.description,
                                                        iconUrl: hit.iconUrl,
                                                    })
                                                }
                                            />
                                        )}
                                    </For>
                                </PaperMediaCardGroup>
                            </PaperFlex>
                            </PaperCard>
                        </Show>
                    </Show>
                </PaperFlex>

            <PaperModal
                open={detail() !== null}
                onClose={() => setDetail(null)}
                size="large"
                noHeader
            >
                <Show when={detail()} keyed>
                    {(target) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperFlex direction="row" gap="full" align="center">
                                <ProjectIcon
                                    iconUrl={project()?.iconUrl ?? target.iconUrl}
                                />

                                <PaperFlex
                                    direction="column"
                                    gap="onefourth"
                                    style={{ flex: 1, "min-width": 0 }}
                                >
                                    <PaperLink href={`https://modrinth.com/project/${target.slug}`}>
                                        Open at Modrinth.com
                                    </PaperLink>
                                    <PaperText size={5} weight={700}>
                                        {project()?.title ?? target.title}
                                    </PaperText>
                                    <PaperText size={2} color="text-subtle">
                                        {truncate(detailSummary(), 200)}
                                    </PaperText>
                                </PaperFlex>

                                <Show
                                    when={detailInstalled()}
                                    keyed
                                    fallback={
                                        <PaperEffect variant="success">
                                            <PaperButton
                                                variant="success"
                                                disabled={busy()}
                                                onClick={() => setInstallTarget(target)}
                                            >
                                                <PaperIcon>
                                                    {installingId() === target.projectId
                                                        ? "hourglass_top"
                                                        : "download"}
                                                </PaperIcon>
                                                Install
                                            </PaperButton>
                                        </PaperEffect>
                                    }
                                >
                                    {(entry) => (
                                        <PaperEffect variant="danger">
                                            <PaperButton
                                                variant="danger"
                                                disabled={busy()}
                                                onClick={() => {
                                                    setDeleteError("");
                                                    setPendingDelete(entry);
                                                }}
                                            >
                                                <PaperIcon>delete</PaperIcon>
                                                Uninstall
                                            </PaperButton>
                                        </PaperEffect>
                                    )}
                                </Show>
                            </PaperFlex>

                            <PaperFlex direction="column" gap="onefourth">
                                <PaperText size={3} weight={700}>
                                    About
                                </PaperText>
                                <Show
                                    when={!projectLoading()}
                                    fallback={
                                        <PaperText size={2} color="text-subtle">
                                            Loading details from Modrinth...
                                        </PaperText>
                                    }
                                >
                                    <Show
                                        when={detailBody()}
                                        fallback={
                                            <PaperText size={2} color="text-subtle">
                                                No description provided.
                                            </PaperText>
                                        }
                                    >
                                        <PaperMarkdown
                                            text={detailBody()}
                                            allowImages
                                        />
                                    </Show>
                                </Show>
                            </PaperFlex>

                            <PaperFlex direction="column" gap="onefourth">
                                <PaperText size={3} weight={700}>
                                    Information
                                </PaperText>
                                <PaperTable>
                                    <tbody>
                                        <tr>
                                            <th>Downloads</th>
                                            <td>
                                                {formatCount(
                                                    project()?.downloads ?? 0,
                                                )}
                                            </td>
                                        </tr>
                                        <tr>
                                            <th>Follows</th>
                                            <td>
                                                {formatCount(project()?.follows ?? 0)}
                                            </td>
                                        </tr>
                                        <tr>
                                            <th>Last Updated</th>
                                            <td>{formatDate(project()?.dateModified ?? "")}</td>
                                        </tr>
                                        <tr>
                                            <th>License</th>
                                            <td>{project()?.license ?? "Unknown"}</td>
                                        </tr>
                                        <tr>
                                            <th>Loaders</th>
                                            <td>
                                                {project()?.loaders.length
                                                    ? project()!
                                                          .loaders.map((l) =>
                                                              l.charAt(0).toUpperCase() + l.slice(1),
                                                          )
                                                          .join(", ")
                                                    : "Unknown"}
                                            </td>
                                        </tr>
                                        <tr>
                                            <th>Installed Version</th>
                                            <td>
                                                {detailInstalled()?.record?.version
                                                    ? `v${detailInstalled()!.record!.version}`
                                                    : "Not installed"}
                                            </td>
                                        </tr>
                                    </tbody>
                                </PaperTable>
                            </PaperFlex>
                        </PaperFlex>
                    )}
                </Show>
            </PaperModal>

            <PaperModal
                open={installTarget() !== null}
                onClose={closeInstallModal}
                title={
                    installTarget() ? `Install ${installTarget()!.title}` : "Install"
                }
                size="medium"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={closeInstallModal}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={!canConfirmInstall()}
                            onClick={() => void confirmInstallModal()}>
                            <PaperIcon>
                                {installingId() ? "hourglass_top" : "download"}
                            </PaperIcon>
                            {installingId() ? "Installing…" : "Install"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <Show when={installTarget()} keyed>
                    {(target) => (
                        <PaperFlex direction="column" gap="half">
                            <PaperText size={3} weight={700}>
                                Version
                            </PaperText>
                            <Show
                                when={!installVersionsLoading()}
                                fallback={
                                    <PaperText size={2} color="text-subtle">
                                        Loading versions...
                                    </PaperText>
                                }
                            >
                                <PaperSelectMenu
                                    name="installVersion"
                                    fullWidth
                                    value={installSelectedVersionId()}
                                    onValueChange={(val) =>
                                        setInstallSelectedVersionId(String(val))
                                    }
                                >
                                    <For each={installVersions() ?? []}>
                                        {(option) => (
                                            <PaperSelectMenuItem value={option.versionId}>
                                                {`v${option.versionNumber || "?"}${option.recommended ? " · Recommended" : ""}`}
                                            </PaperSelectMenuItem>
                                        )}
                                    </For>
                                </PaperSelectMenu>
                            </Show>

                            <Show when={!installPreviewLoading() && installPreview()}>
                                {(preview) => (
                                    <>
                                        <Show when={!preview().matchesServer}>
                                            <PaperQuote
                                                variant="warning"
                                                icon="warning"
                                                title="Different Minecraft version"
                                            >
                                                {pluginVersionWarning(
                                                    preview().gameVersions,
                                                    serverVersion(),
                                                )}
                                            </PaperQuote>
                                        </Show>

                                        <Show when={preview().required.length > 0}>
                                            <PaperText size={3} weight={700}>
                                                Also installs (required)
                                            </PaperText>
                                            <For each={preview().required}>
                                                {(dep) => (
                                                    <PaperFlex
                                                        direction="row"
                                                        justify="space-between"
                                                        align="center"
                                                        gap="half"
                                                        fullWidth
                                                    >
                                                        <PaperText size={3}>{dep.name}</PaperText>
                                                        <PaperText size={2} color="text-subtle">
                                                            {dep.file
                                                                ? `v${dep.versionNumber || "?"}${dep.gameVersions.length > 0 ? ` · ${dep.gameVersions.join(", ")}` : ""}`
                                                                : (dep.unresolvableReason ??
                                                                  "Could not resolve")}
                                                        </PaperText>
                                                    </PaperFlex>
                                                )}
                                            </For>
                                        </Show>

                                        <Show when={preview().optional.length > 0}>
                                            <PaperText size={3} weight={700}>
                                                Optional
                                            </PaperText>
                                            <For each={preview().optional}>
                                                {(dep) => (
                                                    <PaperCheckbox
                                                        checked={installOptional().includes(dep.key)}
                                                        disabled={!dep.file || installingId() !== null}
                                                        onChange={(checked) =>
                                                            setInstallOptional((prev) =>
                                                                checked
                                                                    ? [...prev, dep.key]
                                                                    : prev.filter((k) => k !== dep.key),
                                                            )
                                                        }
                                                        label={dep.name}
                                                        description={
                                                            dep.file
                                                                ? `v${dep.versionNumber || "?"}${dep.gameVersions.length > 0 ? ` · ${dep.gameVersions.join(", ")}` : ""}`
                                                                : (dep.unresolvableReason ??
                                                                  "Could not resolve")
                                                        }
                                                    />
                                                )}
                                            </For>
                                        </Show>

                                        <Show when={preview().transitive.length > 0}>
                                            <PaperText size={2} color="text-subtle">
                                                Also pulls in:{" "}
                                                {preview()
                                                    .transitive.map((dep) => dep.name)
                                                    .join(", ")}
                                            </PaperText>
                                        </Show>

                                        <Show when={preview().incompatible.length > 0}>
                                            <PaperQuote
                                                variant="warning"
                                                icon="warning"
                                                title="Incompatible with this version"
                                            >
                                                Do not install alongside:{" "}
                                                {preview()
                                                    .incompatible.map((dep) => dep.name)
                                                    .join(", ")}
                                            </PaperQuote>
                                        </Show>

                                        <Show when={preview().embedded.length > 0}>
                                            <PaperText size={2} color="text-subtle">
                                                Bundled:{" "}
                                                {preview()
                                                    .embedded.map((dep) => dep.name)
                                                    .join(", ")}
                                            </PaperText>
                                        </Show>
                                    </>
                                )}
                            </Show>

                            <Show when={installPreviewLoading()}>
                                <PaperText size={2} color="text-subtle">
                                    Resolving dependencies...
                                </PaperText>
                            </Show>

                            <Show when={installModalError()}>
                                <PaperQuote variant="danger" icon="warning" title="Install failed">
                                    {installModalError()}
                                </PaperQuote>
                            </Show>
                        </PaperFlex>
                    )}
                </Show>
            </PaperModal>

            <PaperModal
                open={pendingDelete() !== null}
                onClose={() => {
                    if (uninstallingFile() === null) setPendingDelete(null);
                }}
                title={`Uninstall ${pendingDelete()?.filename ?? ""}`}
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton
                            disabled={uninstallingFile() !== null}
                            onClick={() => setPendingDelete(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={uninstallingFile() !== null}
                            onClick={() => void confirmDelete()}>
                            {uninstallingFile() !== null ? "Uninstalling…" : "Uninstall"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    This moves the jar out of the server's{" "}
                    {pluginDirName(serverSoftware())}/ folder into a .trash
                    folder inside the server folder, where it can be restored.
                    The change takes effect after a restart.
                </PaperText>
                <Show when={deleteError()}>
                    <PaperQuote variant="danger" icon="warning" title="Couldn't uninstall">
                        {deleteError()}
                    </PaperQuote>
                </Show>
            </PaperModal>

            <PaperModal
                open={failures() !== null && failures()!.length > 0}
                onClose={() => setFailures(null)}
                title="Couldn't update these plugins"
                size="medium"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton
                            variant="danger"
                            disabled={uninstallingFailure() !== null}
                            onClick={() => void uninstallAllFailures()}>
                            Uninstall all
                        </PaperButton>
                        <PaperButton onClick={() => setFailures(null)}>
                            Close
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        These plugins have no build for your server's software and
                        Minecraft version. They may crash the server on startup.
                        Uninstall the ones you no longer need.
                    </PaperText>
                    <For each={failures() ?? []}>
                        {(failure) => (
                            <PaperFlex
                                direction="row"
                                justify="space-between"
                                align="center"
                                gap="half"
                                fullWidth
                            >
                                <PaperFlex
                                    direction="column"
                                    gap="onefourth"
                                    style={{ "min-width": 0 }}
                                >
                                    <PaperText size={3} weight={600}>
                                        {failure.title}
                                    </PaperText>
                                    <PaperText size={2} color="text-subtle">
                                        {failure.status === "incompatible"
                                            ? `No compatible build (latest targets ${
                                                  failure.latest?.gameVersions.join(", ") ||
                                                  "another version"
                                              })`
                                            : (failure.error ?? "Update failed")}
                                    </PaperText>
                                </PaperFlex>
                                <PaperButton
                                    variant="danger"
                                    disabled={
                                        uninstallingFailure() === failure.filename
                                    }
                                    onClick={() => void uninstallFailure(failure.filename)}>
                                    <PaperIcon>delete</PaperIcon>
                                    Uninstall
                                </PaperButton>
                            </PaperFlex>
                        )}
                    </For>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
