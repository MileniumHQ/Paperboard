// What the page and the service agree on. It runs in the browser and in
// Node, so it imports nothing from either.
import { defineContract, shape, type BlockSchema, type Infer } from "@mileniumhq/paperapi";
import type { SavedWorkspace } from "./lib/interpreter";
import { readFlows } from "./lib/flows";

/** Passed explicitly to every API call: ambient scope resolves to the last panel imported. */
export const PANEL_ID = "dev.paperboard.blocks";

/** The most log lines kept; older ones drop off. */
export const MAX_LOG = 200;

/**
 * What is saved: Blockly's workspace, and the schema of every registry
 * block on it as it was last seen, so a flow still loads (and says why it
 * can't run) while the panel that owns a block is away.
 */
export interface SavedFlows {
    workspace: SavedWorkspace;
    schemas: Record<string, { panelId: string; entry: string; schema: BlockSchema }>;
}

export const EMPTY_FLOWS: SavedFlows = { workspace: {}, schemas: {} };

const rect = shape.object({ x: shape.number(), y: shape.number(), w: shape.number(), h: shape.number() });
/** A project's canvas in miniature: where each stack of blocks sits, as the page last drew them. */
const canvasPreview = shape.object({ bounds: rect, rects: shape.list(rect) });
export type PreviewRect = Infer<typeof rect>;
export type CanvasPreview = Infer<typeof canvasPreview>;

/** A project as the windows see it. */
const projectSummary = shape.object({
    /** stable, never shown */
    id: shape.text(),
    name: shape.text(),
    /** whether the project's flows start on their events */
    enabled: shape.boolean(),
    /** epoch ms */
    createdAt: shape.number(),
    /** epoch ms of the last saved edit */
    editedAt: shape.number(),
    preview: shape.nullable(canvasPreview),
    /** a new project with no blocks yet: kept once it has one, gone if left empty */
    draft: shape.boolean(),
    /** why its canvas couldn't be read; its flows don't run until it can be */
    loadError: shape.nullable(shape.text()),
    /** the flows it holds: its stacks that start from an event or from Run */
    flowCount: shape.number(),
});
export type ProjectSummary = Infer<typeof projectSummary>;
/** What the project index keeps of a project. */
export type ProjectMeta = Omit<ProjectSummary, "draft" | "loadError" | "flowCount">;

/** One line in the run log. */
const logEntry = shape.object({
    id: shape.number(),
    at: shape.number(),
    level: shape.oneOf("info", "error"),
    message: shape.text(),
    /** the project whose flow said it */
    project: shape.text(),
    /** the block it is about, to point at on the canvas */
    blockId: shape.optional(shape.text()),
});
export type LogEntry = Infer<typeof logEntry>;

/** What the service announces; every window mirrors it. */
const panelState = shape.object({
    log: shape.list(logEntry),
    /** flows running right now, by project */
    running: shape.record(shape.number()),
    /** every project, the most recently edited first */
    projects: shape.list(projectSummary),
    /** why the projects couldn't be read; nothing runs until they can be */
    projectsError: shape.nullable(shape.text()),
    /** why this panel's own blocks (the Projects ones) couldn't be added */
    blocksError: shape.nullable(shape.text()),
    /** the projects have been read (or failed to be): until then the list is not the real one */
    loaded: shape.boolean(),
});
export type PanelState = Infer<typeof panelState>;

const savedFlows = shape.read(readFlows);
const inProject = shape.object({ project: shape.text() });

/** What the page and the service say to each other; only this panel's page may. */
export const blocksContract = defineContract(PANEL_ID, {
    state: { shape: panelState, initial: { log: [], running: {}, projects: [], projectsError: null, blocksError: null, loaded: false } },
    calls: {
        loadFlows: { input: inProject, output: savedFlows },
        saveFlows: {
            input: shape.object({ project: shape.text(), flows: savedFlows, preview: shape.nullable(canvasPreview) }),
            output: projectSummary,
        },
        /** starts the project's "When Run is clicked" flows; how many started */
        runFlows: { input: inProject, output: shape.number() },
        /** stops the project's runs; how many were stopped */
        stopFlows: { input: inProject, output: shape.number() },
        clearLog: { input: inProject, output: shape.nothing() },
        createProject: { input: shape.object({ name: shape.optional(shape.text()) }), output: projectSummary },
        updateProject: {
            input: shape.object({ project: shape.text(), name: shape.optional(shape.text()), enabled: shape.optional(shape.boolean()) }),
            output: projectSummary,
        },
        duplicateProject: { input: inProject, output: projectSummary },
        /** `onlyDraft`: a project kept by now stays, as leaving an empty new one asks */
        deleteProject: { input: shape.object({ project: shape.text(), onlyDraft: shape.optional(shape.boolean()) }), output: shape.object({ deleted: shape.boolean() }) },
    },
});
