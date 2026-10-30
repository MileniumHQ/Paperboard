// One project's canvas document: its flows, notes and functions, saved
// through the service and followed as other windows save. The service owns the
// document; this window saves with the revision its edits were made on, and
// follows revisions other windows (on any computer) save. Edits stay this
// window's until saved.
import { createSignal, onCleanup, onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { actions as actionsApi } from "@mileniumhq/paperapi";
import { ACTIONS_PANEL_ID } from "../panelId";
import type { CanvasNote } from "../components/NoteBlock";
import { createCanvasFollower, createCanvasSync, type CanvasSyncState } from "../lib/canvasSync";
import {
    CANVAS_CHANGED_EVENT,
    isCanvasConflict,
    type CanvasDocument,
    type CanvasSaveResult,
    type CanvasSnapshot,
} from "../lib/canvasDoc";
import { updateTypeCatalog } from "../lib/typeCatalog";
import { BUILTIN_SCHEMA_ENTRIES } from "../lib/builtins";
import { addFlowFile } from "../lib/flowFile";
import {
    type CanvasBlock,
    mergeActionSchemas,
    isCanvasBlock,
    removeBlock,
    updateBlockValue,
    findBlock,
    blockVariableName,
    renameBlockVariable,
    relabelVariableRefs,
} from "../lib/tree";
import { type FunctionDef, createFunctionId, renameFunctionInFlows } from "../lib/functions";

export type CanvasDocumentState = ReturnType<typeof createCanvasDocument>;

export function createCanvasDocument(projectId: string) {
    const projectAction = (action: string) => `${projectId}/${action}`;
    const [blocks, setBlocks] = createStore<CanvasBlock[]>([]);
    const [notes, setNotes] = createStore<CanvasNote[]>([]);
    const [functions, setFunctions] = createSignal<FunctionDef[]>([]);

    const [syncState, setSyncState] = createSignal<CanvasSyncState>({ status: "applied" });
    const [conflictNotice, setConflictNotice] = createSignal<string | null>(null);
    const [loaded, setLoaded] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);
    let disposed = false;

    const clientId = crypto.randomUUID();
    let canvasRevision = 0;
    let lastSave: CanvasSaveResult | null = null;
    // a refused save made only of a schema refresh loses nothing: the
    // reload and the next refresh redo it, so it is not reported
    let userEditUnsaved = false;
    let conflicted = false;
    const sync = createCanvasSync<CanvasDocument>({
        save: async (snapshot) => {
            try {
                lastSave = await actionsApi.call<CanvasSaveResult>(ACTIONS_PANEL_ID, projectAction("save-canvas"), {
                    canvas: snapshot,
                    baseRevision: canvasRevision,
                    clientId,
                });
                canvasRevision = lastSave.revision;
            } catch (err) {
                if (!isCanvasConflict(err)) throw err;
                conflicted = true;
                throw new Error("the canvas changed in another window first");
            }
        },
        // the service applied the flows as it saved them; report what it said
        apply: async () => {
            if (lastSave?.applyError) throw new Error(lastSave.applyError);
        },
        onState: (state) => {
            if (state.status === "applied") {
                userEditUnsaved = false;
                setSyncState(state);
                void follower.idle();
                return;
            }
            if (state.status === "error" && conflicted) {
                conflicted = false;
                if (userEditUnsaved) {
                    setConflictNotice("This canvas was changed in another window at the same moment, so your last change was not saved. It now shows the latest version.");
                }
                userEditUnsaved = false;
                setSyncState({ status: "applied" });
                void follower.reload().then(() => refreshSchemas());
                return;
            }
            setSyncState(state);
        },
    });
    // the highest layer given out; a loaded canvas raises it to its own top,
    // so bringing a block forward clears everything already stacked
    let maxZIndex = 10;
    const show = (snapshot: CanvasSnapshot) => {
        // stored flows are executable content: drop malformed blocks
        // loudly instead of rendering them into the canvas
        const clean = snapshot.canvas.flows.filter(isCanvasBlock);
        if (clean.length !== snapshot.canvas.flows.length) {
            throw new Error("Stored canvas contains malformed blocks; repair the document before applying flows");
        }
        setFunctions(snapshot.canvas.functions);
        // keyed by id, so blocks and notes update in place instead of remounting
        setBlocks(reconcile(clean, { key: "id" }));
        setNotes(reconcile(snapshot.canvas.notes as CanvasNote[], { key: "id" }));
        for (const placed of [...clean, ...(snapshot.canvas.notes as CanvasNote[])]) {
            if (typeof placed.zIndex === "number") maxZIndex = Math.max(maxZIndex, placed.zIndex);
        }
        canvasRevision = snapshot.revision;
    };
    const fetchCanvas = () => actionsApi.call<CanvasSnapshot>(ACTIONS_PANEL_ID, projectAction("get-canvas"));
    const follower = createCanvasFollower<CanvasSnapshot>({
        clientId,
        fetch: fetchCanvas,
        revision: () => canvasRevision,
        busy: () => !loaded() || syncState().status === "pending" || syncState().status === "saving",
        show: (snapshot) => {
            try {
                show(snapshot);
            } catch (err) {
                setSyncState({ status: "error", message: `Changes from another window could not be shown: ${err instanceof Error ? err.message : String(err)}` });
            }
        },
        onError: (message) => setSyncState({ status: "error", message }),
    });
    onCleanup(() => { disposed = true; sync.dispose(); follower.dispose(); });
    onMount(() => {
        const off = actionsApi.on(ACTIONS_PANEL_ID, CANVAS_CHANGED_EVENT, (change: any) => {
            if (change?.project !== projectId) return;
            void follower.changed(change);
        });
        onCleanup(off);
    });

    const snapshot = (): CanvasDocument => ({ flows: unwrap(blocks), notes: unwrap(notes), functions: functions() });

    const schedule = (currentBlocks?: CanvasBlock[], currentNotes?: CanvasNote[]) => {
        if (!loaded() || disposed) return;
        try {
            sync.schedule({ flows: currentBlocks ?? blocks, notes: currentNotes ?? notes, functions: functions() });
        } catch (err) {
            setSyncState({ status: "error", message: `Canvas could not be prepared for saving: ${String(err)}` });
        }
    };
    /** Saves a user's edit; pass the new tree when the store isn't set yet. */
    const save = (currentBlocks?: CanvasBlock[], currentNotes?: CanvasNote[]) => {
        if (!loaded() || disposed) return;
        userEditUnsaved = true;
        setConflictNotice(null);
        schedule(currentBlocks, currentNotes);
    };
    const retrySave = () => {
        userEditUnsaved = true;
        schedule();
    };

    let loading = false;
    const load = async () => {
        if (loading || disposed) return;
        loading = true;
        setLoadError(null);
        try {
            const fetched = await fetchCanvas();
            if (disposed) return;
            show(fetched);
            // Hydrate the entire document before any refresh can save it.
            setLoaded(true);
            await refreshSchemas();
        } catch (err) {
            // the reason alone: the page around it says what failed
            if (!disposed) setLoadError(err instanceof Error ? err.message : String(err));
        } finally {
            loading = false;
        }
    };
    onMount(() => { void load(); });

    let refreshPending = false;
    let refreshing: Promise<void> | undefined;
    const refreshSchemas = (): Promise<void> => {
        if (!loaded() || disposed) return Promise.resolve();
        refreshPending = true;
        if (!refreshing) refreshing = (async () => {
            while (refreshPending && !disposed) {
                refreshPending = false;
                try {
                    const acts = await actionsApi.list();
                    if (disposed) return;
                    updateTypeCatalog(acts.flatMap((act) => (act.schema ? [act.schema] : [])));
                    // Merge into the current canvas after the request, so
                    // edits made while listing cannot be overwritten.
                    const merged = mergeActionSchemas(blocks, [...acts, ...BUILTIN_SCHEMA_ENTRIES]);
                    // every window refreshes on a registry change; only a
                    // refresh that changed something is saved, so windows do
                    // not race each other to write the same canvas
                    if (JSON.stringify(merged) === JSON.stringify(blocks)) continue;
                    setBlocks(reconcile(merged, { key: "id" }));
                    schedule();
                } catch (err) {
                    if (!disposed) setSyncState({ status: "error", message: `Action schemas could not be refreshed: ${String(err)}` });
                    return;
                }
            }
        })().finally(() => { refreshing = undefined; });
        return refreshing;
    };
    onMount(() => {
        // panels register after this panel may have loaded, so schemas are
        // refreshed whenever the registry changes
        const unsubscribe = actionsApi.onRegistryChange(() => {
            void refreshSchemas();
        });
        onCleanup(unsubscribe);
    });

    /** Reloads the saved document over this window's, as a file restore does. */
    const reload = async () => {
        const result = await follower.reload();
        if (result.ok) await refreshSchemas();
        return result;
    };

    /**
     * An imported flow file goes beside what is on the canvas, with new ids.
     * Returns what it added, so the view can scroll to it.
     */
    const addFile = (file: CanvasDocument, leftInset: number) => {
        const had = new Set<string>([...blocks.map((b) => b.id), ...notes.map((n) => n.id)]);
        const merged = addFlowFile(snapshot(), file, (kind) => `${kind}_${crypto.randomUUID()}`, leftInset);
        setFunctions(merged.functions);
        setBlocks(reconcile(merged.flows, { key: "id" }));
        setNotes(reconcile(merged.notes as CanvasNote[], { key: "id" }));
        save();
        void refreshSchemas();
        return [...merged.flows, ...(merged.notes as CanvasNote[])].filter((i) => !had.has(i.id));
    };

    const createFunction = (name: string, params: { name: string; type: string }[]) => {
        const def: FunctionDef = {
            id: createFunctionId(),
            name: name.trim(),
            params: params.map((p) => ({ name: p.name.trim(), type: p.type })),
        };
        setFunctions((prev) => [...prev, def]);
        save();
    };

    const deleteFunction = (fid: string) => {
        setFunctions((prev) => prev.filter((f) => f.id !== fid));
        save();
    };

    const renameFunction = (fid: string, name: string) => {
        const clean = name.trim().replace(/[{}:]/g, "");
        if (!clean) return;
        const def = functions().find((f) => f.id === fid);
        if (!def || def.name === clean) return;
        const renamed: FunctionDef = { ...def, name: clean };
        setFunctions((prev) => prev.map((f) => (f.id === fid ? renamed : f)));
        const updated = renameFunctionInFlows(blocks, renamed);
        setBlocks(reconcile(updated, { key: "id" }));
        save(updated);
    };

    // stacking: whatever was touched last is drawn on top
    const nextZ = () => ++maxZIndex;
    const bringToFront = (id: string) => setBlocks((b) => b.id === id, "zIndex", nextZ());
    const bringNoteToFront = (id: string) => setNotes((n) => n.id === id, "zIndex", nextZ());

    const setValue = (blockId: string, key: string, value: any) => {
        const updated = updateBlockValue(blocks, blockId, key, value);
        setBlocks(reconcile(updated, { key: "id" }));
        save(updated);
    };

    const deleteBlock = (id: string) => {
        const { blocks: updated } = removeBlock(blocks, id);
        setBlocks(updated);
        save(updated);
    };

    /** Renames the value a block produces, and every chip that shows it. */
    const renameVariable = (id: string, name: string) => {
        const renamed = renameBlockVariable(blocks, id, name);
        const renamedBlock = findBlock(renamed, id);
        const displayLabel = (renamedBlock && blockVariableName(renamedBlock)) || "Result";
        const updated = relabelVariableRefs(renamed, id, displayLabel);
        setBlocks(reconcile(updated, { key: "id" }));
        save(updated);
    };

    const addNote = (pos: { x: number; y: number }) => {
        const updated = [...notes, { id: `note_${Date.now()}`, pos, zIndex: nextZ(), text: "" }];
        setNotes(updated);
        save(undefined, updated);
    };

    const deleteNote = (id: string) => {
        const updated = notes.filter((n) => n.id !== id);
        setNotes(updated);
        save(undefined, updated);
    };

    const setNoteText = (id: string, text: string) => {
        setNotes((n) => n.id === id, "text", text);
        save();
    };

    return {
        projectId,
        blocks,
        setBlocks,
        notes,
        setNotes,
        functions,
        clientId,
        loaded,
        loadError,
        load,
        syncState,
        conflictNotice,
        dismissConflict: () => setConflictNotice(null),
        save,
        retrySave,
        flush: () => sync.flush(),
        reload,
        snapshot,
        addFile,
        createFunction,
        deleteFunction,
        renameFunction,
        nextZ,
        bringToFront,
        bringNoteToFront,
        setValue,
        deleteBlock,
        renameVariable,
        addNote,
        deleteNote,
        setNoteText,
    };
}
