import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import RecoveryNotice from "./RecoveryNotice";
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
    PaperProgress,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
    getVarCss,
} from "@mileniumhq/paperui";
import { modpackProgress, serverSoftware, serverStatus, serverVersion } from "../lib/server";
import { SOFTWARE } from "../software/catalog";
import {
    installModpack,
    listModpackVersions,
    readModpack,
    removeModpack,
    searchModpacks,
    type ModpackInstallOutcome,
    type ModpackRecord,
    type ModrinthHit,
    type ModrinthVersion,
} from "../lib/modpacks";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function formatCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
}

// Modrinth version numbers are free text: "4.4.4" and "v4.4.4" both occur
const versionLabel = (version: string) => (/^v\d/i.test(version) ? version : `v${version}`);

const packIcon = (iconUrl?: string) => (
    <PaperAvatar src={iconUrl} shape="square" size="large" fallbackIcon="package_2" />
);

const STAGE_LABEL = {
    preparing: "Reading the modpack…",
    downloading: "Downloading mods…",
    "installing-server": "Installing the pack's loader…",
    placing: "Placing files…",
    completed: "Installed",
    error: "Failed",
} as const;

// Modpacks: one Modrinth pack for the server's loader. Installing replaces
// the mod set and may switch the Minecraft version and loader build; the
// service does all of it (service/modpacks.ts), this tab browses and
// confirms.
export default function Modpacks(props: { active: boolean }) {
    const loaderName = () => SOFTWARE[serverSoftware()].name;
    const offline = () => serverStatus() === "offline";

    const [current, setCurrent] = createSignal<ModpackRecord | null>(null);
    const [recordError, setRecordError] = createSignal("");
    const [query, setQuery] = createSignal("");
    const [results, setResults] = createSignal<ModrinthHit[] | null>(null);
    const [searching, setSearching] = createSignal(false);
    const [searchError, setSearchError] = createSignal("");

    const [target, setTarget] = createSignal<{ projectId: string; slug: string; title: string; description: string } | null>(null);
    const [versions, setVersions] = createSignal<ModrinthVersion[] | null>(null);
    const [versionId, setVersionId] = createSignal("");
    const [installing, setInstalling] = createSignal(false);
    const [installError, setInstallError] = createSignal("");
    const [installed, setInstalled] = createSignal<ModpackInstallOutcome | null>(null);

    const [confirmingRemove, setConfirmingRemove] = createSignal(false);
    const [removing, setRemoving] = createSignal(false);
    const [removeError, setRemoveError] = createSignal("");

    const load = async () => {
        setRecordError("");
        try {
            setCurrent((await readModpack()).modpack);
        } catch (err) {
            setCurrent(null);
            setRecordError(message(err));
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
            const hits = await searchModpacks(query().trim(), controller.signal);
            if (!controller.signal.aborted) setResults(hits);
        } catch (err) {
            if (!controller.signal.aborted) setSearchError(message(err));
        } finally {
            if (searchController === controller) setSearching(false);
        }
    };

    createEffect(
        on([() => props.active, serverSoftware], ([active]) => {
            if (!active) return;
            void load();
            void runSearch();
        }),
    );

    createEffect(
        on(target, (pack) => {
            setVersions(null);
            setVersionId("");
            setInstallError("");
            if (!pack) return;
            listModpackVersions(pack.projectId)
                .then((list) => {
                    if (target()?.projectId !== pack.projectId) return;
                    setVersions(list);
                    // the newest for this Minecraft version, so a pick does not
                    // move the server unasked; else the newest there is
                    const sameVersion = list.find((v) => v.gameVersions.includes(serverVersion()));
                    setVersionId((sameVersion ?? list[0])?.id ?? "");
                })
                .catch((err) => {
                    if (target()?.projectId === pack.projectId) setInstallError(message(err));
                });
        }),
    );

    const chosen = () => versions()?.find((v) => v.id === versionId()) ?? null;
    const switchesVersion = () => {
        const v = chosen();
        return v !== null && v.gameVersions.length > 0 && !v.gameVersions.includes(serverVersion());
    };

    const closeInstall = () => {
        // the install runs in the service either way; the dialog only stops showing it
        if (!installing()) setTarget(null);
    };

    const confirmInstall = async () => {
        const pack = target();
        if (!pack || !versionId() || installing()) return;
        setInstalling(true);
        setInstallError("");
        try {
            const outcome = await installModpack(pack.projectId, versionId());
            setInstalled(outcome);
            setTarget(null);
            await load();
        } catch (err) {
            setInstallError(message(err));
            // a failure may come after a recorded change; show what is there now
            await load();
        } finally {
            setInstalling(false);
        }
    };

    const confirmRemove = async () => {
        if (removing()) return;
        setRemoving(true);
        setRemoveError("");
        try {
            await removeModpack();
            setConfirmingRemove(false);
            setInstalled(null);
            await load();
        } catch (err) {
            setRemoveError(message(err));
        } finally {
            setRemoving(false);
        }
    };

    const progress = () => modpackProgress();

    return (
        <>
            <PaperPageHeader icon="package_2" title="Modpacks" />

            <RecoveryNotice />

            <Show when={!offline()}>
                <PaperQuote icon="info" title="The server is running">
                    Stop the server to install, update or remove a modpack.
                </PaperQuote>
            </Show>

            <Show when={installed()}>
                {(outcome) => (
                    <PaperQuote
                        variant={outcome().warning ? "warning" : "success"}
                        icon={outcome().warning ? "warning" : "check_circle"}
                        title={`${outcome().title} ${versionLabel(outcome().versionNumber)} installed`}
                    >
                        <PaperFlex direction="column" gap="half">
                            <span>
                                {outcome().switchedServer
                                    ? `The server now runs ${loaderName()} ${outcome().loaderVersion} for Minecraft ${outcome().mcVersion}. `
                                    : ""}
                                The replaced mods and configs are in the server folder's trash.
                            </span>
                            <Show when={outcome().kept.length > 0}>
                                <span>
                                    Kept your own {outcome().kept.slice(0, 3).join(", ")}
                                    {outcome().kept.length > 3 ? ` and ${outcome().kept.length - 3} more` : ""} instead of the
                                    pack's copy.
                                </span>
                            </Show>
                            <Show when={outcome().warning}>
                                <span>{outcome().warning}</span>
                            </Show>
                        </PaperFlex>
                    </PaperQuote>
                )}
            </Show>

            <Show when={recordError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read the installed modpack">
                    <PaperFlex direction="column" gap="half">
                        <span>{recordError()}</span>
                        <PaperFlex direction="row" gap="half">
                            <PaperButton onClick={() => void load()}>Try again</PaperButton>
                            <PaperButton disabled={!offline() || removing()} onClick={() => void confirmRemove()}>
                                Forget it (files stay)
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperQuote>
            </Show>

            <PaperFlex direction="column" gap="full">
                <Show when={current()}>
                    {(pack) => (
                        <PaperCard>
                            <PaperFlex direction="column" gap="half" padding="full">
                                <PaperText size={5} weight={700}>
                                    Installed Modpack
                                </PaperText>
                                <PaperMediaCardGroup minCardWidth={getVarCss("size-card-min")}>
                                    <PaperMediaCard
                                        icon={packIcon(pack().iconUrl)}
                                        title={pack().title}
                                        subtitle={`Minecraft ${pack().mcVersion} · ${loaderName()} ${pack().loaderVersion}`}
                                        badge={<PaperBadge variant="success">{versionLabel(pack().versionNumber)}</PaperBadge>}
                                        footerLeft={
                                            <PaperText size={2} color="text-subtle">
                                                {pack().files.length} files
                                            </PaperText>
                                        }
                                    />
                                </PaperMediaCardGroup>
                                <PaperFlex direction="row" gap="half">
                                    <PaperButton
                                        disabled={!offline()}
                                        onClick={() =>
                                            setTarget({
                                                projectId: pack().projectId,
                                                slug: pack().slug,
                                                title: pack().title,
                                                description: `Installed: ${versionLabel(pack().versionNumber)}`,
                                            })
                                        }
                                    >
                                        <PaperIcon aria-hidden="true">update</PaperIcon>
                                        Change version
                                    </PaperButton>
                                    <PaperButton
                                        variant="danger"
                                        disabled={!offline()}
                                        onClick={() => {
                                            setRemoveError("");
                                            setConfirmingRemove(true);
                                        }}
                                    >
                                        <PaperIcon aria-hidden="true">delete</PaperIcon>
                                        Remove
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </PaperCard>
                    )}
                </Show>

                <PaperCard>
                    <PaperFlex direction="column" gap="half" padding="full">
                        <PaperInput
                            fullWidth
                            icon="search"
                            placeholder="Search Modpacks"
                            value={query()}
                            onInput={(e) => setQuery(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void runSearch();
                            }}
                        />
                        <PaperText size={2} color="text-subtle">
                            {loaderName()} modpacks that run on a server, provided by{" "}
                            <PaperLink href="https://modrinth.com/modpacks" target="_blank">
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
                                            No {loaderName()} modpacks matched your search.
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
                                                        current()?.projectId === hit.projectId ? (
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
                onClose={closeInstall}
                title={target() ? `Install ${target()!.title}` : "Install modpack"}
                size="medium"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton disabled={installing()} onClick={closeInstall}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={!versionId() || installing() || !offline()}
                            onClick={() => void confirmInstall()}
                        >
                            <PaperIcon aria-hidden="true">{installing() ? "hourglass_top" : "download"}</PaperIcon>
                            {installing() ? "Installing…" : "Install"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <Show when={target()}>
                    {(pack) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperText preset="body">{pack().description}</PaperText>
                            <PaperLink href={`https://modrinth.com/modpack/${pack().slug}`} target="_blank">
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
                                            <PaperQuote variant="warning" icon="warning" title="No compatible version">
                                                This modpack has no {loaderName()} version.
                                            </PaperQuote>
                                        }
                                    >
                                        <PaperFlex direction="column" gap="half">
                                            <PaperText size={3} weight={700}>
                                                Version
                                            </PaperText>
                                            <PaperSelectMenu
                                                name="modpackVersion"
                                                aria-label="Modpack version"
                                                value={versionId()}
                                                disabled={installing()}
                                                onValueChange={(value) => setVersionId(String(value))}
                                            >
                                                <For each={list()}>
                                                    {(v) => (
                                                        <PaperSelectMenuItem value={v.id}>
                                                            {`${v.versionNumber || v.name} · Minecraft ${v.gameVersions.join(", ")}`}
                                                        </PaperSelectMenuItem>
                                                    )}
                                                </For>
                                            </PaperSelectMenu>
                                        </PaperFlex>
                                    </Show>
                                )}
                            </Show>
                            <PaperQuote variant="warning" icon="warning" title="This replaces the server's mods">
                                Every jar in mods/ moves to the server folder's trash, and configs the pack ships replace
                                yours (the old ones go to the trash too). Worlds and server.properties are kept.
                                <Show when={switchesVersion()}>
                                    {" "}
                                    The server switches to Minecraft {chosen()!.gameVersions.join(", ")}; a world opened by a
                                    newer version cannot go back.
                                </Show>
                            </PaperQuote>
                            <Show when={installing() && progress()}>
                                {(p) => (
                                    <PaperFlex direction="column" gap="half">
                                        <PaperText size={2} color="text-subtle">
                                            {STAGE_LABEL[p().stage]}
                                            {p().stage === "downloading" ? ` ${p().done} of ${p().total}` : ""}
                                        </PaperText>
                                        <PaperProgress
                                            value={p().stage === "downloading" ? p().done : undefined}
                                            max={Math.max(1, p().total)}
                                            aria-label={STAGE_LABEL[p().stage]}
                                        />
                                    </PaperFlex>
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
                open={confirmingRemove()}
                onClose={() => setConfirmingRemove(false)}
                title="Remove modpack"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setConfirmingRemove(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={removing() || !offline()} onClick={() => void confirmRemove()}>
                            <PaperIcon aria-hidden="true">delete</PaperIcon>
                            {removing() ? "Removing…" : "Remove"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        Move the {current()?.files.length} files {current()?.title} placed into the server folder's trash?{" "}
                        {loaderName()} {current()?.loaderVersion} stays installed, and so do mods and configs you added.
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
