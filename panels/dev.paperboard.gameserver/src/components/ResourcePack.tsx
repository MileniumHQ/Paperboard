import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCard,
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
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { serverVersion } from "../lib/server";
import { supports } from "../lib/capabilities";
import { errorMessage } from "../lib/failure";
import { readServerPropertiesStrict, writeServerProperties } from "../lib/properties";
import {
    listResourcePackVersions,
    readResourcePack,
    removeResourcePack,
    searchResourcePacks,
    selectCustomResourcePack,
    selectModrinthResourcePack,
    type ModrinthHit,
    type ModrinthVersion,
    type ResourcePackView,
} from "../lib/resourcepack";
import { isResourcePackId, promptFromProperty, promptToProperty } from "../core/resourcepack";

const SAVE_DEBOUNCE_MS = 400;

function formatCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
}

// Modrinth version numbers are free text: "4.4.4" and "v4.4.4" both occur
const versionLabel = (version: string) => (/^v\d/i.test(version) ? version : `v${version}`);

const packIcon = (iconUrl?: string) => (
    <PaperAvatar src={iconUrl} shape="square" size="large" fallbackIcon="texture" />
);

interface PackSettings {
    require: boolean;
    prompt: string;
    id: string;
}

// Resource Pack: every server.properties key that belongs to the server
// resource pack. The service points the pack's URL and sha1 at a Modrinth
// build or a pasted URL; this tab browses, confirms, and owns the rest.
export default function ResourcePack(props: { active: boolean }) {
    const [pack, setPack] = createSignal<ResourcePackView | null>(null);
    const [settings, setSettings] = createSignal<PackSettings | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [saveError, setSaveError] = createSignal("");

    const [query, setQuery] = createSignal("");
    const [results, setResults] = createSignal<ModrinthHit[] | null>(null);
    const [searching, setSearching] = createSignal(false);
    const [searchError, setSearchError] = createSignal("");

    const [target, setTarget] = createSignal<ModrinthHit | null>(null);
    const [versions, setVersions] = createSignal<ModrinthVersion[] | null>(null);
    const [versionId, setVersionId] = createSignal("");
    const [selecting, setSelecting] = createSignal(false);
    const [selectError, setSelectError] = createSignal("");

    const [customUrl, setCustomUrl] = createSignal("");
    const [hashing, setHashing] = createSignal(false);
    const [customError, setCustomError] = createSignal("");

    const [removing, setRemoving] = createSignal(false);
    const [removeError, setRemoveError] = createSignal("");

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    onCleanup(() => {
        if (saveTimer) clearTimeout(saveTimer);
    });

    const load = async () => {
        setLoadError("");
        try {
            const [view, stored] = await Promise.all([readResourcePack(), readServerPropertiesStrict()]);
            setPack(view);
            setSettings({
                require: stored["require-resource-pack"] === "true",
                prompt: promptFromProperty(stored["resource-pack-prompt"] ?? ""),
                id: stored["resource-pack-id"] ?? "",
            });
        } catch (err) {
            setLoadError(errorMessage(err));
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
            const hits = await searchResourcePacks(query().trim(), controller.signal);
            if (!controller.signal.aborted) setResults(hits);
        } catch (err) {
            if (!controller.signal.aborted) setSearchError(errorMessage(err));
        } finally {
            if (searchController === controller) setSearching(false);
        }
    };

    // the version decides which builds exist, so both re-read whenever the tab opens
    createEffect(
        on([() => props.active, serverVersion], ([active]) => {
            if (!active) return;
            void load();
            void runSearch();
        }),
    );

    // opening the dialog loads this version's builds of the pack
    createEffect(
        on(target, (hit) => {
            setVersions(null);
            setVersionId("");
            setSelectError("");
            if (!hit) return;
            listResourcePackVersions(hit.projectId)
                .then((list) => {
                    if (target()?.projectId !== hit.projectId) return;
                    setVersions(list);
                    setVersionId(list[0]?.id ?? "");
                })
                .catch((err) => {
                    if (target()?.projectId === hit.projectId) setSelectError(errorMessage(err));
                });
        }),
    );

    const confirmSelect = async () => {
        const hit = target();
        if (!hit || !versionId() || selecting()) return;
        setSelecting(true);
        setSelectError("");
        try {
            await selectModrinthResourcePack(hit.projectId, versionId());
            setTarget(null);
            await load();
        } catch (err) {
            setSelectError(errorMessage(err));
        } finally {
            setSelecting(false);
        }
    };

    const useCustomUrl = async () => {
        if (hashing()) return;
        setHashing(true);
        setCustomError("");
        try {
            await selectCustomResourcePack(customUrl());
            setCustomUrl("");
            await load();
        } catch (err) {
            setCustomError(errorMessage(err));
        } finally {
            setHashing(false);
        }
    };

    const remove = async () => {
        if (removing()) return;
        setRemoving(true);
        setRemoveError("");
        try {
            await removeResourcePack();
            await load();
        } catch (err) {
            setRemoveError(errorMessage(err));
        } finally {
            setRemoving(false);
        }
    };

    // a value the game would reject is never written: the field says why
    const promptProblem = (prompt: string): string => {
        try {
            promptToProperty(prompt);
            return "";
        } catch (err) {
            return errorMessage(err);
        }
    };
    const idProblem = (id: string): string =>
        isResourcePackId(id) ? "" : "The pack id must be a UUID, like 123e4567-e89b-12d3-a456-426614174000.";
    const draftError = (next: PackSettings): string => idProblem(next.id) || promptProblem(next.prompt);

    const persist = async () => {
        const next = settings();
        if (!next || draftError(next)) return;
        try {
            await writeServerProperties({
                ...(supports("requireResourcePack") ? { "require-resource-pack": String(next.require) } : {}),
                ...(supports("resourcePackPrompt") ? { "resource-pack-prompt": promptToProperty(next.prompt) } : {}),
                ...(supports("resourcePackId") ? { "resource-pack-id": next.id.trim().toLowerCase() } : {}),
            });
            setSaveError("");
        } catch (err) {
            setSaveError(errorMessage(err));
        }
    };

    const change = (patch: Partial<PackSettings>, immediate = false) => {
        const next = { ...settings()!, ...patch };
        setSettings(next);
        if (saveTimer) clearTimeout(saveTimer);
        const problem = draftError(next);
        if (problem) {
            setSaveError(problem);
            return;
        }
        setSaveError("");
        if (immediate) void persist();
        else saveTimer = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
    };

    const current = () => {
        const view = pack();
        return view && view.url ? view : null;
    };

    return (
        <>
            <PaperPageHeader icon="texture" title="Resource Pack" />
            <PaperQuote variant="warning" icon="info" title="Applies after a restart">
                Players get the pack when they join. A change here reaches them the next time the server starts.
            </PaperQuote>

            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't read the resource pack settings">
                    <PaperFlex direction="column" gap="half">
                        <PaperText>{loadError()}</PaperText>
                        <PaperButton size="tiny" onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={saveError()}>
                <PaperQuote variant="danger" icon="warning" title="Settings not saved">
                    {saveError()}
                </PaperQuote>
            </Show>
            <Show when={removeError()}>
                <PaperQuote variant="danger" icon="warning" title="Resource pack not removed">
                    {removeError()}
                </PaperQuote>
            </Show>

            <PaperFlex direction="column" gap="full">
                <Show when={current()}>
                    {(view) => (
                        <PaperCard>
                            <PaperFlex direction="column" gap="half" padding="full">
                                <PaperText size={5} weight={700}>
                                    Current Resource Pack
                                </PaperText>
                                <PaperMediaCardGroup minCardWidth="card-min">
                                    <PaperMediaCard
                                        icon={packIcon(view().selection?.iconUrl)}
                                        title={view().selection?.title ?? "Custom resource pack"}
                                        subtitle={view().url}
                                        badge={
                                            <PaperBadge variant={view().sha1 ? "success" : "warning"}>
                                                {view().sha1 ? "Verified" : "No sha1"}
                                            </PaperBadge>
                                        }
                                        footerLeft={
                                            <PaperText size={2} color="text-subtle">
                                                {view().selection?.version
                                                    ? versionLabel(view().selection!.version!)
                                                    : view().selection
                                                      ? "Direct URL"
                                                      : "Set outside Paperboard"}
                                            </PaperText>
                                        }
                                        footerRight={
                                            <PaperButton
                                                size="tiny"
                                                variant="danger"
                                                disabled={removing()}
                                                onClick={() => void remove()}
                                            >
                                                <PaperIcon aria-hidden="true">delete</PaperIcon>
                                                {removing() ? "Removing…" : "Remove"}
                                            </PaperButton>
                                        }
                                    />
                                </PaperMediaCardGroup>
                            </PaperFlex>
                        </PaperCard>
                    )}
                </Show>

                <Show when={settings()}>
                    {(values) => (
                        <PaperSettingList autoHeight>
                            <Show when={supports("requireResourcePack")}>
                                <PaperSettingItem
                                    title="Require Resource Pack"
                                    description="Players must accept the pack to join."
                                >
                                    <PaperToggle
                                        checked={values().require}
                                        onChange={(checked) => change({ require: checked }, true)}
                                    />
                                </PaperSettingItem>
                            </Show>
                            <Show when={supports("resourcePackPrompt")}>
                                <PaperSettingItem
                                    title="Prompt"
                                    description="The message players see when asked to accept the pack. Leave empty for the default."
                                >
                                    <PaperInput
                                        value={values().prompt}
                                        invalid={promptProblem(values().prompt) !== ""}
                                        onInput={(e) => change({ prompt: e.currentTarget.value })}
                                    />
                                </PaperSettingItem>
                            </Show>
                            <Show when={supports("resourcePackId")}>
                                <PaperSettingItem
                                    title="Pack ID"
                                    description="A UUID clients use to tell this pack from others. Leave empty to let the game choose."
                                >
                                    <PaperInput
                                        value={values().id}
                                        invalid={idProblem(values().id) !== ""}
                                        onInput={(e) => change({ id: e.currentTarget.value })}
                                    />
                                </PaperSettingItem>
                            </Show>
                        </PaperSettingList>
                    )}
                </Show>

                <PaperCard>
                    <PaperFlex direction="column" gap="half" padding="full">
                        <PaperText size={5} weight={700}>
                            Direct URL
                        </PaperText>
                        <PaperInput
                            fullWidth
                            icon="link"
                            placeholder="https://example.com/pack.zip"
                            value={customUrl()}
                            onInput={(e) => setCustomUrl(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void useCustomUrl();
                            }}
                        />
                        <PaperText size={2} color="text-subtle">
                            Paperboard downloads the pack once to work out its sha1, so players can verify what they
                            get. The link must be a direct download of a .zip.
                        </PaperText>
                        <Show when={customError()}>
                            <PaperQuote variant="danger" icon="warning" title="Resource pack not set">
                                {customError()}
                            </PaperQuote>
                        </Show>
                        <PaperFlex>
                            <PaperButton
                                variant="success"
                                disabled={hashing() || !customUrl().trim()}
                                onClick={() => void useCustomUrl()}
                            >
                                <PaperIcon aria-hidden="true">{hashing() ? "hourglass_top" : "check"}</PaperIcon>
                                {hashing() ? "Downloading…" : "Use this URL"}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperCard>

                <PaperCard>
                    <PaperFlex direction="column" gap="half" padding="full">
                        <PaperInput
                            fullWidth
                            icon="search"
                            placeholder="Search Resource Packs"
                            value={query()}
                            onInput={(e) => setQuery(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void runSearch();
                            }}
                        />
                        <PaperText size={2} color="text-subtle">
                            Resource packs for Minecraft {serverVersion()} provided by{" "}
                            <PaperLink href="https://modrinth.com/resourcepacks" target="_blank">
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
                                            No resource packs for Minecraft {serverVersion()} matched your search.
                                        </PaperText>
                                    </PaperFlex>
                                </PaperCard>
                            }
                        >
                            <PaperCard>
                                <PaperFlex padding="full">
                                    <PaperMediaCardGroup minCardWidth="card-min">
                                        <For each={hits()}>
                                            {(hit) => (
                                                <PaperMediaCard
                                                    icon={packIcon(hit.iconUrl)}
                                                    title={hit.title}
                                                    subtitle={hit.description}
                                                    badge={
                                                        pack()?.selection?.projectId === hit.projectId ? (
                                                            <PaperBadge variant="success">In use</PaperBadge>
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
                title={target() ? `Use ${target()!.title}` : "Use resource pack"}
                size="medium"
                footer={
                    <>
                        <PaperButton onClick={() => setTarget(null)}>Cancel</PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={!versionId() || selecting()}
                            onClick={() => void confirmSelect()}
                        >
                            <PaperIcon aria-hidden="true">{selecting() ? "hourglass_top" : "check"}</PaperIcon>
                            {selecting() ? "Setting…" : "Use pack"}
                        </PaperButton>
                    </>
                }
            >
                <Show when={target()}>
                    {(hit) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperText preset="body">{hit().description}</PaperText>
                            <PaperLink href={`https://modrinth.com/resourcepack/${hit().slug}`} target="_blank">
                                Open at Modrinth.com
                            </PaperLink>
                            <Show
                                when={versions()}
                                fallback={
                                    <Show when={!selectError()}>
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
                                                This resource pack has no build for Minecraft {serverVersion()}.
                                            </PaperQuote>
                                        }
                                    >
                                        <PaperFlex direction="column" gap="half">
                                            <PaperText size={3} weight={700}>
                                                Version
                                            </PaperText>
                                            <PaperSelectMenu
                                                name="resourcePackVersion"
                                                aria-label="Resource pack version"
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
                                                Players download it from Modrinth when they join.
                                            </PaperText>
                                        </PaperFlex>
                                    </Show>
                                )}
                            </Show>
                            <Show when={selectError()}>
                                <PaperQuote variant="danger" icon="warning" title="Resource pack not set">
                                    {selectError()}
                                </PaperQuote>
                            </Show>
                        </PaperFlex>
                    )}
                </Show>
            </PaperModal>
        </>
    );
}
