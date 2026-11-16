// One project's flows on the editor's canvas: the blocks they're drawn
// with, defined from the registry and from the schemas they were saved with
// while a panel is away; loading them, and saving each edit. Refreshes of
// the blocks run one at a time, in the order they were asked for, so an
// older registry answer never lands over a newer one.
import { createSignal } from "solid-js";
import * as Blockly from "blockly";
import { createLatest } from "@mileniumhq/paperui";
import { blocksApi, panelsApi, type BlockInfo, type BlockProjectInfo, type PanelItem, errorMessage } from "@mileniumhq/paperapi";
import { BUILTIN_BLOCKS, choicesSources, registryDefinitions, type Definitions } from "./lib/blockDefs";
import { refreshChoices } from "./lib/choicesField";
import { assignPanelStyles, blockFill } from "./lib/blockStyles";
import { setResultBlocks, sourceOf } from "./lib/results";
import { parseRegistryBlockType } from "./lib/names";
import { appendWorkspace } from "./lib/appendWorkspace";
import { uiGap } from "./lib/libraryFlyout";
import type { SavedWorkspace } from "./lib/interpreter";
import { MAX_PREVIEW_BLOCKS, MAX_PREVIEW_PATH, type CanvasPreview, type SavedFlows } from "./panel";
import { service, type Notice } from "./bridge";

type Json = Record<string, unknown>;
type Schemas = SavedFlows["schemas"];

/** the notice a failed save leaves, cleared by the next save that works */
export const NOT_SAVED = "Your changes weren't saved";
const SAVE_DELAY_MS = 400;

// why the edits sent as an editor closed didn't save: the editor is gone, so the page says it
const [closedUnsaved, setClosedUnsaved] = createSignal<string | null>(null);
export { closedUnsaved, setClosedUnsaved };

/** What the registry offers, as the Library shows it. */
export interface Registry {
    panels: PanelItem[];
    projects: BlockProjectInfo[];
    sections: Definitions["sections"];
}

/** Replaces block definitions, so a registry change redefines them without a warning per block. */
export function define(blocks: Json[]): void {
    for (const block of blocks) delete Blockly.Blocks[block.type as string];
    Blockly.common.defineBlocksWithJsonArray(blocks);
}

/** An outline's numbers to a tenth of a pixel: finer than a card's miniature can show. */
const roundOutline = (path: string) => path.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, (n) => String(Math.round(Number(n) * 10) / 10));

/** The canvas in miniature, for the project's card: each block's outline where it sits, in its colour. */
function canvasPreview(workspace: Blockly.WorkspaceSvg): CanvasPreview | null {
    // Blockly draws a change on the next frame: a block just dropped into another is drawn in place first
    Blockly.renderManagement.triggerQueuedRenders(workspace);
    const stacks = workspace.getTopBlocks(false).map((block) => block.getBoundingRectangle());
    if (!stacks.length) return null;
    const left = Math.min(...stacks.map((r) => r.left));
    const top = Math.min(...stacks.map((r) => r.top));
    const right = Math.max(...stacks.map((r) => r.right));
    const bottom = Math.max(...stacks.map((r) => r.bottom));
    // each stack's blocks in order, a block before what it holds: what it holds is drawn over it, as on the canvas
    const blocks = workspace
        .getAllBlocks(true)
        .filter((block) => !block.isInsertionMarker())
        .map((block) => {
            const at = block.getRelativeToSurfaceXY();
            return { x: at.x, y: at.y, path: roundOutline(block.pathObject.svgPath.getAttribute("d") ?? ""), fill: blockFill(block) };
        })
        // a block too intricate to keep in miniature is left out of it, as are the blocks past the most a card draws
        .filter((block) => block.path.length <= MAX_PREVIEW_PATH)
        .slice(0, MAX_PREVIEW_BLOCKS);
    return { bounds: { x: left, y: top, w: right - left, h: bottom - top }, blocks };
}

export function createEditorFlows(options: {
    project: () => string;
    workspace: () => Blockly.WorkspaceSvg | undefined;
    /** what the registry offers now, each time the blocks are defined again */
    onRegistry: (registry: Registry) => void;
    onNotice: (notice: Notice) => void;
    /** a save went through */
    onSaved: () => void;
    /** the flows are on the canvas */
    onLoaded: () => void;
}) {
    const fail = (title: string) => (err: unknown) => options.onNotice({ kind: "failed", title, text: errorMessage(err) });
    const canvas = () => {
        const workspace = options.workspace();
        if (!workspace) throw new Error("The canvas isn't drawn yet");
        return workspace;
    };
    // the schemas of the blocks on the canvas, as last seen: saved with the flows
    let schemas: Schemas = {};
    // the other schemas each block needs saved beside its own
    let uses: Definitions["uses"] = {};
    let live = new Set<string>();
    // the canvas shows the project's flows: until then, and after a load that failed, it holds nothing to save
    const [loaded, setLoaded] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    // an edit the service doesn't hold yet: from the edit until a save made after it lands
    const [unsaved, setUnsaved] = createSignal(false);
    let edits = 0;
    // the editor has gone: a load that answers now has no canvas to show it on
    let closed = false;
    // the save in flight, so leaving waits for it
    let saving: Promise<void> = Promise.resolve();
    // the refresh of the blocks in flight, which the next one waits for
    let refreshing: Promise<void> = Promise.resolve();
    // the canvas as the service holds it (once the saves sent have landed), or null when
    // that isn't known: Blockly reports a load, a theme or a warning as a change too, and a
    // change that leaves the canvas as it is stored is not an edit, so it saves nothing
    let stored: string | null = null;

    /**
     * Defines every block the registry and `saved` name, and keeps what the Library shows.
     * `shown` holds the schemas of the blocks the canvas shows (or is about to).
     */
    async function defineBlocks(saved: Schemas, shown: Schemas): Promise<void> {
        const [entries, panelList, projects] = await Promise.all([blocksApi.list(), panelsApi.list(), blocksApi.projects()]);
        // ask for every dropdown's choices now, so the canvas and the Library show them. One on the canvas that
        // fails says so here; one only in the Library says so when its dropdown is opened, which asks again,
        // so a panel that isn't set up yet doesn't warn in every project
        // (a type's values, when its panel has a block on the canvas)
        const onCanvas = new Set(Object.values(shown).flatMap((s) => [`${s.panelId}\u0000${s.entry}`, s.panelId]));
        await Promise.all(
            choicesSources(entries, projects).map((source) =>
                refreshChoices(source).catch((err: unknown) => {
                    const panelId = "typeRef" in source ? source.typeRef.slice(0, source.typeRef.indexOf(":")) : source.panelId;
                    if (!onCanvas.has("typeRef" in source ? panelId : `${source.panelId}\u0000${source.entry}`)) return;
                    fail(`${panelList.find((p) => p.id === panelId)?.name ?? panelId}'s choices didn't load`)(err);
                }),
            ),
        );
        // each panel's colour, worked out over every panel at once so two never share one
        assignPanelStyles([...entries.map((e) => e.panelId), ...Object.values(saved).map((s) => s.panelId)]);
        const liveDefs = registryDefinitions(entries, projects);
        live = new Set(Object.keys(liveDefs.schemas));
        // a block whose panel is away keeps the shape it was saved with
        const away: BlockInfo[] = Object.entries(saved)
            .filter(([type]) => !live.has(type))
            .map(([, s]) => ({ panelId: s.panelId, entry: s.entry, schema: s.schema }));
        const awayDefs = registryDefinitions(away);
        define([...BUILTIN_BLOCKS, ...awayDefs.blocks, ...liveDefs.blocks]);
        schemas = { ...awayDefs.schemas, ...liveDefs.schemas };
        uses = { ...awayDefs.uses, ...liveDefs.uses };
        setResultBlocks({ ...awayDefs.results, ...liveDefs.results });
        options.onRegistry({ panels: panelList, projects, sections: liveDefs.sections });
    }

    /** Defines the blocks once the refresh before it is done; `saved` and `shown` are read as it starts. */
    function refreshBlocks(saved: () => Schemas, shown: () => Schemas = saved): Promise<void> {
        // quiet: the earlier refresh's caller got its failure; this only orders the next one
        const next = refreshing.catch(() => undefined).then(() => defineBlocks(saved(), shown()));
        refreshing = next;
        return next;
    }

    // a registry change waiting to start: the changes after it are in its answer too
    let changeWaiting = false;
    /**
     * The registry changed: the blocks are defined again, every one known kept, and
     * the choices that fail are said for the blocks the canvas holds by then.
     */
    function registryChanged(): void {
        if (changeWaiting) return;
        changeWaiting = true;
        refreshBlocks(() => {
            changeWaiting = false;
            return schemas;
        }, canvasSchemas).then(markAway, fail("The blocks couldn't be updated"));
    }

    /** Marks the blocks whose panel isn't offering them right now. */
    function markAway(): void {
        const workspace = options.workspace();
        if (!workspace) return;
        for (const block of workspace.getAllBlocks(false)) {
            const saved = schemas[block.type];
            if (!saved) continue;
            block.setWarningText(live.has(block.type) ? null : `${saved.schema.name} isn't available: its panel isn't running`, "away");
        }
        markResults();
    }

    /** Marks the result blocks whose block is gone, so they'd have nothing to read. */
    function markResults(): void {
        for (const block of options.workspace()?.getAllBlocks(false) ?? []) {
            if (parseRegistryBlockType(block.type)?.kind !== "result" || block.isInFlyout) continue;
            block.setWarningText(sourceOf(block) ? null : "The block this reads is gone. Drag a new one out of its gear", "result");
        }
    }

    /** The schemas of the blocks on the canvas, and of what they use. */
    function canvasSchemas(): Schemas {
        const used = new Set((options.workspace()?.getAllBlocks(false) ?? []).flatMap((b) => [b.type, ...(uses[b.type] ?? [])]));
        return Object.fromEntries(Object.entries(schemas).filter(([type]) => used.has(type)));
    }

    /** The canvas as it is now, with the schemas of the blocks on it. */
    function snapshot(): SavedFlows {
        const workspace = canvas();
        if (!loaded()) throw new Error("The flows haven't loaded, so the canvas holds none of them");
        return { workspace: Blockly.serialization.workspaces.save(workspace) as SavedWorkspace, schemas: canvasSchemas() };
    }

    /**
     * Saves the canvas now, when it differs from what the service holds;
     * rejects with why it didn't save. A canvas whose flows didn't load is
     * read-only, so it has nothing to save.
     */
    async function saveNow(): Promise<void> {
        clearTimeout(saveTimer);
        const workspace = options.workspace();
        if (!workspace || !loaded()) return saving;
        // the canvas is read now, before anything is waited on
        const flows = snapshot();
        const seen = edits;
        const text = JSON.stringify(flows.workspace);
        if (text !== stored) {
            stored = text;
            const preview = canvasPreview(workspace);
            saving = saving
                // quiet: the earlier save's failure was shown by its own handler; this only orders the next one
                .catch(() => undefined)
                .then(() => service.saveFlows({ project: options.project(), flows, preview }))
                .then(options.onSaved, (err: unknown) => {
                    stored = null;
                    throw err;
                });
        }
        await saving;
        if (seen === edits) setUnsaved(false);
    }

    // a save that failed is said in the editor, or by the page once the editor has closed
    const notSaved = (err: unknown) => (closed ? setClosedUnsaved(errorMessage(err)) : fail(NOT_SAVED)(err));
    /** Saves what isn't saved yet, as the editor or the page goes: the canvas is read as it is, even before Blockly tells of its last change. */
    const saveLeaving = () => void saveNow().catch(notSaved);
    window.addEventListener("pagehide", saveLeaving);

    /**
     * A change on the canvas: an edit is saved once the edits pause. A change
     * that leaves the canvas as the service holds it (a load, a theme, a
     * warning) is not one, so the page isn't marked unsaved for it.
     */
    function edited(): void {
        if (!loaded() || closed) return;
        if (!unsaved() && JSON.stringify(snapshot().workspace) === stored) return;
        edits++;
        setUnsaved(true);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void saveNow().catch(notSaved), SAVE_DELAY_MS);
    }

    /** The project goes with its edits (it is being deleted): none still waiting is sent. */
    function discard(): void {
        clearTimeout(saveTimer);
        edits++;
        setUnsaved(false);
    }

    /** Saves the latest edits now, saying why when they didn't save. */
    async function flush(): Promise<{ ok: true } | { ok: false; message: string }> {
        try {
            await saveNow();
            return { ok: true };
        } catch (err) {
            return { ok: false, message: errorMessage(err) };
        }
    }

    // the newest load: an older one that answers late leaves the canvas to it
    const loads = createLatest();
    /**
     * Shows the flows the service has now: on opening, after a backup is
     * loaded, or again after a load that failed. Until they're shown the
     * canvas is read-only; a load that fails leaves it so, and says why
     * (loadError).
     */
    async function load(): Promise<void> {
        const workspace = canvas();
        const current = loads();
        // the canvas shows what the service has, in place of any edit not sent
        discard();
        setLoaded(false);
        workspace.setIsReadOnly(true);
        try {
            const flows = await service.loadFlows({ project: options.project() });
            await refreshBlocks(() => flows.schemas);
            if (!current() || closed) return;
            Blockly.serialization.workspaces.load(flows.workspace, workspace);
            markAway();
            workspace.setIsReadOnly(false);
            setLoadError(null);
            setLoaded(true);
            stored = JSON.stringify(snapshot().workspace);
            options.onLoaded();
        } catch (err) {
            if (current()) setLoadError(errorMessage(err));
        }
    }

    /** A file's flows, added below what the canvas holds, and saved. */
    async function addFlows(flows: SavedFlows): Promise<void> {
        const workspace = canvas();
        if (!loaded()) throw new Error("The canvas has not loaded yet, so nothing can be added to it.");
        // the file's blocks take their shape from its schemas where their panel is away
        await refreshBlocks(
            () => ({ ...flows.schemas, ...schemas }),
            () => ({ ...flows.schemas, ...canvasSchemas() }),
        );
        const below = workspace.getTopBlocks(false).reduce((y, b) => Math.max(y, b.getBoundingRectangle().bottom), -Infinity);
        const fileTop = Math.min(...(flows.workspace.blocks?.blocks ?? []).map((b) => b.y ?? 0));
        const shift = Number.isFinite(below) && Number.isFinite(fileTop) ? below + uiGap() * 4 - fileTop : 0;
        appendWorkspace(workspace, flows.workspace, shift);
        markAway();
        await saveNow();
    }

    return {
        loaded,
        loadError,
        /** an edit the service doesn't hold yet, or whose save failed */
        unsaved,
        load,
        registryChanged,
        markResults,
        snapshot,
        saveNow,
        edited,
        discard,
        flush,
        addFlows,
        /** the schema a block on the canvas was defined from, if it is a registry block */
        schemaOf: (type: string) => schemas[type]?.schema,
        /** The editor goes: what isn't saved is sent from the canvas as it is now, before the canvas goes. */
        dispose: () => {
            closed = true;
            window.removeEventListener("pagehide", saveLeaving);
            saveLeaving();
        },
    };
}
