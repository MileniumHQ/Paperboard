import { createMemo, createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
    PaperBadge,
    PaperButton,
    PaperEmptyState,
    PaperIcon,
    PaperInput,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperPagination,
    PaperProgress,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@paperboard-dev/paperui";
import { UI_ACTION_IDS } from "../contract";
import { isValidModelRef, modelRef, searchCatalog, type CatalogModel, type CatalogSort } from "../core/catalog";
import { formatBytes } from "../core/fit";
import { OLLAMA_PROVIDER_ID, providerFor, providerLabel } from "../core/providers";
import type { InstalledModel } from "../core/types";
import { catalog, catalogEntry, fitFor, makerOf } from "../lib/catalog";
import { ensureProviderReady } from "../lib/provisioning";
import { call, errorText, state } from "../lib/state";
import FitMeter from "./FitMeter";
import MakerLogo from "./MakerLogo";
import ModelDetailModal from "./ModelDetailModal";
import styles from "./ModelBrowser.module.css";

const PAGE_SIZE = 12;

/** The catalog size that fits this computer best, else the smallest. */
function defaultTag(model: CatalogModel): string {
    const fitting = model.tags.filter((t) => fitFor(t.bytes, t.context).rating === "gpu");
    const pick = fitting.length
        ? fitting.reduce((a, b) => (b.bytes > a.bytes ? b : a))
        : model.tags.reduce((a, b) => (b.bytes < a.bytes ? b : a));
    return pick.tag;
}

export interface ModelBrowserProps {
    /** "pick" chooses installed models and opens catalog details; "choose" selects any card. */
    mode?: "pick" | "choose";
    /** pick mode: an installed model was chosen for the current chat. */
    onPick?: (ref: string) => void;
    /** choose mode: the card's default size was selected. */
    onChoose?: (ref: string) => void;
    /** choose mode: the currently selected model ref. */
    selected?: string;
    /** show default/delete controls on installed models. */
    manage?: boolean;
    class?: string;
}

/**
 * One list of every model: what is on this computer first, then the local
 * library, paged. Catalog cards open a detail view where the size is chosen
 * and the download runs.
 */
export default function ModelBrowser(props: ModelBrowserProps) {
    const [query, setQuery] = createSignal("");
    const [sort, setSort] = createSignal<CatalogSort>("newest");
    const [page, setPage] = createSignal(1);
    const [tags, setTags] = createStore<Record<string, string>>({});
    const [detail, setDetail] = createSignal<CatalogModel | null>(null);
    const [error, setError] = createSignal("");
    const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
    const [deleting, setDeleting] = createSignal(false);
    const [byName, setByName] = createSignal("");
    let root: HTMLDivElement | undefined;

    const mode = () => props.mode ?? "pick";
    const isEndpoint = () => state.provider.id !== OLLAMA_PROVIDER_ID;
    const results = createMemo(() => searchCatalog(catalog, { text: query(), sort: sort() }));
    const pageCount = () => Math.max(1, Math.ceil(results().length / PAGE_SIZE));
    const visible = createMemo(() => results().slice((page() - 1) * PAGE_SIZE, page() * PAGE_SIZE));
    // endpoint models have no catalog: they are the list, and search/pagination
    // must cover them instead of a library that does not exist
    const endpointResults = createMemo(() => {
        const q = query().trim().toLowerCase();
        return q ? state.models.filter((m) => m.name.toLowerCase().includes(q)) : state.models;
    });
    const endpointPageCount = () => Math.max(1, Math.ceil(endpointResults().length / PAGE_SIZE));
    const endpointVisible = createMemo(() =>
        endpointResults().slice((page() - 1) * PAGE_SIZE, page() * PAGE_SIZE),
    );
    const tagOf = (model: CatalogModel) => tags[model.name] ?? defaultTag(model);
    const refOf = (model: CatalogModel) => modelRef(model.name, tagOf(model));
    const isSelected = (ref: string) => props.selected === ref;

    const choose = (ref: string) => {
        if (mode() === "choose") props.onChoose?.(ref);
        else props.onPick?.(ref);
    };

    const goToPage = (next: number) => {
        setPage(next);
        // this flex column is not the scroller (the modal body owns it), so
        // walk up to the nearest scrollable ancestor and reset it to the top
        let el: HTMLElement | null = root?.parentElement ?? null;
        while (el) {
            const overflowY = getComputedStyle(el).overflowY;
            if (
                (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
                el.scrollHeight > el.clientHeight
            ) {
                el.scrollTo({ top: 0, behavior: "smooth" });
                return;
            }
            el = el.parentElement;
        }
        root?.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    const download = async (ref: string) => {
        setError("");
        try {
            // installing/starting the provider happens first, with its own
            // progress row, so a fresh computer is one click, not a wizard
            await ensureProviderReady();
            await call(UI_ACTION_IDS.pullModel, { model: ref });
        } catch (err) {
            setError(errorText(err));
        }
    };

    const downloadByName = async () => {
        const ref = byName().trim();
        if (!isValidModelRef(ref)) {
            setError(`"${ref}" is not a model name from the Ollama library, like qwen3:8b.`);
            return;
        }
        await download(ref);
        setByName("");
    };

    const remove = async () => {
        const model = confirmDelete();
        if (!model) return;
        setDeleting(true);
        try {
            await call(UI_ACTION_IDS.deleteModel, { model });
            setConfirmDelete(null);
        } catch (err) {
            setError(errorText(err));
            setConfirmDelete(null);
        } finally {
            setDeleting(false);
        }
    };

    const makeDefault = async (model: string) => {
        setError("");
        try {
            await call(UI_ACTION_IDS.updateSettings, { defaultModel: model });
        } catch (err) {
            setError(errorText(err));
        }
    };

    function InstalledCard(cardProps: { model: InstalledModel; endpoint?: boolean }) {
        const entry = () => catalogEntry(cardProps.model.name);
        const maker = () => makerOf(cardProps.model.name);
        const isDefault = () => state.settings.defaultModel === cardProps.model.name;
        const chosen = () => isSelected(cardProps.model.name);
        const endpoint = () => Boolean(cardProps.endpoint);
        return (
            <PaperMediaCard
                icon={endpoint() ? <PaperIcon>cloud</PaperIcon> : <MakerLogo icon={maker()?.icon} size="large" />}
                title={cardProps.model.name}
                subtitle={endpoint() ? undefined : (maker()?.name ?? "On this computer")}
                description={endpoint() ? undefined : (entry()?.description ?? "Downloaded and ready to chat.")}
                badge={
                    <Show when={isDefault()}>
                        <PaperBadge variant="primary" icon="star">Default</PaperBadge>
                    </Show>
                }
                footerLeft={
                    endpoint() ? undefined : (
                        <PaperText size={1} color="text-subtle">
                            {[cardProps.model.parameterSize, cardProps.model.quantization, formatBytes(cardProps.model.sizeBytes)].filter(Boolean).join(" · ")}
                            {cardProps.model.contextLength ? ` · ${Math.round(cardProps.model.contextLength / 1024)}K context` : ""}
                        </PaperText>
                    )
                }
                footerRight={
                    <Show when={props.manage}>
                        <span class={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                            <PaperButton
                                icon
                                size="tiny"
                                variant="text"
                                aria-label={`Use ${cardProps.model.name} for new chats`}
                                disabled={isDefault()}
                                onClick={() => void makeDefault(cardProps.model.name)}
                            >
                                star
                            </PaperButton>
                            <Show when={!endpoint()}>
                                <PaperButton
                                    icon
                                    size="tiny"
                                    variant="text"
                                    aria-label={`Delete ${cardProps.model.name}`}
                                    onClick={() => setConfirmDelete(cardProps.model.name)}
                                >
                                    delete
                                </PaperButton>
                            </Show>
                        </span>
                    </Show>
                }
                class={chosen() ? styles.chosen : undefined}
                onClick={() => choose(cardProps.model.name)}
            />
        );
    }

    function CatalogCard(cardProps: { model: CatalogModel }) {
        const selected = () => cardProps.model.tags.find((t) => t.tag === tagOf(cardProps.model)) ?? cardProps.model.tags[0]!;
        const ref = () => refOf(cardProps.model);
        const maker = () => catalog.makers[cardProps.model.maker];
        const installed = () => state.models.some((m) => m.name === ref());
        const pulling = () => state.pulls.some((p) => p.model === ref());
        const chosen = () => isSelected(ref());
        return (
            <PaperMediaCard
                icon={<MakerLogo icon={maker()?.icon} size="large" />}
                title={cardProps.model.name}
                subtitle={maker()?.name}
                description={cardProps.model.description}
                descriptionExtra={<FitMeter fit={fitFor(selected().bytes, selected().context)} />}
                footerLeft={
                    <PaperText size={1} color="text-subtle">
                        {formatBytes(selected().bytes)} · {Math.round(selected().context / 1024)}K context
                    </PaperText>
                }
                footerRight={
                    <Show when={installed() || pulling()}>
                        <PaperBadge variant={installed() ? "success" : "monochrome"} icon={installed() ? "check" : "download"}>
                            {installed() ? "Downloaded" : "Downloading"}
                        </PaperBadge>
                    </Show>
                }
                class={chosen() ? styles.chosen : undefined}
                onClick={() => {
                    if (mode() === "choose") choose(ref());
                    else setDetail(cardProps.model);
                }}
            />
        );
    }

    return (
        <div class={[styles.ModelBrowser, props.class].filter(Boolean).join(" ")} ref={root}>
            <PaperInput
                icon="search"
                fullWidth
                aria-label="Search models"
                placeholder={isEndpoint() ? "Search models" : "Search by name, maker or use"}
                value={query()}
                onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    setPage(1);
                }}
            />
            <Show when={!isEndpoint()}>
            <div class={styles.sortRow}>
                <PaperSelectMenu
                    name="model-sort"
                    aria-label="Sort models"
                    value={sort()}
                    onValueChange={(value) => {
                        setSort(value as CatalogSort);
                        setPage(1);
                    }}
                >
                    <PaperSelectMenuItem value="newest">Newest first</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="downloads">Most downloaded</PaperSelectMenuItem>
                </PaperSelectMenu>
            </div>
            </Show>

            <Show when={error()}>
                <div class={styles.error} role="alert">
                    <PaperText size={2} color="danger">{error()}</PaperText>
                    <PaperButton icon size="tiny" variant="text" aria-label="Dismiss error" onClick={() => setError("")}>close</PaperButton>
                </div>
            </Show>

            <Show when={state.provider.id === OLLAMA_PROVIDER_ID && (state.runtime.status === "installing" || state.runtime.status === "starting")}>
                <div class={styles.pulls} aria-label="Preparing the model provider">
                    <div class={styles.pull}>
                        <div class={styles.pullHead}>
                            <PaperText size={2} weight={600} truncate>
                                {state.runtime.status === "installing"
                                    ? `Installing ${providerFor(OLLAMA_PROVIDER_ID).label}...`
                                    : `Starting ${providerFor(OLLAMA_PROVIDER_ID).label}...`}
                            </PaperText>
                            <PaperText size={1} color="text-muted">
                                {state.runtime.status === "installing" ? `${state.runtime.install?.percent ?? 0}%` : ""}
                            </PaperText>
                        </div>
                        <Show when={state.runtime.status === "installing"}>
                            <PaperProgress
                                value={state.runtime.install?.percent ?? 0}
                                max={100}
                                aria-label={`Installing ${providerFor(OLLAMA_PROVIDER_ID).label}`}
                            />
                        </Show>
                    </div>
                </div>
            </Show>

            <Show when={state.pulls.length > 0}>
                <div class={styles.pulls} aria-label="Downloads in progress">
                    <For each={state.pulls}>
                        {(p) => (
                            <div class={styles.pull}>
                                <div class={styles.pullHead}>
                                    <PaperText size={2} weight={600} truncate>{p.model}</PaperText>
                                    <PaperText size={1} color="text-muted">
                                        {p.totalBytes > 0 ? `${Math.round((p.completedBytes / p.totalBytes) * 100)}% · ${formatBytes(p.completedBytes)} of ${formatBytes(p.totalBytes)}` : `${providerLabel(p.provider)} · ${p.status}`}
                                    </PaperText>
                                    <PaperButton size="tiny" onClick={() => void call(UI_ACTION_IDS.cancelPull, { model: p.model }).catch((err) => setError(errorText(err)))}>
                                        Cancel
                                    </PaperButton>
                                </div>
                                <PaperProgress value={p.completedBytes} max={Math.max(1, p.totalBytes)} aria-label={`Downloading ${p.model}`} />
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            <Show when={isEndpoint()}>
                <PaperText preset="section">Available models</PaperText>
                <Show
                    when={endpointResults().length > 0}
                    fallback={<PaperEmptyState icon="search_off" title="No models match" description="Try another search." />}
                >
                    <PaperMediaCardGroup>
                        <For each={endpointVisible()}>{(m) => <InstalledCard model={m} endpoint />}</For>
                    </PaperMediaCardGroup>
                    <PaperPagination
                        page={page()}
                        pageCount={endpointPageCount()}
                        onPageChange={goToPage}
                        label="Model pages"
                    />
                    <PaperText size={1} color="text-muted" class={styles.count}>
                        {endpointResults().length} model{endpointResults().length === 1 ? "" : "s"}
                    </PaperText>
                </Show>
            </Show>

            <Show when={!isEndpoint()}>
            <Show when={state.models.length > 0}>
                <PaperText preset="section">On this computer</PaperText>
                <PaperMediaCardGroup>
                    <For each={state.models}>{(m) => <InstalledCard model={m} />}</For>
                </PaperMediaCardGroup>
            </Show>

            <PaperText preset="section">Library</PaperText>
            <Show
                when={results().length > 0}
                fallback={<PaperEmptyState icon="search_off" title="No models match" description="Try another search, or download a model by name below." />}
            >
                <PaperMediaCardGroup>
                    <For each={visible()}>{(m) => <CatalogCard model={m} />}</For>
                </PaperMediaCardGroup>
                <PaperPagination
                    page={page()}
                    pageCount={pageCount()}
                    onPageChange={goToPage}
                    label="Model library pages"
                />
                <PaperText size={1} color="text-muted" class={styles.count}>
                    {results().length} model{results().length === 1 ? "" : "s"}
                </PaperText>
            </Show>
            </Show>

            <Show when={state.provider.id === OLLAMA_PROVIDER_ID}>
            <div class={styles.byName}>
                <PaperText size={1} color="text-muted">Not listed? Download any Ollama library model by name.</PaperText>
                <div class={styles.byNameRow}>
                    <PaperInput
                        fullWidth
                        aria-label="Model name"
                        placeholder="qwen3:8b"
                        value={byName()}
                        onInput={(e) => setByName(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === "Enter" && void downloadByName()}
                    />
                    <PaperButton
                        disabled={!byName().trim()}
                        onClick={downloadByName}
                    >
                        <PaperIcon>download</PaperIcon> Download
                    </PaperButton>
                </div>
            </div>
            </Show>

            <ModelDetailModal
                model={detail()}
                tag={detail() ? tagOf(detail()!) : ""}
                onTagChange={(tag) => {
                    const model = detail();
                    if (model) setTags(model.name, tag);
                }}
                onClose={() => setDetail(null)}
                onPick={mode() === "pick" ? props.onPick : undefined}
            />

            <PaperModal
                open={confirmDelete() !== null}
                onClose={() => !deleting() && setConfirmDelete(null)}
                title={`Delete ${confirmDelete() ?? "model"}?`}
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setConfirmDelete(null)} disabled={deleting()}>Keep it</PaperButton>
                        <PaperButton variant="danger" onClick={remove} disabled={deleting()}>Delete</PaperButton>
                    </>
                }
            >
                <PaperText>The model's files are removed from this computer. You can download it again later.</PaperText>
            </PaperModal>
        </div>
    );
}
