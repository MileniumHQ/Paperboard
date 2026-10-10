import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
    getVarCss,
} from "@mileniumhq/paperui";
import { serverBridge, serverStatus, serverVersion } from "../lib/server";
import { ACTION_IDS } from "../service/contract";
import {
    installDatapack,
    listDatapacks,
    listDatapackVersions,
    removeDatapack,
    searchDatapacks,
    type DatapackListing,
    type ModrinthHit,
    type ModrinthVersion,
} from "../lib/datapacks";
import type { InstalledDatapack } from "../service/datapacks";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function formatCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
}

// Modrinth version numbers are free text: "4.4.4" and "v4.4.4" both occur
const versionLabel = (version: string) => (/^v\d/i.test(version) ? version : `v${version}`);

const packIcon = (iconUrl?: string) => (
    <PaperAvatar src={iconUrl} shape="square" size="large" fallbackIcon="dataset" />
);

// Datapacks: the active world's datapacks/ folder, plus Modrinth's
// datapack builds for this Minecraft version. The service lists, installs
// and removes; this tab browses and confirms.
export default function Datapacks(props: { active: boolean }) {
    const [listing, setListing] = createSignal<DatapackListing | null>(null);
    const [listError, setListError] = createSignal("");
    const [query, setQuery] = createSignal("");
    const [results, setResults] = createSignal<ModrinthHit[] | null>(null);
    const [searching, setSearching] = createSignal(false);
    const [searchError, setSearchError] = createSignal("");

    const [target, setTarget] = createSignal<ModrinthHit | null>(null);
    const [versions, setVersions] = createSignal<ModrinthVersion[] | null>(null);
    const [versionId, setVersionId] = createSignal("");
    const [installing, setInstalling] = createSignal(false);
    const [installError, setInstallError] = createSignal("");

    const [pendingRemove, setPendingRemove] = createSignal<InstalledDatapack | null>(null);
    const [removing, setRemoving] = createSignal(false);
    const [removeError, setRemoveError] = createSignal("");

    const [reloading, setReloading] = createSignal(false);
    const [reloadMessage, setReloadMessage] = createSignal<{ ok: boolean; text: string } | null>(null);

    const load = async () => {
        setListError("");
        try {
            setListing(await listDatapacks());
        } catch (err) {
            setListError(message(err));
        }
    };

    let searchController: AbortController | undefined;
    onCleanup(() => searchController?.abort());
    const runSearch = async () => {
        searchController?.abort();
        const controller = new AbortController();
        searchController = controller;
        setSearchError("");
        setSearching(true);
        try {
            const hits = await searchDatapacks(query().trim(), controller.signal);
            if (!controller.signal.aborted) setResults(hits);
        } catch (err) {
            if (!controller.signal.aborted) setSearchError(message(err));
        } finally {
            if (searchController === controller) setSearching(false);
        }
    };

    // the folder follows the active world and the version decides which
    // builds exist, so both re-read whenever the tab opens
    createEffect(
        on([() => props.active, serverVersion], ([active]) => {
            if (!active) return;
            void load();
            void runSearch();
        }),
    );

    // opening the install dialog loads this version's builds of the pack
    createEffect(
        on(target, (hit) => {
            setVersions(null);
            setVersionId("");
            setInstallError("");
            if (!hit) return;
            listDatapackVersions(hit.projectId)
                .then((list) => {
                    if (target()?.projectId !== hit.projectId) return;
                    setVersions(list);
                    setVersionId(list[0]?.id ?? "");
                })
                .catch((err) => {
                    if (target()?.projectId === hit.projectId) setInstallError(message(err));
                });
        }),
    );

    const installedProjects = () => new Set(listing()?.packs.map((p) => p.record?.projectId).filter(Boolean));

    const confirmInstall = async () => {
        const hit = target();
        if (!hit || !versionId() || installing()) return;
        setInstalling(true);
        setInstallError("");
        try {
            await installDatapack(hit.projectId, versionId());
            setTarget(null);
            await load();
        } catch (err) {
            setInstallError(message(err));
        } finally {
            setInstalling(false);
        }
    };

    const confirmRemove = async () => {
        const pack = pendingRemove();
        if (!pack || removing()) return;
        setRemoving(true);
        setRemoveError("");
        try {
            await removeDatapack(pack.name);
            setPendingRemove(null);
            await load();
        } catch (err) {
            // the dialog stays open: the pack is still in the folder
            setRemoveError(message(err));
        } finally {
            setRemoving(false);
        }
    };

    const reload = async () => {
        setReloading(true);
        setReloadMessage(null);
        try {
            await serverBridge.call(ACTION_IDS.runCommand, { command: "reload" });
            setReloadMessage({ ok: true, text: "Reload sent. The console shows whether every datapack loaded." });
        } catch (err) {
            setReloadMessage({ ok: false, text: message(err) });
        } finally {
            setReloading(false);
        }
    };

    const online = () => serverStatus() === "online";

    return (
        <>
            <PaperPageHeader icon="dataset" title="Datapacks">
                <Show when={online()}>
                    <PaperEffect variant="primary">
                        <PaperButton disabled={reloading()} onClick={() => void reload()}>
                            <PaperIcon aria-hidden="true">refresh</PaperIcon>
                            {reloading() ? "Reloading…" : "Reload datapacks"}
                        </PaperButton>
                    </PaperEffect>
                </Show>
            </PaperPageHeader>

            <Show when={reloadMessage()}>
                {(note) => (
                    <PaperQuote
                        variant={note().ok ? undefined : "danger"}
                        icon={note().ok ? "info" : "warning"}
                        title={note().ok ? "Reloading" : "Could not reload"}
                    >
                        {note().text}
                    </PaperQuote>
                )}
            </Show>

            <Show when={listError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read the datapacks folder">
                    <PaperFlex direction="column" gap="half">
                        <span>{listError()}</span>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>

            <Show when={listing()}>
                {(view) => (
                    <PaperQuote icon="info" title={`World: ${view().world}`}>
                        <Show
                            when={view().worldExists}
                            fallback={<>This world has not been created yet. Datapacks installed now load when the server creates it.</>}
                        >
                            New datapacks load after a reload or restart. Packs that change world generation only
                            affect chunks generated after they load.
                        </Show>
                    </PaperQuote>
                )}
            </Show>

            <PaperFlex direction="column" gap="full">
                <Show when={(listing()?.packs.length ?? 0) > 0}>
                    <PaperCard>
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperText size={5} weight={700}>
                                Installed Datapacks
                            </PaperText>
                            <Show when={listing()?.truncated}>
                                <PaperText size={2} color="text-subtle">
                                    Showing the first {listing()!.packs.length} entries of the folder.
                                </PaperText>
                            </Show>
                            <PaperMediaCardGroup minCardWidth={getVarCss("size-card-min")}>
                                <For each={listing()!.packs}>
                                    {(pack) => (
                                        <PaperMediaCard
                                            icon={packIcon(pack.record?.iconUrl)}
                                            title={pack.record?.title ?? pack.name.replace(/\.zip$/i, "")}
                                            subtitle={pack.name}
                                            badge={
                                                <PaperBadge variant={pack.kind === "folder" ? "monochrome" : "success"}>
                                                    {pack.kind === "folder" ? "Folder" : "Installed"}
                                                </PaperBadge>
                                            }
                                            footerLeft={
                                                <PaperText size={2} color="text-subtle">
                                                    {pack.record?.version ? versionLabel(pack.record.version) : "Added by hand"}
                                                </PaperText>
                                            }
                                            onClick={() => {
                                                setRemoveError("");
                                                setPendingRemove(pack);
                                            }}
                                        />
                                    )}
                                </For>
                            </PaperMediaCardGroup>
                        </PaperFlex>
                    </PaperCard>
                </Show>

                <PaperCard>
                    <PaperFlex direction="column" gap="half" padding="full">
                        <PaperInput
                            fullWidth
                            icon="search"
                            placeholder="Search Datapacks"
                            value={query()}
                            onInput={(e) => setQuery(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void runSearch();
                            }}
                        />
                        <PaperText size={2} color="text-subtle">
                            Datapacks for Minecraft {serverVersion()} provided by{" "}
                            <PaperLink href="https://modrinth.com/datapacks" target="_blank">
                                Modrinth
                            </PaperLink>
                            .
                        </PaperText>
                        <Show when={searchError()}>
                            <PaperQuote variant="danger" icon="warning" title="Search failed">
                                <PaperFlex direction="column" gap="half">
                                    <span>{searchError()}</span>
                                    <PaperButton disabled={searching()} onClick={() => void runSearch()}>
                                        Retry search
                                    </PaperButton>
                                </PaperFlex>
                            </PaperQuote>
                        </Show>
                    </PaperFlex>
                </PaperCard>

                <Show when={searching()}>
                    <PaperCard>
                        <PaperFlex padding="full" center>
                            <PaperText size={3} color="text-subtle">
                                Searching Modrinth...
                            </PaperText>
                        </PaperFlex>
                    </PaperCard>
                </Show>

                <Show when={!searching() && !searchError() && results()}>
                    {(hits) => (
                        <Show
                            when={hits().length > 0}
                            fallback={
                                <PaperCard>
                                    <PaperFlex padding="full" center>
                                        <PaperText size={3} color="text-subtle">
                                            No datapacks for Minecraft {serverVersion()} matched your search.
                                        </PaperText>
                                    </PaperFlex>
                                </PaperCard>
                            }
                        >
                            <PaperCard>
                                <PaperFlex padding="full">
                                    <PaperMediaCardGroup minCardWidth={getVarCss("size-card-min")}>
                                        <For each={hits()}>
                                            {(hit) => (
                                                <PaperMediaCard
                                                    icon={packIcon(hit.iconUrl)}
                                                    title={hit.title}
                                                    subtitle={hit.description}
                                                    badge={
                                                        installedProjects().has(hit.projectId) ? (
                                                            <PaperBadge variant="success">Installed</PaperBadge>
                                                        ) : undefined
                                                    }
                                                    footerLeft={
                                                        <PaperText size={2} color="text-subtle">
                                                            {formatCount(hit.downloads)} downloads
                                                        </PaperText>
                                                    }
                                                    onClick={() => setTarget(hit)}
                                                />
                                            )}
                                        </For>
                                    </PaperMediaCardGroup>
                                </PaperFlex>
                            </PaperCard>
                        </Show>
                    )}
                </Show>
            </PaperFlex>

            <PaperModal
                open={target() !== null}
                onClose={() => setTarget(null)}
                title={target() ? `Install ${target()!.title}` : "Install datapack"}
                size="medium"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setTarget(null)}>Cancel</PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={!versionId() || installing()}
                            onClick={() => void confirmInstall()}
                        >
                            <PaperIcon aria-hidden="true">{installing() ? "hourglass_top" : "download"}</PaperIcon>
                            {installing() ? "Installing…" : "Install"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <Show when={target()}>
                    {(hit) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperText preset="body">{hit().description}</PaperText>
                            <PaperLink href={`https://modrinth.com/datapack/${hit().slug}`} target="_blank">
                                Open at Modrinth.com
                            </PaperLink>
                            <Show
                                when={versions()}
                                fallback={
                                    <Show when={!installError()}>
                                        <PaperText size={2} color="text-subtle">
                                            Loading versions from Modrinth...
                                        </PaperText>
                                    </Show>
                                }
                            >
                                {(list) => (
                                    <Show
                                        when={list().length > 0}
                                        fallback={
                                            <PaperQuote variant="warning" icon="warning" title="No compatible build">
                                                This datapack has no build for Minecraft {serverVersion()}.
                                            </PaperQuote>
                                        }
                                    >
                                        <PaperFlex direction="column" gap="half">
                                            <PaperText size={3} weight={700}>
                                                Version
                                            </PaperText>
                                            <PaperSelectMenu
                                                name="datapackVersion"
                                                aria-label="Datapack version"
                                                value={versionId()}
                                                onValueChange={(value) => setVersionId(String(value))}
                                            >
                                                <For each={list()}>
                                                    {(v) => (
                                                        <PaperSelectMenuItem value={v.id}>
                                                            {v.versionNumber || v.name}
                                                        </PaperSelectMenuItem>
                                                    )}
                                                </For>
                                            </PaperSelectMenu>
                                            <PaperText size={2} color="text-subtle">
                                                Installs into {listing()?.world ?? "the active world"}/datapacks/.
                                            </PaperText>
                                        </PaperFlex>
                                    </Show>
                                )}
                            </Show>
                            <Show when={installError()}>
                                <PaperQuote variant="danger" icon="warning" title="Not installed">
                                    {installError()}
                                </PaperQuote>
                            </Show>
                        </PaperFlex>
                    )}
                </Show>
            </PaperModal>

            <PaperModal
                open={pendingRemove() !== null}
                onClose={() => setPendingRemove(null)}
                title="Remove datapack"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setPendingRemove(null)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={removing()} onClick={() => void confirmRemove()}>
                            <PaperIcon aria-hidden="true">delete</PaperIcon>
                            {removing() ? "Removing…" : "Remove"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        Move {pendingRemove()?.record?.title ?? pendingRemove()?.name} out of{" "}
                        {listing()?.world}/datapacks/ into the server folder's trash?
                        {online() ? " It stays loaded until the next reload or restart." : ""}
                    </PaperText>
                    <Show when={removeError()}>
                        <PaperQuote variant="danger" icon="warning" title="Not removed">
                            {removeError()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
