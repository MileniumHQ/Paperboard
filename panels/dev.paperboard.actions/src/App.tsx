import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

// console log ring: newest entries win, oldest drop past the cap
const MAX_CONSOLE_LOGS = 500;
import ActionBlock from "./components/ActionBlock";
import NoteBlock, { type CanvasNote } from "./components/NoteBlock";
import ActionLibrary from "./components/ActionLibrary";
import VariableMenu from "./components/VariableMenu";
import ActionDropdownMenu from "./components/ActionDropdownMenu";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
    PaperIcon,
    PaperButton,
    PaperEffect,
    PaperText,
    PaperModal,
    PaperInput,
    PaperFlex,
} from "@paperboard-dev/paperui";
import {
    config as configApi,
    actions as actionsApi,
    getType,
    type ActionInfo,
    type TriggerInfo,
} from "@paperboard-dev/paperapi";
import { ACTIONS_PANEL_ID } from "./panelId";
import { variableFieldIcon } from "./lib/variableTypes";
import { filterPickerItems } from "./lib/variablePicker";
import {
    type CanvasBlock,
    removeBlock,
    insertBlock,
    updateBlockValue,
    findBlock,
    findOwnerTrigger,
    blockVariableName,
    renameBlockVariable,
    relabelVariableRefs,
    mergeActionSchemas,
    isCanvasBlock,
} from "./lib/tree";
import {
    type FunctionDef,
    functionIdFromCallAction,
    functionIdFromTriggerAction,
    createFunctionId,
    buildCallSchema,
    buildTriggerSchema,
} from "./lib/functions";
import "@paperboard-dev/paperui/style.css";
import "./style.css";

export default function App() {
    const [scroll, setScroll] = createSignal({ x: 0, y: 0 });

    const viewportScroll = () => {
        const el = containerRef;
        return { x: el ? el.scrollLeft : 0, y: el ? el.scrollTop : 0 };
    };
    const [isPanning, setIsPanning] = createSignal(false);
    const [hoverDropTarget, setHoverDropTarget] = createSignal<{
        parentId: string;
        insertIndex: number;
    } | null>(null);
    const [isOverTrash, setIsOverTrash] = createSignal(false);
    const [draggingCanvasBlockId, setDraggingCanvasBlockId] = createSignal<string | null>(null);

    const [runningBlockIds, setRunningBlockIds] = createSignal<Set<string>>(new Set());

    let maxZIndex = 10;

    const [ghostDrag, setGhostDrag] = createSignal<{
        id?: string;
        panelId: string;
        item: ActionInfo | TriggerInfo;
        isTrigger: boolean;
        iconSrc?: string;
        pos: { x: number; y: number };
        grabOffset: { x: number; y: number };
        values?: Record<string, any>;
        children?: CanvasBlock[];
        detachedFrom?: {
            originalParentId: string | null;
            originalIndex: number;
            block: CanvasBlock;
        };
    } | null>(null);

    // a press on a nested action only becomes a drag after the pointer moves
    // past this distance; below it the press is a plain click and the block
    // must stay mounted where it is
    const DRAG_START_THRESHOLD_PX = 4;

    interface PendingChildDrag {
        child: CanvasBlock;
        grabOffset: { x: number; y: number };
        startClient: { x: number; y: number };
        originalParentId: string | null;
        originalIndex: number;
    }

    const [pendingChildDrag, setPendingChildDrag] =
        createSignal<PendingChildDrag | null>(null);

    const blockContextMenu = useContextMenuState("mouse");
    const canvasContextMenu = useContextMenuState("mouse");
    const [canvasContextMenuPos, setCanvasContextMenuPos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
    const [contextBlockId, setContextBlockId] = createSignal<string | null>(null);

    const [variablePicker, setVariablePicker] = createSignal<{
        open: boolean;
        blockId: string;
        paramKey: string;
        x: number;
        y: number;
        availableVariables: {
            id: string;
            label: string;
            sourceBlockId: string;
            sourceName: string;
            icon?: string;
            type?: string;
        }[];
        onInsert?: (varId: string, label: string, icon: string) => void;
    }>({
        open: false,
        blockId: "",
        paramKey: "",
        x: 0,
        y: 0,
        availableVariables: [],
    });

    interface TriggerFieldInfo {
        type: string;
        label?: string;
        typeName?: string;
        icon?: string;
    }
    type TriggerFieldMap = Record<string, TriggerFieldInfo>;

    const typedTriggerFields = (action: any): TriggerFieldMap | null => {
        if (!action || typeof action !== "object") return null;
        // trigger schemas can carry typed output fields directly; the label
        // travels with the field so the picker can name it
        if (
            action.outputFields &&
            typeof action.outputFields === "object" &&
            Object.keys(action.outputFields).length > 0
        ) {
            const map: TriggerFieldMap = {};
            for (const [fieldId, v] of Object.entries<any>(action.outputFields)) {
                map[fieldId] =
                    typeof v === "string"
                        ? { type: v }
                        : {
                              type: v?.type || "any",
                              label: v?.label,
                              typeName: v?.typeName,
                              icon: v?.icon,
                          };
            }
            return map;
        }
        // typed output defined with the PaperAPI schema DSL: derive fields
        // from the registered custom type
        const outType =
            typeof action.output === "string" ? action.output : action.output?.type;
        if (outType) {
            const def = getType(outType);
            if (def?.fields && Object.keys(def.fields).length > 0) {
                const map: TriggerFieldMap = {};
                for (const [fieldId, f] of Object.entries(def.fields)) {
                    map[fieldId] = { type: String(f.type), label: f.label };
                }
                return map;
            }
        }
        return null;
    };

    const [functions, setFunctions] = createSignal<FunctionDef[]>([]);

    const functionTriggerFields = (actionId: string): TriggerFieldMap | null => {
        const fid = functionIdFromTriggerAction(actionId);
        if (!fid) return null;
        const def = functions().find((f) => f.id === fid);
        if (!def) return null;
        const map: TriggerFieldMap = {};
        for (const p of def.params) map[p.name] = { type: p.type, label: p.name };
        return map;
    };

    const appendConsoleLog = (entry: {
        time: string;
        message: string;
        level?: "error";
    }) => {
        // bounded: a long flow-test session must not grow this store forever
        setConsoleLogs((prev) => {
            const next = [
                ...prev,
                {
                    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    ...entry,
                },
            ];
            return next.length > MAX_CONSOLE_LOGS
                ? next.slice(next.length - MAX_CONSOLE_LOGS)
                : next;
        });
    };

    const [hoveredSourceBlockId, setHoveredSourceBlockId] = createSignal<string | null>(null);

    const closeVariablePicker = () => {
        setVariablePicker((prev) => ({ ...prev, open: false }));
        setHoveredSourceBlockId(null);
    };

    const handleRequestVariablePicker = (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        onInsert?: (varId: string, label: string, icon: string) => void,
        expectedType?: string,
        _isArray?: boolean,
    ) => {
        const available: {
            id: string;
            label: string;
            sourceBlockId: string;
            sourceName: string;
            icon?: string;
            type?: string;
            typeName?: string;
        }[] = [];

        for (const trig of blocks) {
            if (trig.id === blockId) {
                break;
            }
            if (!findBlock([trig], blockId)) {
                continue;
            }

            const trigActionId =
                (trig.action as any)?.id ||
                (trig.action as any)?.trigger ||
                "";
                    const fieldTypes =
                        functionTriggerFields(trigActionId) ||
                        (() => {
                            const typed = typedTriggerFields(trig.action);
                            if (!typed) {
                                console.debug(
                                    `[actions] trigger "${trigActionId}" exposes no typed field metadata; variable picker offers only the trigger output`,
                                );
                            }
                            return typed;
                        })();
            if (fieldTypes) {
                for (const [fieldId, field] of Object.entries(fieldTypes)) {
                    const def = getType(field.type);
                    available.push({
                        id: fieldId,
                        label:
                            field.label ||
                            def?.name ||
                            fieldId.charAt(0).toUpperCase() + fieldId.slice(1),
                        sourceBlockId: trig.id,
                        sourceName: trig.action.name,
                        // resolved once, here: the picker displays this icon
                        // and the inserted chip stores the very same one
                        icon: variableFieldIcon(field.type, field.icon),
                        type: field.type,
                        typeName: field.typeName,
                    });
                }
            }

            const trigOutput = trig.action.output;
            // a trigger with typed fields exposes those instead of one opaque
            // output, so the picker never offers "Command Data" next to them
            const hasTypedFields =
                fieldTypes !== null && Object.keys(fieldTypes).length > 0;
            if (trigOutput && !hasTypedFields) {
                const label =
                    typeof trigOutput === "string"
                        ? trigOutput
                        : (trigOutput as any).label || (trigOutput as any).type || "Output";
                const id =
                    typeof trigOutput === "string"
                        ? trigOutput
                        : (trigOutput as any).type || "output";
                const outType =
                    typeof trigOutput === "string"
                        ? trigOutput
                        : (trigOutput as any).type || "any";

                available.push({
                    id,
                    label: label.charAt(0).toUpperCase() + label.slice(1),
                    sourceBlockId: trig.id,
                    sourceName: trig.action.name,
                    icon: trig.action.icon || "bolt",
                    type: outType,
                });

                if (id === "message" || (trig.action as any).id === "chat-message") {
                    available.push({
                        id: "message.sender",
                        label: "Sender",
                        sourceBlockId: trig.id,
                        sourceName: trig.action.name,
                        icon: "person",
                        type: "string",
                    });
                }
            }

            const pushActionOutput = (child: CanvasBlock) => {
                const out = child.action.output;
                if (!out) return;
                available.push({
                    id: child.id,
                    label: blockVariableName(child) || "Result",
                    sourceBlockId: child.id,
                    sourceName: child.action.name,
                    icon: child.action.icon || "terminal",
                    type: typeof out === "string" ? out : (out as any).type || "any",
                });
            };
            const visitInOrder = (list: CanvasBlock[]): boolean => {
                for (const child of list) {
                    if (child.id === blockId) return true;
                    pushActionOutput(child);
                    if (child.children && visitInOrder(child.children)) return true;
                    if (child.elseChildren && visitInOrder(child.elseChildren)) return true;
                }
                return false;
            };
            visitInOrder(trig.children || []);
            break;
        }

        const labelCounts = new Map<string, number>();
        for (const v of available) {
            const k = v.label.toLowerCase();
            labelCounts.set(k, (labelCounts.get(k) || 0) + 1);
        }
        const labelSeen = new Map<string, number>();
        for (const v of available) {
            const k = v.label.toLowerCase();
            if ((labelCounts.get(k) || 0) > 1) {
                const n = (labelSeen.get(k) || 0) + 1;
                labelSeen.set(k, n);
                v.label = `${v.label} ${n}`;
            }
        }

        // an empty result still opens: the menu's empty state is the
        // feedback, a silent no-op reads as a broken control
        const filtered = filterPickerItems(available, expectedType);

        setVariablePicker({
            open: true,
            blockId,
            paramKey,
            x,
            y,
            availableVariables: filtered,
            onInsert,
        });
    };

    const selectVariable = (v: { id: string; label: string; icon?: string }) => {
        const picker = variablePicker();
        if (picker.onInsert) {
            picker.onInsert(v.id, v.label, v.icon || "bolt");
        } else if (picker.blockId && picker.paramKey) {
            handleValueChange(picker.blockId, picker.paramKey, `{{${v.id}:${v.label}:${v.icon || "bolt"}}}`);
        }
        closeVariablePicker();
    };

    const [optionPicker, setOptionPicker] = createSignal<{
        open: boolean;
        blockId?: string;
        paramKey?: string;
        x: number;
        y: number;
        options: { label: string; value: any; icon?: string }[];
        selectedValue?: any;
        onSelect?: (value: any) => void;
    }>({
        open: false,
        x: 0,
        y: 0,
        options: [],
    });

    const handleRequestOptionPicker = (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        options: { label: string; value: any; icon?: string }[],
        selectedValue: any,
        onSelect: (value: any) => void,
    ) => {
        setOptionPicker({
            open: true,
            blockId,
            paramKey,
            x,
            y,
            options,
            selectedValue,
            onSelect,
        });
    };

    const contextBlock = () => {
        const id = contextBlockId();
        return id ? findBlock(blocks, id) : null;
    };

    const [blocks, setBlocks] = createStore<CanvasBlock[]>([]);
    const [notes, setNotes] = createStore<CanvasNote[]>([]);
    const [consoleLogs, setConsoleLogs] = createStore<
        { id: string; time: string; message: string; level?: "error" }[]
    >([]);

    const worldSize = createMemo(() => {
        let maxX = 0;
        let maxY = 0;
        const visit = (list: CanvasBlock[]) => {
            for (const b of list) {
                if (b.pos) {
                    maxX = Math.max(maxX, b.pos.x);
                    maxY = Math.max(maxY, b.pos.y);
                }
                if (b.children) visit(b.children);
                if (b.elseChildren) visit(b.elseChildren);
            }
        };
        visit(blocks);
        for (const n of notes) {
            maxX = Math.max(maxX, n.pos.x);
            maxY = Math.max(maxY, n.pos.y);
        }
        return {
            w: Math.max(maxX + 600, 2400),
            h: Math.max(maxY + 600, 1600),
        };
    });

    const setBlockRunning = (id: string, isRunning: boolean) => {
        setRunningBlockIds((prev) => {
            const next = new Set(prev);
            if (isRunning) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const handleTestRunFlow = async (triggerBlock: CanvasBlock, payload: any) => {
        try {
            const log = await actionsApi.call<any>(
                ACTIONS_PANEL_ID,
                "test-run-flow",
                { triggerBlockId: triggerBlock.id, payload: payload || {} },
            );
            // only failures reach the console; a clean run shows nothing and
            // the flow's own Log to Console actions speak for themselves
            if (log?.status === "error" && log.message) {
                appendConsoleLog({
                    time: new Date().toLocaleTimeString(),
                    message: log.message,
                    level: "error",
                });
            }
        } catch (err: any) {
            appendConsoleLog({
                time: new Date().toLocaleTimeString(),
                message: err?.message || err,
                level: "error",
            });
        }
    };

    const handlePlayAllFlows = () => {
        // only on-play triggers run here — silently running OTHER triggers
        // as a stand-in would be a surprising side effect, not a fallback
        const onPlay = blocks.filter(
            (b) =>
                b.isTrigger &&
                (b.action?.id === "on-play" || (b.action as any)?.trigger === "on-play"),
        );
        if (onPlay.length === 0) {
            appendConsoleLog({
                time: new Date().toLocaleTimeString(),
                message: "No on-play flows on the canvas. Nothing ran (play button only runs on-play triggers).",
            });
            return;
        }
        for (const b of onPlay) {
            handleTestRunFlow(b, {});
        }
    };

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    // a pending debounced save must never fire after unmount
    onCleanup(() => clearTimeout(saveTimer));
    // canvas payloads are plain shapes; blocks may be a Solid store proxy,
    // which structuredClone rejects — fall back to the parse/stringify
    // roundtrip that handles the proxy read-through
    const deepClone = <T,>(value: T): T => {
        if (typeof structuredClone === "function") {
            try {
                return structuredClone(value);
            } catch (err) {
                console.debug("[actions] structuredClone rejected (store proxy?), falling back to JSON clone");
            }
        }
        try {
            return JSON.parse(JSON.stringify(value)) as T;
        } catch (err) {
            console.error("[Actions] deep clone of canvas data failed; saving shared object:", err);
            return value;
        }
    };
    const saveFlows = (currentBlocks?: CanvasBlock[], currentNotes?: CanvasNote[]) => {
        const dataToSave = currentBlocks || deepClone(blocks);
        const notesToSave = currentNotes || deepClone(notes);
        const functionsToSave = deepClone(functions());
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            configApi.set({ flows: dataToSave, notes: notesToSave, functions: functionsToSave }, ACTIONS_PANEL_ID, "canvas.json").catch((err) => {
                console.error("[Actions] Failed to save flows:", err);
            });
            actionsApi
                .call(ACTIONS_PANEL_ID, "sync-flows", {
                    flows: dataToSave,
                    functions: functionsToSave,
                })
                .catch((err) => {
                    console.warn("[actions] flow sync to daemon failed:", String(err));
                });
        }, 80);
    };

    const handleCreateFunction = (name: string, params: { name: string; type: string }[]) => {
        const def: FunctionDef = {
            id: createFunctionId(),
            name: name.trim(),
            params: params.map((p) => ({ name: p.name.trim(), type: p.type })),
        };
        setFunctions((prev) => [...prev, def]);
        saveFlows();
    };

    const handleDeleteFunction = (fid: string) => {
        setFunctions((prev) => prev.filter((f) => f.id !== fid));
        saveFlows();
    };

    const handleRenameFunction = (fid: string, name: string) => {
        const clean = name.trim().replace(/[{}:]/g, "");
        if (!clean) return;
        const def = functions().find((f) => f.id === fid);
        if (!def || def.name === clean) return;
        const renamed: FunctionDef = { ...def, name: clean };
        setFunctions((prev) => prev.map((f) => (f.id === fid ? renamed : f)));

        const callSchema = buildCallSchema(renamed);
        const trigSchema = buildTriggerSchema(renamed);
        const refresh = (list: CanvasBlock[]): CanvasBlock[] =>
            list.map((b) => {
                const callFid = functionIdFromCallAction(b.action?.id || "");
                const trigFid = functionIdFromTriggerAction(b.action?.id || "");
                let nb = b;
                if (callFid === fid) {
                    nb = { ...nb, action: { ...callSchema } };
                } else if (trigFid === fid) {
                    nb = { ...nb, action: { ...trigSchema } };
                }
                return {
                    ...nb,
                    children: nb.children ? refresh(nb.children) : nb.children,
                    elseChildren: nb.elseChildren ? refresh(nb.elseChildren) : nb.elseChildren,
                };
            });
        const refreshed = refresh(blocks);
        let relabeled = refreshed;
        const walkRelabel = (list: CanvasBlock[]) => {
            for (const b of list) {
                if (
                    functionIdFromCallAction(b.action?.id || "") === fid &&
                    b.action?.output
                ) {
                    const outLabel =
                        typeof b.action.output === "string"
                            ? b.action.output
                            : (b.action.output as any).label || "Result";
                    relabeled = relabelVariableRefs(relabeled, b.id, outLabel);
                }
                if (b.children) walkRelabel(b.children);
                if (b.elseChildren) walkRelabel(b.elseChildren);
            }
        };
        walkRelabel(refreshed);
        setBlocks(reconcile(relabeled, { key: "id" }));
        saveFlows(relabeled);
    };



    onMount(async () => {
        try {
            const saved = await configApi.get<any>(ACTIONS_PANEL_ID, "canvas.json");
            if (saved?.functions && Array.isArray(saved.functions)) {
                setFunctions(
                    saved.functions.filter(
                        (f: any) => f && typeof f.id === "string" && typeof f.name === "string",
                    ),
                );
            }
            if (saved?.flows && Array.isArray(saved.flows)) {
                // stored flows are executable content: drop malformed
                // blocks loudly instead of rendering them into the canvas
                const clean = saved.flows.filter(isCanvasBlock);
                if (clean.length !== saved.flows.length) {
                    console.warn(
                        `[Actions] dropped ${saved.flows.length - clean.length} malformed stored block(s)`,
                    );
                }
                setBlocks(clean);
                await refreshBlockSchemas(clean);
            }
            if (saved?.notes && Array.isArray(saved.notes)) {
                setNotes(saved.notes);
            }
        } catch (err) {
            console.error("[Actions] Failed to load persisted flows:", err);
        }
    });

    const refreshBlockSchemas = async (current?: CanvasBlock[]) => {
        try {
            const [acts, trigs] = await Promise.all([
                actionsApi.list(),
                actionsApi.listTriggers(),
            ]);
            const merged = mergeActionSchemas(current ?? blocks, acts, trigs);
            setBlocks(merged);
            saveFlows(merged);
        } catch (err) {
            console.error("[Actions] Failed to refresh block schemas:", err);
        }
    };

    onMount(() => {
        // panels register after this panel may have loaded, so schemas are
        // refreshed whenever the registry changes
        const unsubscribe = actionsApi.onRegistryChange(() => {
            void refreshBlockSchemas();
        });
        onCleanup(unsubscribe);
    });

    onMount(() => {
        // internal flow-state triggers belong to THIS panel: explicit
        // two-arg subscriptions (each filters its own trigger name) —
        // no wildcard; cross-panel flows live in the service's trigger
        // subscriptions instead
        const handler = (output: any, data: any) => {
            if (!data) return;
            if (data.trigger === "flow-step" && output?.blockId) {
                setBlockRunning(output.blockId, output.status === "start");
                return;
            }
            if (data.trigger === "flow-start" && output?.triggerBlockId) {
                setBlockRunning(output.triggerBlockId, true);
                return;
            }
            if (data.trigger === "flow-end" && output?.triggerBlockId) {
                setBlockRunning(output.triggerBlockId, false);
                return;
            }
            if (data.trigger === "flow-log" && output) {
                appendConsoleLog({
                    time: output.time || new Date().toLocaleTimeString(),
                    message: String(output.message ?? ""),
                    level: output.status === "error" ? "error" : undefined,
                });
                return;
            }
        };
        const unsubs = (["flow-step", "flow-start", "flow-end", "flow-log"] as const).map(
            (trigger) => actionsApi.onTrigger(trigger, handler),
        );

        onCleanup(() => {
            for (const unsub of unsubs) unsub();
        });
    });

    onMount(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && variablePicker().open) {
                closeVariablePicker();
            }
        };
        window.addEventListener("keydown", handleGlobalKeyDown);
        onCleanup(() => {
            window.removeEventListener("keydown", handleGlobalKeyDown);
        });
    });

    let dragStart = { x: 0, y: 0 };
    let scrollStart = { x: 0, y: 0 };
    let rightClickDownPos = { x: 0, y: 0 };
    let lastContextMenuPos = { x: 0, y: 0 };
    let containerRef: HTMLDivElement | undefined;

    const bringToFront = (id: string) => {
        maxZIndex += 1;
        setBlocks((b) => b.id === id, "zIndex", maxZIndex);
    };

    const checkDropTarget = (
        clientX: number,
        clientY: number,
    ): { parentId: string; insertIndex: number } | null => {
        try {
            const zones = document.querySelectorAll<HTMLElement>("[data-drop-parent]");
            for (const zone of zones) {
                const rect = zone.getBoundingClientRect();
                if (
                    clientX >= rect.left - 16 &&
                    clientX <= rect.right + 16 &&
                    clientY >= rect.top - 16 &&
                    clientY <= rect.bottom + 16
                ) {
                    const parentId = zone.getAttribute("data-drop-parent");
                    const rawIdx = zone.getAttribute("data-drop-index");
                    if (parentId !== null && rawIdx !== null) {
                        return { parentId, insertIndex: parseInt(rawIdx, 10) };
                    }
                }
            }
        } catch (err) {
            console.debug("[actions] drop-zone lookup failed:", String(err));
        }
        return null;
    };

    const checkTrashTarget = (clientX: number, clientY: number): boolean => {
        const trashEl = document.getElementById("canvas-trash-zone");
        if (!trashEl) return false;
        const rect = trashEl.getBoundingClientRect();
        return (
            clientX >= rect.left - 16 &&
            clientX <= rect.right + 16 &&
            clientY >= rect.top - 16 &&
            clientY <= rect.bottom + 16
        );
    };

    const isDropOnCanvas = (clientX: number): boolean => {
        const sidebarEl = document.querySelector(".library-sidebar");
        const sidebarRight = sidebarEl ? sidebarEl.getBoundingClientRect().right : 0;
        return clientX > sidebarRight;
    };

    const handlePointerDown = (e: PointerEvent) => {
        const isBackgroundTarget =
            e.target === containerRef ||
            (e.target as HTMLElement).classList.contains("canvas-viewport") ||
            (e.target as HTMLElement).classList.contains("canvas-world");

        if (e.button === 1 || e.button === 2 || (e.button === 0 && isBackgroundTarget)) {
            if (e.button === 2) {
                e.preventDefault();
                rightClickDownPos = { x: e.clientX, y: e.clientY };
            }
            setIsPanning(true);
            dragStart = { x: e.clientX, y: e.clientY };
            scrollStart = { ...viewportScroll() };

            if (containerRef) {
                try {
                    containerRef.setPointerCapture(e.pointerId);
                } catch (err) {
                    console.debug("[actions] pointer capture failed:", String(err));
                }
            }
        }
    };

    const handlePointerMove = (e: PointerEvent) => {
        const pending = pendingChildDrag();
        if (pending && !ghostDrag()) {
            const distance = Math.hypot(
                e.clientX - pending.startClient.x,
                e.clientY - pending.startClient.y,
            );
            if (distance >= DRAG_START_THRESHOLD_PX) {
                setPendingChildDrag(null);
                beginChildDrag(pending, e.clientX, e.clientY);
            }
            // a press that has not travelled yet is still a click: do not pan
            return;
        }

        if (ghostDrag()) {
            setGhostDrag({
                ...ghostDrag()!,
                pos: { x: e.clientX, y: e.clientY },
            });

            const overTrash = checkTrashTarget(e.clientX, e.clientY);
            setIsOverTrash(overTrash);

            if (!overTrash && !ghostDrag()!.isTrigger) {
                const target = checkDropTarget(e.clientX, e.clientY);
                setHoverDropTarget(target);
            } else {
                setHoverDropTarget(null);
            }
            return;
        }

        if (draggingCanvasBlockId()) {
            setIsOverTrash(checkTrashTarget(e.clientX, e.clientY));
        }

        if (!isPanning()) return;

        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        if (containerRef) {
            containerRef.scrollLeft = Math.round(scrollStart.x - dx);
            containerRef.scrollTop = Math.round(scrollStart.y - dy);
        }
    };

    const handlePointerUp = (e: PointerEvent) => {
        // a press that never crossed the drag threshold was a click; the
        // block was never removed, so there is nothing to restore
        if (pendingChildDrag()) {
            setPendingChildDrag(null);
            return;
        }
        const dropTarget = hoverDropTarget();
        setHoverDropTarget(null);

        const overTrash = isOverTrash();
        setIsOverTrash(false);

        if (ghostDrag()) {
            const drag = ghostDrag()!;
            setGhostDrag(null);

            if (overTrash) {
                saveFlows();
                return;
            }

            maxZIndex += 1;
            const actionId =
                (drag.item as any)?.action ||
                (drag.item as any)?.trigger ||
                (drag.item as any)?.schema?.id ||
                (drag as any).action?.id;

            const isContainer =
                actionId === "repeat" ||
                actionId === "if" ||
                actionId === "if-else";

            const droppedBlock: CanvasBlock = {
                id: drag.id || `block_${Date.now()}`,
                panelId: drag.panelId,
                pos: { x: 0, y: 0 },
                isTrigger: drag.isTrigger,
                zIndex: maxZIndex,
                action: drag.item
                    ? (drag.item.schema || {
                          id: actionId || "action",
                          name: actionId || "action",
                          description: "",
                      })
                    : (drag as any).action,
                iconSrc: drag.iconSrc,
                values: drag.values || {},
                children: drag.children || (drag.isTrigger || isContainer ? [] : undefined),
                elseChildren:
                    (drag as any).elseChildren || (actionId === "if-else" ? [] : undefined),
            };

            if (dropTarget && !drag.isTrigger) {
                // reject self-calls
                const droppedFid = functionIdFromCallAction(actionId || "");
                if (droppedFid) {
                    const owner = findOwnerTrigger(
                        blocks,
                        dropTarget.parentId.replace(/:else$/, ""),
                    );
                    const ownerFid = owner
                        ? functionIdFromTriggerAction((owner.action as any)?.id || "")
                        : null;
                    if (ownerFid && ownerFid === droppedFid) {
                        console.warn(
                            `[Actions] A function cannot call itself; "${droppedBlock.action.name}" was not added.`,
                        );
                        return;
                    }
                }
                const updated = insertBlock(
                    blocks,
                    dropTarget.parentId,
                    dropTarget.insertIndex,
                    droppedBlock,
                );
                setBlocks(updated);
                saveFlows(updated);
                return;
            }

            if (isDropOnCanvas(e.clientX)) {
                const rect = containerRef?.getBoundingClientRect();
                const sc = viewportScroll();
                const worldX = Math.round(
                    e.clientX - (rect ? rect.left : 0) + sc.x - drag.grabOffset.x,
                );
                const worldY = Math.round(
                    e.clientY - (rect ? rect.top : 0) + sc.y - drag.grabOffset.y,
                );
                droppedBlock.pos = { x: worldX, y: worldY };

                const updated = insertBlock(
                    blocks,
                    null,
                    blocks.length,
                    droppedBlock,
                );
                setBlocks(updated);
                saveFlows(updated);
                return;
            }

            if (drag.detachedFrom) {
                const restored = insertBlock(
                    blocks,
                    drag.detachedFrom.originalParentId,
                    drag.detachedFrom.originalIndex,
                    drag.detachedFrom.block,
                );
                setBlocks(restored);
                saveFlows(restored);
            }
            return;
        }

        if (isPanning()) {
            setIsPanning(false);
            if (containerRef && containerRef.hasPointerCapture(e.pointerId)) {
                containerRef.releasePointerCapture(e.pointerId);
            }
        }
    };

    const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const isBackgroundTarget =
            e.target === containerRef ||
            (e.target as HTMLElement).classList.contains("canvas-viewport") ||
            (e.target as HTMLElement).classList.contains("canvas-world");

        if (isBackgroundTarget && isDropOnCanvas(e.clientX)) {
            const dist = Math.hypot(
                e.clientX - rightClickDownPos.x,
                e.clientY - rightClickDownPos.y,
            );
            if (dist < 6) {
                setCanvasContextMenuPos({ x: e.clientX, y: e.clientY });
                canvasContextMenu.openAtCursor(e);
            }
        }
    };

    const handleAddNoteAtCursor = () => {
        const pos = canvasContextMenuPos();
        const rect = containerRef?.getBoundingClientRect();
        const sc = viewportScroll();
        const worldX = Math.round(pos.x - (rect ? rect.left : 0) + sc.x);
        const worldY = Math.round(pos.y - (rect ? rect.top : 0) + sc.y);

        maxZIndex += 1;
        const newNote: CanvasNote = {
            id: `note_${Date.now()}`,
            pos: { x: worldX, y: worldY },
            zIndex: maxZIndex,
            text: "",
        };

        const updated = [...notes, newNote];
        setNotes(updated);
        saveFlows(undefined, updated);
    };

    const handleDeleteNote = (id: string) => {
        const updated = notes.filter((n) => n.id !== id);
        setNotes(updated);
        saveFlows(undefined, updated);
    };

    const handleNoteTextChange = (id: string, text: string) => {
        setNotes((n) => n.id === id, "text", text);
        saveFlows();
    };

    const handleMoveNote = (
        id: string,
        newPos: { x: number; y: number },
        clientX?: number,
        clientY?: number,
    ) => {
        setDraggingCanvasBlockId(id);
        setNotes((n) => n.id === id, "pos", newPos);

        if (clientX !== undefined && clientY !== undefined) {
            setIsOverTrash(checkTrashTarget(clientX, clientY));
        } else {
            setIsOverTrash(false);
        }
    };

    const handleNoteDragEnd = (id: string) => {
        const overTrash = isOverTrash();
        setIsOverTrash(false);
        setDraggingCanvasBlockId(null);

        if (overTrash) {
            handleDeleteNote(id);
            return;
        }

        saveFlows();
    };

    const bringNoteToFront = (id: string) => {
        maxZIndex += 1;
        setNotes((n) => n.id === id, "zIndex", maxZIndex);
    };

    const handleMoveTopBlock = (
        id: string,
        newPos: { x: number; y: number },
        clientX?: number,
        clientY?: number,
    ) => {
        setDraggingCanvasBlockId(id);
        setBlocks((b) => b.id === id, "pos", newPos);

        if (clientX !== undefined && clientY !== undefined) {
            const overTrash = checkTrashTarget(clientX, clientY);
            setIsOverTrash(overTrash);

            const currentBlock = blocks.find((b) => b.id === id);
            if (!overTrash && currentBlock && !currentBlock.isTrigger) {
                const target = checkDropTarget(clientX, clientY);
                setHoverDropTarget(target?.parentId !== id ? target : null);
            } else {
                setHoverDropTarget(null);
            }
        } else {
            setHoverDropTarget(null);
            setIsOverTrash(false);
        }
    };

    const handleCanvasBlockDragEnd = (id: string) => {
        const dropTarget = hoverDropTarget();
        const overTrash = isOverTrash();
        setHoverDropTarget(null);
        setIsOverTrash(false);
        setDraggingCanvasBlockId(null);

        if (overTrash) {
            const { blocks: updated } = removeBlock(blocks, id);
            setBlocks(updated);
            saveFlows(updated);
            return;
        }

        if (dropTarget && dropTarget.parentId !== id) {
            const blockToInsert = blocks.find((b) => b.id === id);
            if (blockToInsert && !blockToInsert.isTrigger) {
                const { blocks: updated, removed } = removeBlock(blocks, id);
                if (removed) {
                    const finalTree = insertBlock(
                        updated,
                        dropTarget.parentId,
                        dropTarget.insertIndex,
                        removed,
                    );
                    setBlocks(finalTree);
                    saveFlows(finalTree);
                    return;
                }
            }
        }

        saveFlows();
    };

    const handleStartDragFromLibrary = (
        item: ActionInfo | TriggerInfo,
        isTrigger: boolean,
        screenPos: { x: number; y: number },
        grabOffset: { x: number; y: number },
        iconSrc?: string,
    ) => {
        setGhostDrag({
            item,
            panelId: item.panelId,
            isTrigger,
            iconSrc,
            pos: screenPos,
            grabOffset,
        });
    };

    const beginChildDrag = (
        pending: PendingChildDrag,
        clientX: number,
        clientY: number,
    ) => {
        const { blocks: updated, removed } = removeBlock(
            blocks,
            pending.child.id,
        );
        if (!removed) return;
        setBlocks(updated);
        setGhostDrag({
            id: removed.id,
            panelId: removed.panelId,
            item: {
                panelId: removed.panelId,
                action: (removed.action as any).id || "action",
                schema: removed.action,
            },
            isTrigger: removed.isTrigger,
            iconSrc: removed.iconSrc,
            pos: { x: clientX, y: clientY },
            grabOffset: pending.grabOffset,
            values: removed.values,
            children: removed.children,
            detachedFrom: {
                originalParentId: pending.originalParentId,
                originalIndex: pending.originalIndex,
                block: removed,
            },
        });
    };

    const handleStartDragChild = (
        child: CanvasBlock,
        grabOffset: { x: number; y: number },
        e: PointerEvent,
    ) => {
        let originalParentId: string | null = null;
        let originalIndex = 0;
        for (const b of blocks) {
            if (b.children) {
                const idx = b.children.findIndex((c) => c.id === child.id);
                if (idx >= 0) {
                    originalParentId = b.id;
                    originalIndex = idx;
                    break;
                }
            }
        }

        setPendingChildDrag({
            child,
            grabOffset,
            startClient: { x: e.clientX, y: e.clientY },
            originalParentId,
            originalIndex,
        });
    };

    const handleDeleteBlock = (id: string) => {
        const { blocks: updated } = removeBlock(blocks, id);
        setBlocks(updated);
        saveFlows(updated);
    };

    const handleValueChange = (blockId: string, key: string, value: any) => {
        const updated = updateBlockValue(blocks, blockId, key, value);
        setBlocks(reconcile(updated, { key: "id" }));
        saveFlows(updated);
    };

    const handleBlockContextMenu = (
        blockId: string,
        _clientX: number,
        _clientY: number,
        e: MouseEvent,
    ) => {
        setContextBlockId(blockId);
        blockContextMenu.openAtCursor(e);
    };

    const [renameTargetId, setRenameTargetId] = createSignal<string | null>(null);
    const [renameDraft, setRenameDraft] = createSignal("");

    const openRenameModal = (blockId: string) => {
        const block = findBlock(blocks, blockId);
        if (!block) return;
        setRenameTargetId(blockId);
        setRenameDraft(blockVariableName(block) || "");
    };

    const handleConfirmRename = () => {
        const id = renameTargetId();
        if (id) {
            const renamed = renameBlockVariable(blocks, id, renameDraft());
            const renamedBlock = findBlock(renamed, id);
            const displayLabel = (renamedBlock && blockVariableName(renamedBlock)) || "Result";
            const updated = relabelVariableRefs(renamed, id, displayLabel);
            setBlocks(reconcile(updated, { key: "id" }));
            saveFlows(updated);
        }
        setRenameTargetId(null);
    };

    return (
        <div
            ref={containerRef}
            class={`paperui-root unselectable canvas-viewport ${isPanning() ? "panning" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={handleContextMenu}
            onScroll={(e) => {
                setScroll({
                    x: e.currentTarget.scrollLeft,
                    y: e.currentTarget.scrollTop,
                });
            }}
            style={{
                "background-position": `${-scroll().x}px ${-scroll().y}px`,
            }}
        >
            <ActionLibrary
                onStartDrag={handleStartDragFromLibrary}
                functions={functions()}
                onCreateFunction={handleCreateFunction}
                onRenameFunction={handleRenameFunction}
                onDeleteFunction={handleDeleteFunction}
            />

            <div class="canvas-top-right-controls">
                <PaperEffect variant="success">
                    <PaperButton
                        variant="success"
                        icon
                        onClick={handlePlayAllFlows}
                        title="Run On-Play Flows">
                        <PaperIcon>play_arrow</PaperIcon>
                    </PaperButton>
                </PaperEffect>

                <Show when={consoleLogs.length > 0}>
                    <div class="canvas-console-panel">
                        <div class="canvas-console-header">
                            <div class="canvas-console-title">
                                <PaperIcon class="canvas-console-icon">terminal</PaperIcon>
                                <PaperText size={1} weight={700}>Console</PaperText>
                            </div>
                            <PaperButton size="tiny"
                                icon
                                onClick={() => setConsoleLogs([])}
                                title="Clear Console">
                                <PaperIcon>delete_sweep</PaperIcon>
                            </PaperButton>
                        </div>
                        <div class="canvas-console-body">
                            <For each={consoleLogs}>
                                {(log) => (
                                    <div
                                        class="canvas-console-line"
                                        classList={{
                                            "is-error": log.level === "error",
                                        }}
                                    >
                                        <span class="canvas-console-time">{log.time}</span>
                                        <span class="canvas-console-text">{log.message}</span>
                                    </div>
                                )}
                            </For>
                        </div>
                    </div>
                </Show>
            </div>

            <div
                class="canvas-world"
                style={{
                    width: `${worldSize().w}px`,
                    height: `${worldSize().h}px`,
                }}
            >
                <For each={blocks}>
                    {(block) => (
                        <ActionBlock
                            id={block.id}
                            action={block.action}
                            isTrigger={block.isTrigger}
                            pos={block.pos}
                            zIndex={block.zIndex}
                            values={block.values}
                            children={block.children}
                            elseChildren={block.elseChildren}
                            activeDropTarget={hoverDropTarget()}
                            iconSrc={block.iconSrc}
                            runningBlockIds={runningBlockIds}
                            variableName={blockVariableName(block)}
                            onInteract={() => bringToFront(block.id)}
                            onContextMenu={(bId, cx, cy, e) => handleBlockContextMenu(bId, cx, cy, e)}
                            onMove={(newPos, clientX, clientY) =>
                                handleMoveTopBlock(block.id, newPos, clientX, clientY)
                            }
                            onDragEnd={() => handleCanvasBlockDragEnd(block.id)}
                            onStartDragChild={handleStartDragChild}
                            onValueChange={handleValueChange}
                            onRequestVariablePicker={handleRequestVariablePicker}
                            onRequestOptionPicker={handleRequestOptionPicker}
                            highlightedSourceBlockId={hoveredSourceBlockId}
                        />
                    )}
                </For>

                <For each={notes}>
                    {(note) => (
                        <NoteBlock
                            id={note.id}
                            pos={note.pos}
                            zIndex={note.zIndex}
                            text={note.text}
                            onInteract={() => bringNoteToFront(note.id)}
                            onMove={(newPos, cx, cy) =>
                                handleMoveNote(note.id, newPos, cx, cy)
                            }
                            onDragEnd={() => handleNoteDragEnd(note.id)}
                            onChangeText={(txt) => handleNoteTextChange(note.id, txt)}
                            onDelete={() => handleDeleteNote(note.id)}
                        />
                    )}
                </For>
            </div>

            <Show when={ghostDrag()}>
                <div
                    class="ghostDragContainer"
                    style={{
                        position: "fixed",
                        left: `${ghostDrag()!.pos.x - ghostDrag()!.grabOffset.x}px`,
                        top: `${ghostDrag()!.pos.y - ghostDrag()!.grabOffset.y}px`,
                        width: "max-content",
                        "pointer-events": "none",
                        "z-index": 9999,
                        opacity: 0.95,
                        filter: "drop-shadow(0 16px 32px rgba(0,0,0,0.55))",
                    }}
                >
                    <ActionBlock
                        action={
                            ghostDrag()!.item.schema || {
                                id:
                                    (ghostDrag()!.item as any).action ||
                                    (ghostDrag()!.item as any).trigger,
                                name:
                                    (ghostDrag()!.item as any).action ||
                                    (ghostDrag()!.item as any).trigger,
                                description: "",
                            }
                        }
                        isTrigger={ghostDrag()!.isTrigger}
                        iconSrc={ghostDrag()!.iconSrc}
                        values={ghostDrag()!.values}
                        children={ghostDrag()!.children}
                        elseChildren={(ghostDrag() as any)?.elseChildren}
                    />
                </div>
            </Show>

            <div
                id="canvas-trash-zone"
                class={`trash-zone ${ghostDrag() || draggingCanvasBlockId() ? "is-dragging" : ""} ${isOverTrash() ? "active-hover" : ""}`}
                title="Drop block here to delete"
            >
                <PaperIcon>{isOverTrash() ? "delete_forever" : "delete"}</PaperIcon>
            </div>

            <VariableMenu
                open={variablePicker().open}
                x={variablePicker().x}
                y={variablePicker().y}
                items={variablePicker().availableVariables}
                onSelect={selectVariable}
                onClose={closeVariablePicker}
                onHoverItem={(sourceId) => setHoveredSourceBlockId(sourceId)}
            />

            <ActionDropdownMenu
                open={optionPicker().open}
                x={optionPicker().x}
                y={optionPicker().y}
                items={optionPicker().options}
                selectedValue={optionPicker().selectedValue}
                onSelect={(val) => {
                    optionPicker().onSelect?.(val);
                    setOptionPicker((prev) => ({ ...prev, open: false }));
                }}
                onClose={() => setOptionPicker((prev) => ({ ...prev, open: false }))}
            />

            <PaperContextMenu
                open={blockContextMenu.isOpen()}
                target={blockContextMenu.target()}
                placement={blockContextMenu.placement()}
                onClose={blockContextMenu.close}
            >
                <Show when={contextBlock()?.isTrigger}>
                    <PaperContextMenuItem
                        icon="play_arrow"
                        onClick={() => {
                            const b = contextBlock();
                            blockContextMenu.close();
                            if (b) {
                                const testPayload = b.values?.output || b.values?.player || "TestPlayer";
                                handleTestRunFlow(b, testPayload);
                            }
                        }}
                    >
                        Run
                    </PaperContextMenuItem>
                </Show>
                <Show when={(() => {
                    const b = contextBlock();
                    return b && blockVariableName(b);
                })()}>
                    <PaperContextMenuItem
                        icon="edit"
                        onClick={() => {
                            const id = contextBlockId();
                            blockContextMenu.close();
                            if (id) openRenameModal(id);
                        }}
                    >
                        Edit Name
                    </PaperContextMenuItem>
                </Show>
                <PaperContextMenuItem
                    icon="delete"
                    danger
                    onClick={() => {
                        const id = contextBlockId();
                        blockContextMenu.close();
                        if (id) handleDeleteBlock(id);
                    }}
                >
                    Delete Block
                </PaperContextMenuItem>
            </PaperContextMenu>

            <PaperModal
                open={renameTargetId() !== null}
                onClose={() => setRenameTargetId(null)}
                title="Edit Name"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton
                            variant="text"
                            onClick={() => setRenameTargetId(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="brand"
                            onClick={handleConfirmRename}>
                            Save
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperInput
                    fullWidth
                    placeholder="Variable name"
                    value={renameDraft()}
                    onInput={(e) => setRenameDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleConfirmRename();
                    }}
                />
            </PaperModal>

            <PaperContextMenu
                open={canvasContextMenu.isOpen()}
                target={canvasContextMenu.target()}
                placement={canvasContextMenu.placement()}
                onClose={canvasContextMenu.close}
            >
                <PaperContextMenuItem
                    icon="note_add"
                    onClick={() => {
                        canvasContextMenu.close();
                        handleAddNoteAtCursor();
                    }}
                >
                    Add Note
                </PaperContextMenuItem>
            </PaperContextMenu>
        </div>
    );
}
