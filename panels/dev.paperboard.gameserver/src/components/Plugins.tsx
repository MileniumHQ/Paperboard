import {
    createEffect,
    createSignal,
    For,
    onMount,
    Show,
    type JSX,
} from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperQuote,
    PaperSettingList,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { serverSoftware } from "../lib/server";
import {
    deletePlugin,
    getEcosystem,
    getProject,
    installProject,
    listInstalledPlugins,
    pluginDirName,
    PluginVersionMismatchError,
    searchModrinth,
    type InstalledPlugin,
    type ModrinthHit,
    type ModrinthProject,
} from "../lib/plugins";

// Third-party markdown is rendered with marked, then sanitized before touching the DOM
marked.use({ async: false, breaks: true });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer nofollow");
    }
});

const SANITIZE_CONFIG = {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form"],
    FORBID_ATTR: ["style"],
};

function renderDescriptionBody(md: string): string {
    return DOMPurify.sanitize(marked.parse(md) as string, SANITIZE_CONFIG);
}

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
        <Show
            when={props.iconUrl}
            fallback={
                <span style={{ "font-size": "4.5rem" }}>
                    {props.glyph ?? "extension"}
                </span>
            }
        >
            <img
                src={props.iconUrl}
                alt=""
                style={{
                    width: "4.5rem",
                    height: "4.5rem",
                    "border-radius": "var(--paper-border-radius)",
                    "object-fit": "contain",
                    background: "rgba(128,128,128,0.12)",
                }}
            />
        </Show>
    );
}

export default function Plugins() {
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
    const [pendingCrossVersion, setPendingCrossVersion] = createSignal<{
        target: DetailTarget;
        mismatch: PluginVersionMismatchError;
    } | null>(null);
    const [detail, setDetail] = createSignal<DetailTarget | null>(null);
    const [project, setProject] = createSignal<ModrinthProject | null>(null);
    const [projectLoading, setProjectLoading] = createSignal(false);
    const [error, setError] = createSignal("");

    const eco = () => getEcosystem(serverSoftware());
    const kindLabel = () => eco()?.kind ?? "plugin";
    const searchTitle = () => (eco()?.kind === "mod" ? "Search Mods" : "Search Plugins");
    const busy = () => installingId() !== null || uninstallingFile() !== null;

    onMount(() => {
        void reloadInstalled();
    });

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

    const runSearch = async () => {
        setError("");
        setSearching(true);
        setSearched(true);
        try {
            setResults(await searchModrinth(query().trim()));
        } catch (err) {
            console.error("[Plugins] Modrinth search failed:", err);
            setResults([]);
            setError("Modrinth search failed. Check the console for details.");
        } finally {
            setSearching(false);
        }
    };

    const findInstalled = (target: DetailTarget): InstalledPlugin | null =>
        installed()?.find(
            (entry) =>
                entry.record &&
                (entry.record.projectId === target.projectId ||
                    entry.record.slug === target.slug),
        ) ?? null;

    const install = async (target: DetailTarget, allowIncompatible = false) => {
        setInstallingId(target.projectId);
        setError("");
        try {
            await installProject(
                target.projectId,
                allowIncompatible ? { allowIncompatible: true } : undefined,
            );
            await reloadInstalled();
        } catch (err) {
            // cross-version builds never install silently: the mismatch
            // becomes an explicit confirm, install-anyway is one click away
            if (err instanceof PluginVersionMismatchError) {
                setPendingCrossVersion({ target, mismatch: err });
                return;
            }
            console.error(`[Plugins] Failed to install "${target.title}":`, err);
            setError(
                `Failed to install "${target.title}". Check the console for details.`,
            );
        } finally {
            setInstallingId(null);
        }
    };

    const confirmCrossVersionInstall = async () => {
        const pending = pendingCrossVersion();
        setPendingCrossVersion(null);
        if (!pending) return;
        await install(pending.target, true);
    };

    const confirmDelete = async () => {
        const target = pendingDelete();
        setPendingDelete(null);
        if (!target) return;
        setUninstallingFile(target.filename);
        setError("");
        try {
            await deletePlugin(target.filename);
            await reloadInstalled();
        } catch (err) {
            console.error(`[Plugins] Failed to delete "${target.filename}":`, err);
            setError(
                `Failed to delete "${target.filename}". Check the console for details.`,
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

    const detailBody = () => {
        const p = project();
        return p ? renderDescriptionBody(p.body) : "";
    };

    const renderCardIcon = (iconUrl?: string): JSX.Element => (
        <img
            src={iconUrl}
            alt=""
            style={{
                width: "4.5rem",
                height: "4.5rem",
                "border-radius": "var(--paper-border-radius)",
                "object-fit": "contain",
                background: "rgba(128,128,128,0.12)",
            }}
        />
    );

    return (
        <PaperFlex direction="column" fullWidth fullHeight gap="half">
            <PaperFlex
                direction="column"
                gap="half"
                fullWidth
                padding="full"
                style={{ "flex-shrink": 0 }}
            >
                <PaperText size={7} weight={700}>
                    {kindLabel() === "mod" ? "Mods" : "Plugins"}
                </PaperText>
                <PaperText size={4} color="light-text">
                    Manage the jars in your server's{" "}
                    {pluginDirName(serverSoftware())}/ folder and discover more
                    on Modrinth.
                </PaperText>
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
                <Show when={error()}>
                    <PaperQuote variant="red" icon="warning" title="Error">
                        {error()}
                    </PaperQuote>
                </Show>
                <Show when={listWarning()}>
                    <PaperQuote variant="yellow" icon="warning" title="Warning">
                        {listWarning()}
                    </PaperQuote>
                </Show>
            </PaperFlex>

            <PaperSettingList style={{ flex: 1, "min-height": 0 }}>
                <PaperFlex direction="column" gap="full" paddingY="half">
                    <Show when={installed() !== null && installed()!.length > 0}>
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperText size={5} weight={700}>
                                Installed {kindLabel() === "mod" ? "Mods" : "Plugins"}
                            </PaperText>
                            <PaperMediaCardGroup minCardWidth="20rem">
                                <For each={installed()}>
                                    {(entry) => (
                                        <PaperMediaCard
                                            icon={
                                                entry.record?.iconUrl
                                                    ? renderCardIcon(entry.record.iconUrl)
                                                    : undefined
                                            }
                                            title={
                                                entry.record?.slug ??
                                                entry.filename.replace(/\.jar$/i, "")
                                            }
                                            subtitle={entry.filename}
                                            badge={
                                                <PaperBadge variant="green">
                                                    Installed
                                                </PaperBadge>
                                            }
                                            footerLeft={
                                                <PaperText size={2} color="light">
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
                                                          title: entry.record.slug,
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
                    </Show>

                    <Show when={searching()}>
                        <PaperFlex padding="full" center>
                            <PaperText size={3} color="light-text">
                                Searching Modrinth...
                            </PaperText>
                        </PaperFlex>
                    </Show>

                    <Show when={!searching() && searched()}>
                        <Show
                            when={results().length > 0}
                            fallback={
                                <PaperFlex padding="full" center>
                                    <PaperText size={3} color="light-text">
                                        No {kindLabel()}s matched your search.
                                    </PaperText>
                                </PaperFlex>
                            }
                        >
                            <PaperFlex padding="full">
                                <PaperMediaCardGroup minCardWidth="20rem">
                                    <For each={results()}>
                                        {(hit) => (
                                            <PaperMediaCard
                                                icon={hit.iconUrl ? renderCardIcon(hit.iconUrl) : undefined}
                                                title={hit.title}
                                                subtitle={truncate(hit.description, 110)}
                                                footerLeft={
                                                    <PaperText size={2} color="light">
                                                        {formatCount(hit.downloads)} downloads
                                                    </PaperText>
                                                }
                                                footerRight={
                                                    <PaperText size={2} color="light">
                                                        ♥ {formatCount(hit.follows)}
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
                        </Show>
                    </Show>
                </PaperFlex>
            </PaperSettingList>

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
                                    <PaperText size={2} color="light">
                                        {truncate(detailSummary(), 200)}
                                    </PaperText>
                                </PaperFlex>

                                <PaperEffect>
                                    <Show
                                        when={detailInstalled()}
                                        keyed
                                        fallback={
                                            <PaperButton
                                                variant="green"
                                                disabled={busy()}
                                                onClick={() => void install(target)}
                                            >
                                                <PaperIcon>
                                                    {installingId() === target.projectId
                                                        ? "hourglass_top"
                                                        : "download"}
                                                </PaperIcon>
                                                Install
                                            </PaperButton>
                                        }
                                    >
                                        {(entry) => (
                                            <PaperButton
                                                variant="red"
                                                disabled={busy()}
                                                onClick={() => setPendingDelete(entry)}
                                            >
                                                <PaperIcon>delete</PaperIcon>
                                                Uninstall
                                            </PaperButton>
                                        )}
                                    </Show>
                                </PaperEffect>
                            </PaperFlex>

                            <PaperFlex direction="column" gap="onefourth">
                                <PaperText size={3} weight={700}>
                                    About
                                </PaperText>
                                <Show
                                    when={!projectLoading()}
                                    fallback={
                                        <PaperText size={2} color="light-text">
                                            Loading details from Modrinth...
                                        </PaperText>
                                    }
                                >
                                    <Show
                                        when={detailBody()}
                                        fallback={
                                            <PaperText size={2} color="light-text">
                                                No description provided.
                                            </PaperText>
                                        }
                                    >
                                        <div
                                            class="modrinth-description"
                                            innerHTML={detailBody()}
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
                open={pendingCrossVersion() !== null}
                onClose={() => setPendingCrossVersion(null)}
                title="Install a build for another Minecraft version?"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton compact onClick={() => setPendingCrossVersion(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton compact variant="green" onClick={confirmCrossVersionInstall}>
                            Install anyway
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    The latest compatible build
                    {pendingCrossVersion()?.mismatch.versionNumber
                        ? ` (${pendingCrossVersion()!.mismatch.versionNumber})`
                        : ""}{" "}
                    targets Minecraft{" "}
                    {pendingCrossVersion()?.mismatch.gameVersions.length
                        ? pendingCrossVersion()!.mismatch.gameVersions.join(", ")
                        : "an unknown version"}
                    . Cross-version builds can crash the server on startup.
                </PaperText>
            </PaperModal>

            <PaperModal
                open={pendingDelete() !== null}
                onClose={() => setPendingDelete(null)}
                title={`Uninstall ${pendingDelete()?.filename ?? ""}`}
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton compact onClick={() => setPendingDelete(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton compact variant="red" onClick={confirmDelete}>
                            Uninstall
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    This permanently removes the jar from the server's{" "}
                    {pluginDirName(serverSoftware())}/ folder. The change takes
                    effect after a restart. This cannot be undone.
                </PaperText>
            </PaperModal>
        </PaperFlex>
    );
}
