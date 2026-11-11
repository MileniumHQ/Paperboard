// What the page and the service agree on. It runs in the browser and in
// Node, so it imports nothing from either.
import type { BlockSchema } from "@mileniumhq/paperapi";
import type { SavedWorkspace } from "./lib/interpreter";
import type { ProjectSummary } from "./lib/projects";

/** Passed explicitly to every API call: ambient scope resolves to the last panel imported. */
export const PANEL_ID = "dev.paperboard.blocks";

/** One line in the run log. */
export interface LogEntry {
    id: number;
    at: number;
    level: "info" | "error";
    message: string;
    /** the project whose flow said it */
    project: string;
    /** the block it is about, to point at on the canvas */
    blockId?: string;
}

/** What the service announces; every window mirrors it. */
export interface PanelState {
    log: LogEntry[];
    /** flows running right now, by project */
    running: Record<string, number>;
    /** every project, the most recently edited first */
    projects: ProjectSummary[];
    /** why the projects couldn't be read; nothing runs until they can be */
    projectsError: string | null;
    /** why this panel's own blocks (the Projects ones) couldn't be added */
    blocksError: string | null;
    /** the projects have been read (or failed to be): until then the list is not the real one */
    loaded: boolean;
}

export const DEFAULT_STATE: PanelState = { log: [], running: {}, projects: [], projectsError: null, blocksError: null, loaded: false };

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

/** The service's own actions, which only this panel's page calls. */
export const SERVICE_ACTIONS = {
    load: "load-flows",
    save: "save-flows",
    run: "run-flows",
    stop: "stop-flows",
    clearLog: "clear-log",
    createProject: "create-project",
    updateProject: "update-project",
    duplicateProject: "duplicate-project",
    deleteProject: "delete-project",
} as const;
