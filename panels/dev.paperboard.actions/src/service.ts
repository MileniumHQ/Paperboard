import {
    definePanelService,
    defineAction,
    actionsApi,
    config,
    normalizeMatchRules,
    type ActionDefinition,
    type ActionProjectHandle,
    type ActionSchema,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import {
    type ExecutionLog,
    executeFlow,
    runFunctionCall,
    initVariablesStore,
} from "./lib/runtime";
import {
    type FunctionDef,
    buildCallSchema,
} from "./lib/functions";
import type { CanvasBlock } from "./lib/tree";
import { validateFlowDefinitions } from "./lib/flowValidation";
import { CANVAS_CHANGED_EVENT, createCanvasDocument, type CanvasDocument, type CanvasSnapshot } from "./lib/canvasDoc";
// canonical panel id (shared with the UI bundle); the explicit identity
// every config/registry call below carries
import { ACTIONS_PANEL_ID } from "./panelId";
import { isBlankMatchInput, matchHolds, payloadFieldValue } from "./lib/runtime";
import { findManualFlow, flowLabels, isManualFlow, MAX_FLOW_CHOICES, recordRun, type FlowChoice, type FlowRun } from "./lib/widgetFlows";
import {
    LEGACY_CANVAS_FILE,
    MAX_PROJECTS,
    MIGRATED_PROJECT_NAME,
    PROJECTS_FILE,
    cleanProjectName,
    createProjectId,
    legacyCanvasHasContent,
    nextProjectName,
    projectCanvasPath,
    projectIndexDocument,
    readProjectIndex,
    type ProjectMeta,
} from "./lib/projects";
import { canvasPreview, canvasRects, flowRect, placeFlow, type CanvasPreview } from "./lib/flowLayout";
import { buildFlow, builtinBlocks, viewFlow } from "./lib/flowSpec";
import { BUILTIN_SCHEMA_ENTRIES } from "./lib/builtins";
import { addFlowFile } from "./lib/flowFile";

/** One project as the home screen shows it. */
export interface ProjectSummary {
    id: string;
    name: string;
    enabled: boolean;
    createdAt: number;
    /** epoch ms of the last saved edit */
    editedAt: number;
    flowCount: number;
    /** made but not kept yet: it is saved once it has a flow */
    draft: boolean;
    /** set when the project's canvas could not be read */
    loadError?: string;
    preview: CanvasPreview | null;
}

export interface ActionsServiceState {
    /** bumps whenever any project's definitions change (Home's widgets) */
    rev: number;
    projects: ProjectSummary[];
    /** set when the project list itself could not be read */
    projectsError: string | null;
    /** the latest runs of any flow, newest first (Home's widgets) */
    runs: FlowRun[];
    /** "project/flow" keys of the flows running now */
    running: string[];
}

type Ctx = ServiceContext<ActionsServiceState>;

/** A project while the service runs: its canvas, and what is live of it. */
interface Project {
    meta: ProjectMeta;
    doc: ReturnType<typeof createCanvasDocument>;
    flows: CanvasBlock[];
    notes: unknown[];
    functions: FunctionDef[];
    revision: number;
    /** unreadable is not empty: a project that failed to load runs nothing */
    loadError: string | null;
    /** function id -> registered signature */
    registeredFunctions: Map<string, string>;
    handle: ActionProjectHandle;
    /**
     * Made but not kept: neither its canvas nor its place in the project
     * list is written until a save gives it a flow, so a project left empty
     * is gone when the service stops.
     */
    draft: boolean;
}

const projects = new Map<string, Project>();
let rev = 0;
let serviceCtx: Ctx | null = null;
// unreadable is not empty: until the project list is read, Home's widgets
// are told so instead of being shown no workflows
let projectsError: string | null = "Actions is still loading its projects";
let runHistory: FlowRun[] = [];
// "project/flow" -> runs in flight; bounded by the run gate's cap
const runningByFlow = new Map<string, number>();
let runSeq = 0;

// internal trigger ids, never matched against user flows
const INTERNAL_TRIGGER_IDS = ["flow-step", "flow-log", "flow-start", "flow-end"];

// One subscription per source event, torn down when the flow set changes.
let triggerUnsubs: Array<() => void> = [];

/** "project/flow": a flow's identity across projects (widgets, run state). */
export const flowKey = (projectId: string, flowId: string) => `${projectId}/${flowId}`;

function serviceHooks(project: Project) {
    const bodiesOf = (fid: string) =>
        project.flows.filter((b) => b.isTrigger && (b.action as any)?.id === `function-trigger-${fid}`);
    return {
        getFunctionBody: (fid: string): CanvasBlock[] | null => {
            if (!project.functions.some((f) => f.id === fid)) return null;
            const trig = bodiesOf(fid)[0];
            if (!trig) return null;
            return trig.children && trig.children.length > 0 ? trig.children : [];
        },
        getFunctionName: (fid: string): string => {
            const def = project.functions.find((f) => f.id === fid);
            if (def) return def.name;
            const tname = (bodiesOf(fid)[0]?.action as any)?.name;
            if (typeof tname === "string" && tname) return tname.replace(/^Function /, "");
            return fid;
        },
        countFunctionBodies: (fid: string): number => bodiesOf(fid).length,
    };
}

const functionSignature = (def: FunctionDef): string => JSON.stringify({ name: def.name, params: def.params });

// a project's functions are that project's actions: "project/call-function-<id>"
async function syncFunctionRegistry(project: Project) {
    const wanted = new Set(project.functions.map((d) => d.id));
    for (const id of [...project.registeredFunctions.keys()]) {
        if (wanted.has(id)) continue;
        try {
            await project.handle.unregister(`call-function-${id}`);
        } catch (err) {
            console.error("[actions] unregister stale function failed:", id, String(err));
        }
        project.registeredFunctions.delete(id);
    }
    for (const def of project.functions) {
        const sig = functionSignature(def);
        if (project.registeredFunctions.get(def.id) === sig) continue;
        try {
            const schema = buildCallSchema(def);
            await project.handle.register({
                id: schema.id,
                name: schema.name,
                description: schema.description || "",
                template: schema.template,
                inputs: schema.inputs,
                output: schema.output,
                icon: schema.icon,
                run: async (_ctx: any, inputs: any) => runFunctionCall(def.id, inputs || {}, serviceHooks(project)),
            });
            project.registeredFunctions.set(def.id, sig);
        } catch (err) {
            console.error(`[ActionsService] Failed to register function "${def.name}" of project "${project.meta.name}":`, err);
        }
    }
}

const editedAt = (project: Project) => (project.revision > 0 ? project.revision : project.meta.createdAt);

function summary(project: Project): ProjectSummary {
    return {
        id: project.meta.id,
        name: project.meta.name,
        enabled: project.meta.enabled,
        createdAt: project.meta.createdAt,
        editedAt: editedAt(project),
        flowCount: project.flows.filter((b) => b.isTrigger).length,
        draft: project.draft,
        ...(project.loadError ? { loadError: project.loadError } : {}),
        preview: project.loadError ? null : canvasPreview(project.flows, project.notes),
    };
}

function publish() {
    serviceCtx?.setState({
        rev,
        projects: [...projects.values()].map(summary),
        projectsError,
    });
}

// concurrent stored-flow runs are BOUNDED: a chatty trigger stacking
// unbounded concurrent executeFlow runs is exactly the resource surprise
// this panel must not produce. Beyond the cap, the run is refused loudly.
const MAX_CONCURRENT_FLOW_RUNS = 8;
let runningFlows = 0;

// typed refusal, exported for tests: EVERY flow execution (stored AND
// test runs) goes through this ONE gate — the cap is never mirrored
export class FlowRunRefused extends Error {
    name = "FlowRunRefused";
}

const flowCallbacks = (ctx: Ctx, projectId: string) => ({
    onStepChange: (stepId: string | null, status: "start" | "end") => {
        if (stepId) ctx.emitTrigger("flow-step", { blockId: stepId, status, project: projectId });
    },
    onLog: (entry: { time: string; message: string }) => {
        ctx.emitTrigger("flow-log", { ...entry, project: projectId });
    },
});

export function flowRunCap(): number {
    return MAX_CONCURRENT_FLOW_RUNS;
}

/** What a flow is called outside its canvas: with its project once there are several. */
function runLabel(project: Project, flow: CanvasBlock): string {
    const label = flowLabels(project.flows).get(flow.id) ?? flow.action?.name ?? flow.id;
    return projects.size > 1 ? `${project.meta.name}: ${label}` : label;
}

async function executeFlowGated(
    ctx: Ctx,
    project: Project,
    triggerBlock: CanvasBlock,
    payload: any,
): Promise<ExecutionLog> {
    if (runningFlows >= MAX_CONCURRENT_FLOW_RUNS) {
        const message = `Flow run refused: ${runningFlows} flows already running (cap ${MAX_CONCURRENT_FLOW_RUNS})`;
        console.warn(`${message} — skipped "${triggerBlock.action?.name || triggerBlock.id}"`);
        throw new FlowRunRefused(message);
    }
    runningFlows++;
    const key = flowKey(project.meta.id, triggerBlock.id);
    const label = runLabel(project, triggerBlock);
    runningByFlow.set(key, (runningByFlow.get(key) ?? 0) + 1);
    ctx.setState({ running: [...runningByFlow.keys()] });
    ctx.emitTrigger("flow-start", { triggerBlockId: triggerBlock.id, project: project.meta.id });
    const { onStepChange, onLog } = flowCallbacks(ctx, project.meta.id);
    let outcome: { status: FlowRun["status"]; message: string } = { status: "failed", message: "The run did not finish" };
    try {
        const log = await executeFlow(triggerBlock, payload, undefined, onStepChange, onLog, serviceHooks(project));
        outcome = log.status === "success"
            ? { status: "passed", message: log.message }
            : { status: "failed", message: log.message || `Flow ended with status ${log.status}` };
        return log;
    } catch (err) {
        outcome = { status: "failed", message: err instanceof Error ? err.message : String(err) };
        throw err;
    } finally {
        runningFlows--;
        const left = (runningByFlow.get(key) ?? 1) - 1;
        if (left > 0) runningByFlow.set(key, left);
        else runningByFlow.delete(key);
        runHistory = recordRun(runHistory, { id: `run_${Date.now()}_${++runSeq}`, flowId: key, label, ...outcome, finishedAt: Date.now() });
        ctx.setState({ running: [...runningByFlow.keys()], runs: runHistory });
        ctx.emitTrigger("flow-end", { triggerBlockId: triggerBlock.id, project: project.meta.id });
    }
}

function requireProjects(): void {
    if (projectsError) throw new Error(projectsError);
}

function requireProject(projectId: unknown): Project {
    requireProjects();
    const project = typeof projectId === "string" ? projects.get(projectId) : undefined;
    if (!project) throw new Error(`There is no project "${String(projectId)}" in Actions`);
    return project;
}

function requireLoaded(project: Project): void {
    if (project.loadError) throw new Error(`"${project.meta.name}" couldn't be read: ${project.loadError}`);
}

/**
 * The project and manual flow a Home Run button names, by "project/flow".
 * TODO(remove after v0.5): a Run button made before projects names a bare
 * flow id; it is looked up in every project.
 */
function findWidgetFlow(value: unknown): { project: Project; flow: CanvasBlock } | null {
    requireProjects();
    // a project id (64), a slash and a flow id (128)
    if (typeof value !== "string" || !value || value.length > 193) throw new Error("A workflow id is required");
    const slash = value.indexOf("/");
    if (slash > 0) {
        const project = projects.get(value.slice(0, slash));
        if (!project) return null;
        const flow = findManualFlow(project.flows, value.slice(slash + 1));
        return flow ? { project, flow } : null;
    }
    for (const project of projects.values()) {
        const flow = findManualFlow(project.flows, value);
        if (flow) return { project, flow };
    }
    return null;
}

/** Home's Run button: the manual flow it names, by its current label, or gone. */
export function describeWidgetFlow(flowId: unknown): { id: string; label: string } | { gone: true } {
    const found = findWidgetFlow(flowId);
    if (!found) return { gone: true };
    return { id: flowKey(found.project.meta.id, found.flow.id), label: runLabel(found.project, found.flow) };
}

/**
 * Home's Run button: runs one manual flow and answers with its result. A
 * flow that was deleted, or is not started by hand, is refused.
 */
export async function runWidgetFlow(ctx: Ctx, flowId: unknown): Promise<{ status: FlowRun["status"]; message: string }> {
    const found = findWidgetFlow(flowId);
    if (!found) throw new Error("This workflow no longer exists in Actions");
    serviceCtx = ctx;
    const log = await executeFlowGated(ctx, found.project, found.flow, {});
    return log.status === "success"
        ? { status: "passed", message: log.message }
        : { status: "failed", message: log.message || `Flow ended with status ${log.status}` };
}

/** Home's gallery: the flows a Run button can start, in every project. */
export function widgetFlowChoices(): FlowChoice[] {
    requireProjects();
    const choices: FlowChoice[] = [];
    for (const project of projects.values()) {
        for (const flow of project.flows) {
            if (!isManualFlow(flow)) continue;
            choices.push({ value: flowKey(project.meta.id, flow.id), label: runLabel(project, flow) });
        }
    }
    return choices.slice(0, MAX_FLOW_CHOICES);
}

function handleTriggerEvent(output: any, data: any): void {
    if (!data || INTERNAL_TRIGGER_IDS.includes(data.trigger)) return;
    for (const project of projects.values()) {
        if (!project.meta.enabled || project.loadError) continue;
        // Missing source identity must never turn into cross-panel matching.
        for (const b of project.flows) {
            if (!b.isTrigger) continue;
            const matchesTrigger = b.action?.id === data.trigger;
            const matchesPanel = Boolean(b.panelId && b.panelId !== "*" && b.panelId === data.panelId);
            if (!b.panelId || b.panelId === "*") {
                console.warn(`[ActionsService] flow "${b.id}" refused: select an explicit source panel`);
            }
            if (matchesTrigger && matchesPanel && rootMatchesRules(b, output)) {
                void runStoredFlow(serviceCtx, project, b, output);
            }
        }
    }
}

/**
 * Parameterized event routing: a root fires only when every match rule its
 * schema declares holds against the payload. The rule is declarative data
 * (payload field ↔ block input); the comparison is one generic, exact
 * equality — the mechanism knows nothing about what the field means.
 */
function rootMatchesRules(b: CanvasBlock, output: any): boolean {
    const rules = normalizeMatchRules((b.action as any)?.match);
    if (rules.length === 0) return true;
    for (const rule of rules) {
        const def = (b.action as any)?.inputs?.[rule.input];
        const literal = b.values?.[rule.input];
        // an unselected clearable input means "(any)": the rule filters nothing
        if (def?.allowEmpty && isBlankMatchInput(literal)) continue;
        const actual = payloadFieldValue(output, rule.field);
        if (!matchHolds(literal, actual)) return false;
    }
    return true;
}

// exported for tests: direct access to event matching (panel-less and
// wildcard flows are deprecated paths — see handleTriggerEvent)
export function handleTriggerEventForTest(output: any, data: any): void {
    return handleTriggerEvent(output, data);
}

/** the project tests stand flows up in, without storage */
export const TEST_PROJECT_ID = "p-test";

function bareProject(meta: ProjectMeta, draft = false): Project {
    const project: Project = {
        meta,
        doc: projectDocument(meta.id),
        flows: [],
        notes: [],
        functions: [],
        revision: 0,
        loadError: null,
        registeredFunctions: new Map(),
        handle: actionsApi.project(meta.id, ACTIONS_PANEL_ID),
        draft,
    };
    return project;
}

// test-only access to the module-level state and service ctx
export const __actionsTestState = {
    flows: (projectId = TEST_PROJECT_ID) => projects.get(projectId)?.flows ?? [],
    /** stands flows up in one project (TEST_PROJECT_ID unless named), enabled */
    setFlows: (list: CanvasBlock[], projectId = TEST_PROJECT_ID, name = "Test project") => {
        let project = projects.get(projectId);
        if (!project) {
            project = bareProject({ id: projectId, name, enabled: true, createdAt: 0, editedAt: 0 });
            projects.set(projectId, project);
        }
        project.flows = list;
        projectsError = null;
    },
    setEnabled: (projectId: string, enabled: boolean) => {
        const project = projects.get(projectId);
        if (project) project.meta.enabled = enabled;
    },
    clearProjects: () => projects.clear(),
    project: (projectId = TEST_PROJECT_ID) => projects.get(projectId),
    setServiceCtx: (ctx: Ctx | null) => {
        serviceCtx = ctx;
    },
    setProjectsError: (message: string | null) => {
        projectsError = message;
    },
    runs: () => runHistory,
    running: () => runningFlows,
};

function flowTriggerName(b: CanvasBlock): string | null {
    const actionId = b.action?.id;
    if (typeof actionId !== "string" || actionId.length === 0) return null;
    if (INTERNAL_TRIGGER_IDS.includes(actionId)) return null;
    if (actionId.startsWith("function-trigger-")) return null;
    return actionId;
}

// Subscribe once per distinct source event across the enabled projects; its
// handler dispatches all matching flows. Rebuilt whenever a flow set changes.
function resubscribeTriggers(): void {
    for (const unsub of triggerUnsubs) unsub();
    triggerUnsubs = [];
    const subscribed = new Set<string>();
    for (const project of projects.values()) {
        if (!project.meta.enabled || project.loadError) continue;
        for (const b of project.flows) {
            if (!b.isTrigger || b.panelId === "*") continue;
            const triggerName = flowTriggerName(b);
            if (!triggerName) continue;
            const panelId = b.panelId || ACTIONS_PANEL_ID;
            const key = `${panelId}:${triggerName}`;
            if (subscribed.has(key)) continue;
            subscribed.add(key);
            triggerUnsubs.push(actionsApi.onTrigger(panelId, triggerName, handleTriggerEvent));
        }
    }
}

// exported for the actions below AND tests: same bounded gate as test runs
export async function runStoredFlow(
    ctx: Ctx | null,
    project: Project,
    triggerBlock: CanvasBlock,
    payload: any,
): Promise<ExecutionLog | null> {
    if (!ctx) return null;
    try {
        const log = await executeFlowGated(ctx, project, triggerBlock, payload);
        // The runtime returns step failures as an ExecutionLog. They do
        // not reach the catch below, and event runs have no RPC caller to
        // display them (test runs return their log to the editor).
        if (log.status === "error") {
            ctx.emitTrigger("flow-log", {
                time: log.timestamp,
                message: `Flow "${triggerBlock.action?.name || triggerBlock.id}" failed: ${log.message}`,
                status: "error",
                project: project.meta.id,
            });
        }
        return log;
    } catch (err) {
        if (err instanceof FlowRunRefused) {
            // the gate already logged the refusal; stored runs (their
            // caller is a trigger) swallow it, test runs rethrow
            return null;
        }
        const message = (err as any)?.message || String(err);
        console.error(`[ActionsService] Flow "${triggerBlock.action?.name || triggerBlock.id}" failed:`, message);
        ctx.emitTrigger("flow-log", {
            time: new Date().toLocaleTimeString(),
            message: `Flow "${triggerBlock.action?.name || triggerBlock.id}" failed: ${message}`,
            status: "error",
            project: project.meta.id,
        });
        // stored runs are triggered, so their failures surface via the
        // console log — never an unhandled rejection (matches pre-gate)
        return null;
    }
}

// test runs share the SAME bounded gate as stored runs; over the cap the
// refusal reaches the caller as a typed error instead of silent skipping
export async function runTestFlow(
    ctx: Ctx,
    project: Project,
    inputs: { triggerBlockId: string; payload?: any },
): Promise<ExecutionLog> {
    requireLoaded(project);
    const triggerBlock = project.flows.find((b) => b.id === inputs?.triggerBlockId);
    if (!triggerBlock) {
        throw new Error(`Unknown trigger block "${inputs?.triggerBlockId}"`);
    }
    serviceCtx = ctx;
    return await executeFlowGated(ctx, project, triggerBlock, inputs?.payload || {});
}

function validFunctions(list: unknown[]): FunctionDef[] {
    return list.filter(
        (f: any) => f && typeof f.id === "string" && typeof f.name === "string",
    ) as FunctionDef[];
}

function validateCanvas(canvas: CanvasDocument): CanvasDocument {
    return {
        flows: validateFlowDefinitions(Array.isArray(canvas?.flows) ? canvas.flows : []),
        notes: Array.isArray(canvas?.notes) ? canvas.notes : [],
        functions: validFunctions(Array.isArray(canvas?.functions) ? canvas.functions : []),
    };
}

/** Makes a project's definitions the running ones: one path for every source. */
async function applyDefinitions(project: Project, canvas: CanvasDocument, revision: number): Promise<void> {
    project.flows = canvas.flows;
    project.notes = canvas.notes;
    project.functions = canvas.functions;
    project.revision = revision;
    project.loadError = null;
    rev += 1;
    resubscribeTriggers();
    await syncFunctionRegistry(project);
    publish();
}

// each project's canvas has one owner; windows save and load through it
function projectDocument(projectId: string) {
    const doc = createCanvasDocument({
        read: () => config.get<any>(ACTIONS_PANEL_ID, projectCanvasPath(projectId)),
        write: async (saved) => {
            const project = projects.get(projectId);
            if (project?.draft) {
                // a draft is kept from its first flow on: until then, nothing is written
                if (!saved.flows.some((b) => b.isTrigger)) return;
                await config.set(saved, ACTIONS_PANEL_ID, projectCanvasPath(projectId));
                await keepDraft(project);
                return;
            }
            await config.set(saved, ACTIONS_PANEL_ID, projectCanvasPath(projectId));
        },
        // TODO(remove after v0.4): with the update in removedSteps.ts
        backup: (saved) => config.set(saved, ACTIONS_PANEL_ID, `projects/${projectId}.before-0.3.json`),
        validate: validateCanvas,
        apply: async (canvas) => {
            const project = projects.get(projectId);
            if (!project) throw new Error("This project was deleted");
            const { revision } = await doc.get();
            await applyDefinitions(project, canvas, revision);
        },
        // only the revision travels; windows pull the canvas when they are
        // idle, so a drag does not push the whole document per frame
        onChanged: (change) => serviceCtx?.emit(CANVAS_CHANGED_EVENT, { ...change, project: projectId }),
    });
    return doc;
}

// ── the project list ───────────────────────────────────────────────────────

let indexQueue: Promise<unknown> = Promise.resolve();
/** Project list changes run one at a time, each written before the next. */
function serialIndex<T>(op: () => Promise<T>): Promise<T> {
    const next = indexQueue.then(op, op);
    indexQueue = next.catch(() => undefined);
    return next;
}

async function writeIndex(): Promise<void> {
    const kept = [...projects.values()].filter((p) => !p.draft).map((p) => p.meta);
    await config.set(projectIndexDocument(kept), ACTIONS_PANEL_ID, PROJECTS_FILE);
}

/** A draft's first flow is saved: it joins the project list. */
function keepDraft(project: Project): Promise<void> {
    return serialIndex(async () => {
        if (projects.get(project.meta.id) !== project) {
            // deleted while its first flow was being written
            await config.set(null, ACTIONS_PANEL_ID, projectCanvasPath(project.meta.id));
            throw new Error("This project was deleted");
        }
        if (!project.draft) return;
        project.draft = false;
        try {
            await writeIndex();
        } catch (err) {
            project.draft = true;
            throw err;
        }
        publish();
    });
}

/**
 * The stored project list. Before projects there was one canvas: the first
 * read turns it into a project named "My flows", and canvas.json is left as
 * it was, as the backup.
 */
async function readIndex(): Promise<ProjectMeta[]> {
    const stored = readProjectIndex(await config.get(ACTIONS_PANEL_ID, PROJECTS_FILE));
    if (stored) return stored;
    const legacy = await config.get(ACTIONS_PANEL_ID, LEGACY_CANVAS_FILE);
    const metas: ProjectMeta[] = [];
    if (legacyCanvasHasContent(legacy)) {
        const now = Date.now();
        const meta: ProjectMeta = { id: createProjectId(), name: MIGRATED_PROJECT_NAME, enabled: true, createdAt: now, editedAt: now };
        await config.set(legacy, ACTIONS_PANEL_ID, projectCanvasPath(meta.id));
        metas.push(meta);
        console.log(`[ActionsService] moved the canvas into the project "${MIGRATED_PROJECT_NAME}"; canvas.json stays as it was`);
    }
    await config.set(projectIndexDocument(metas), ACTIONS_PANEL_ID, PROJECTS_FILE);
    return metas;
}

/**
 * Brings a project online: its API project and actions registered (the
 * windows load its canvas through them), then its canvas read and its
 * functions registered. `initial` is a new project's first canvas.
 */
async function openProject(meta: ProjectMeta, initial?: CanvasDocument, draft = false): Promise<Project> {
    const project = bareProject(meta, draft);
    projects.set(meta.id, project);
    try {
        await actionsApi.defineProject({ id: meta.id, name: meta.name, icon: "account_tree" }, ACTIONS_PANEL_ID);
        for (const def of projectActions(project)) {
            await project.handle.register(def);
        }
    } catch (err) {
        projects.delete(meta.id);
        throw new Error(`The project "${meta.name}" could not be registered: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
        let snapshot = await project.doc.load();
        if (initial) {
            const saved = await project.doc.save({ canvas: initial, baseRevision: snapshot.revision, clientId: "service" });
            if (saved.applyError) throw new Error(saved.applyError);
            snapshot = await project.doc.get();
        }
        project.flows = snapshot.canvas.flows;
        project.notes = snapshot.canvas.notes;
        project.functions = snapshot.canvas.functions;
        project.revision = snapshot.revision;
    } catch (err) {
        project.loadError = err instanceof Error ? err.message : String(err);
        console.error(`[ActionsService] project "${meta.name}" could not be read:`, project.loadError);
    }
    await syncFunctionRegistry(project);
    return project;
}

async function createProject(name: unknown, initial?: CanvasDocument): Promise<ProjectSummary> {
    return serialIndex(async () => {
        requireProjects();
        if (projects.size >= MAX_PROJECTS) throw new Error(`Actions holds at most ${MAX_PROJECTS} projects`);
        const metas = [...projects.values()].map((p) => p.meta);
        const clean = name === undefined || name === "" ? nextProjectName(metas) : cleanProjectName(name);
        const now = Date.now();
        const meta: ProjectMeta = { id: createProjectId(), name: clean, enabled: true, createdAt: now, editedAt: now };
        // a project with no flows is a draft, kept once it has one
        const draft = !initial?.flows.some((b) => b.isTrigger);
        const project = await openProject(meta, initial, draft);
        if (!draft) {
            try {
                await writeIndex();
            } catch (err) {
                await closeProject(project);
                throw err;
            }
        }
        rev += 1;
        resubscribeTriggers();
        publish();
        return summary(project);
    });
}

async function closeProject(project: Project): Promise<void> {
    projects.delete(project.meta.id);
    await project.handle.remove();
}

async function updateProject(projectId: unknown, change: { name?: unknown; enabled?: unknown }): Promise<ProjectSummary> {
    return serialIndex(async () => {
        const project = requireProject(projectId);
        const before = { ...project.meta };
        if (change.name !== undefined) project.meta.name = cleanProjectName(change.name);
        if (change.enabled !== undefined) {
            if (typeof change.enabled !== "boolean") throw new Error("enabled is true or false");
            project.meta.enabled = change.enabled;
        }
        try {
            // a draft's name and switch are written with it, once it has a flow
            if (!project.draft) await writeIndex();
        } catch (err) {
            project.meta = before;
            throw err;
        }
        if (project.meta.name !== before.name) {
            await project.handle.update({ name: project.meta.name, icon: "account_tree" });
        }
        rev += 1;
        resubscribeTriggers();
        publish();
        return summary(project);
    });
}

/** `onlyDraft`: a project kept by now stays, as leaving an empty new one asks */
async function deleteProject(projectId: unknown, onlyDraft = false): Promise<void> {
    return serialIndex(async () => {
        const project = requireProject(projectId);
        if (onlyDraft && !project.draft) return;
        projects.delete(project.meta.id);
        // a draft was never written: there is nothing to take back
        if (!project.draft) {
            try {
                await writeIndex();
            } catch (err) {
                projects.set(project.meta.id, project);
                throw err;
            }
            // the canvas file is emptied, not kept: a deleted project is gone
            await config.set(null, ACTIONS_PANEL_ID, projectCanvasPath(project.meta.id));
        }
        await project.handle.remove();
        rev += 1;
        resubscribeTriggers();
        publish();
    });
}

async function duplicateProject(projectId: unknown): Promise<ProjectSummary> {
    const source = requireProject(projectId);
    requireLoaded(source);
    const copy = addFlowFile(
        { flows: [], notes: [], functions: [] },
        { flows: source.flows, notes: source.notes, functions: source.functions },
        (kind) => `${kind}_${crypto.randomUUID()}`,
    );
    const metas = [...projects.values()].map((p) => p.meta);
    return createProject(nextProjectName(metas, `Copy of ${source.meta.name}`.slice(0, 128)), copy);
}

// ── editing a project's flows programmatically ─────────────────────────────

async function editCanvas(project: Project, edit: (canvas: CanvasDocument) => CanvasDocument): Promise<CanvasSnapshot> {
    requireLoaded(project);
    const current = await project.doc.get();
    const saved = await project.doc.save({ canvas: edit(current.canvas), baseRevision: current.revision, clientId: "service" });
    if (saved.applyError) throw new Error(`Saved, but the flows could not be started: ${saved.applyError}`);
    return project.doc.get();
}

async function schemaLookup() {
    const listed = await actionsApi.list();
    const byKey = new Map<string, ActionSchema>();
    for (const entry of [...listed, ...BUILTIN_SCHEMA_ENTRIES]) {
        if (entry.schema) byKey.set(`${entry.panelId}\n${entry.action}`, entry.schema as ActionSchema);
    }
    return (panel: string, action: string) => byKey.get(`${panel}\n${action}`);
}

function flowSummaries(project: Project) {
    const labels = flowLabels(project.flows);
    return project.flows
        .filter((b) => b.isTrigger)
        .map((b) => ({
            id: b.id,
            label: labels.get(b.id),
            trigger: { panel: b.panelId, action: b.action?.id, name: b.action?.name },
            steps: countSteps(b.children),
            startsByHand: isManualFlow(b),
            position: b.pos,
        }));
}

function countSteps(list: CanvasBlock[] | undefined): number {
    return (list ?? []).reduce((n, b) => n + 1 + countSteps(b.children) + countSteps(b.elseChildren), 0);
}

function requireFlow(project: Project, flowId: unknown): CanvasBlock {
    requireLoaded(project);
    const flow = project.flows.find((b) => b.isTrigger && b.id === flowId);
    if (!flow) throw new Error(`"${project.meta.name}" has no flow "${String(flowId)}"; list-flows names them`);
    return flow;
}

/** What every project offers through the Actions API, as "project/action". */
function projectActions(project: Project): ActionDefinition[] {
    const ready = async () => {
        await actionsService.ready;
        if (!projects.has(project.meta.id)) throw new Error(`The project "${project.meta.name}" was deleted`);
    };
    return [
        defineAction({
            id: "get-canvas",
            name: "Get Canvas",
            internal: true,
            description: "The project's canvas and its revision, for the panel's windows",
            template: "Get canvas",
            inputs: {},
            output: { type: "object", label: "Canvas" },
            icon: "draw",
            run: async () => {
                await ready();
                return project.doc.get();
            },
        }),
        defineAction({
            id: "save-canvas",
            name: "Save Canvas",
            internal: true,
            description: "Saves a window's canvas made on a revision, then applies its flows",
            template: "Save canvas",
            inputs: {
                canvas: { type: "object", label: "Canvas" },
                baseRevision: { type: "number", label: "Base revision" },
                clientId: { type: "string", label: "Window" },
            },
            output: { type: "object", label: "Save Result" },
            icon: "save",
            run: async (_ctx: unknown, inputs: { canvas?: CanvasDocument; baseRevision?: number; clientId?: string }) => {
                await ready();
                if (!inputs?.canvas || typeof inputs.canvas !== "object") throw new Error("save-canvas needs a canvas");
                if (!Number.isSafeInteger(inputs.baseRevision)) throw new Error("save-canvas needs the revision the edit was made on");
                const clientId = typeof inputs.clientId === "string" ? inputs.clientId.slice(0, 64) : "";
                return project.doc.save({ canvas: inputs.canvas, baseRevision: inputs.baseRevision!, clientId });
            },
        }),
        defineAction({
            id: "test-run-flow",
            name: "Test Run Flow",
            internal: true,
            description: "Executes one flow of this project by trigger block id and returns its log",
            template: "Test run flow",
            inputs: {
                triggerBlockId: { type: "string", label: "Trigger Block ID", required: true },
                payload: { type: "object", label: "Payload" },
            },
            output: { type: "object", label: "Execution Log" },
            icon: "play_arrow",
            run: async (_ctx: unknown, inputs: { triggerBlockId: string; payload?: any }) => {
                await ready();
                if (!serviceCtx) throw new Error("The Actions service is not initialized");
                // gate is shared with stored runs (one invariant, one impl);
                // over the cap this throws FlowRunRefused, never silently runs
                return runTestFlow(serviceCtx, project, inputs);
            },
        }),
        defineAction({
            id: "list-flows",
            name: "List Flows",
            hidden: true,
            description: "Every flow in this project: its id, what it's called, its trigger, how many steps it has, and whether it starts by hand",
            template: "List flows",
            inputs: {},
            output: { type: "list<object>", label: "Flows" },
            icon: "list",
            run: async () => {
                await ready();
                requireLoaded(project);
                return flowSummaries(project);
            },
        }),
        defineAction({
            id: "get-flow",
            name: "Get Flow",
            hidden: true,
            description: "One flow of this project, step by step: each step's panel, action, input values and id",
            template: "Get flow {flowId}",
            inputs: { flowId: { type: "string", label: "Flow id", required: true } },
            output: { type: "object", label: "Flow" },
            icon: "account_tree",
            run: async (_ctx: unknown, inputs: { flowId?: string }) => {
                await ready();
                return viewFlow(requireFlow(project, inputs?.flowId));
            },
        }),
        defineAction({
            id: "add-flow",
            name: "Add Flow",
            hidden: true,
            description:
                "Adds a flow to this project's canvas, placed clear of every other flow. " +
                "`flow` is { trigger: { panel, action, values? }, steps: [{ panel, action, values?, ref?, name?, steps?, else? }] }. " +
                "The trigger is an event action (\"builtin.logic\" \"on-play\" starts by hand). Containers (\"builtin.logic\" repeat, if, if-else) take steps, and if-else takes else; list-blocks lists every built-in block. " +
                "A value reads an earlier step's result as {{ref}} and a trigger's field as {{field}}. A step can be any registered action that isn't an event.",
            template: "Add flow {flow}",
            inputs: { flow: { type: "object", label: "Flow", required: true } },
            output: { type: "object", label: "Added flow" },
            icon: "add_box",
            run: async (_ctx: unknown, inputs: { flow?: unknown }) => {
                await ready();
                requireLoaded(project);
                const lookup = await schemaLookup();
                let added: CanvasBlock | undefined;
                await editCanvas(project, (canvas) => {
                    const draft = buildFlow(inputs?.flow, lookup, () => `block_${crypto.randomUUID()}`, { x: 0, y: 0 });
                    const rect = flowRect(draft);
                    added = { ...draft, pos: placeFlow(canvasRects(canvas.flows, canvas.notes), rect) };
                    return { ...canvas, flows: [...canvas.flows, added] };
                });
                return { flowId: added!.id, label: flowLabels(project.flows).get(added!.id), position: added!.pos };
            },
        }),
        defineAction({
            id: "remove-flow",
            name: "Remove Flow",
            hidden: true,
            description: "Removes one flow, with all its steps, from this project's canvas",
            template: "Remove flow {flowId}",
            inputs: { flowId: { type: "string", label: "Flow id", required: true } },
            output: { type: "object", label: "Removed" },
            icon: "delete",
            run: async (_ctx: unknown, inputs: { flowId?: string }) => {
                await ready();
                const flow = requireFlow(project, inputs?.flowId);
                await editCanvas(project, (canvas) => ({ ...canvas, flows: canvas.flows.filter((b) => b.id !== flow.id) }));
                return { removed: flow.id };
            },
        }),
        defineAction({
            id: "run-flow",
            name: "Run Flow",
            hidden: true,
            description: "Runs one flow of this project that starts by hand (On Play) and returns how it went",
            template: "Run flow {flowId}",
            inputs: { flowId: { type: "string", label: "Flow id", required: true } },
            output: { type: "object", label: "Run result" },
            icon: "play_arrow",
            run: async (_ctx: unknown, inputs: { flowId?: string }) => {
                await ready();
                const flow = requireFlow(project, inputs?.flowId);
                if (!isManualFlow(flow)) throw new Error("Only a flow that starts by hand (On Play) can be run; the others start on their events");
                if (!serviceCtx) throw new Error("The Actions service is not initialized");
                const log = await executeFlowGated(serviceCtx, project, flow, {});
                return { status: log.status === "success" ? "passed" : "failed", message: log.message, steps: log.steps };
            },
        }),
    ];
}

export const actions = [
    defineAction({
        id: "list-blocks",
        name: "List Built-in Blocks",
        hidden: true,
        description:
            "The blocks every flow can use besides panels' actions: On Play, Wait, Repeat, If, If/Else, variables, text, math, dates, web requests and more, " +
            "each with its panel, action and inputs, to name in add-flow. Blocks that hold steps say so",
        template: "List built-in blocks",
        inputs: {},
        output: { type: "list<object>", label: "Blocks" },
        icon: "widgets",
        run: () => builtinBlocks(),
    }),

    defineAction({
        id: "list-projects",
        name: "List Projects",
        hidden: true,
        description: "Every Actions project: its id, name, whether its flows run, and how many flows it has",
        template: "List projects",
        inputs: {},
        output: { type: "list<object>", label: "Projects" },
        icon: "folder",
        run: async () => {
            await actionsService.ready;
            requireProjects();
            return [...projects.values()].map((p) => {
                const { preview: _preview, ...rest } = summary(p);
                return rest;
            });
        },
    }),

    defineAction({
        id: "create-project",
        name: "Create Project",
        hidden: true,
        description: "Creates an empty Actions project and returns its id. It is kept once it has a flow; one left empty is gone when Actions restarts",
        template: "Create project {name}",
        inputs: { name: { type: "string", label: "Name", maxLength: 128 } },
        output: { type: "object", label: "Project" },
        icon: "create_new_folder",
        run: async (_ctx: Ctx, inputs: { name?: string }) => {
            await actionsService.ready;
            return createProject(inputs?.name);
        },
    }),

    defineAction({
        id: "update-project",
        name: "Update Project",
        hidden: true,
        description: "Renames a project, or turns its flows on or off (off: they no longer start on their events)",
        template: "Update project {project}",
        inputs: {
            project: { type: "string", label: "Project id", required: true },
            name: { type: "string", label: "Name", maxLength: 128 },
            enabled: { type: "boolean", label: "Flows on" },
        },
        output: { type: "object", label: "Project" },
        icon: "edit",
        run: async (_ctx: Ctx, inputs: { project?: string; name?: string; enabled?: boolean }) => {
            await actionsService.ready;
            return updateProject(inputs?.project, { name: inputs?.name, enabled: inputs?.enabled });
        },
    }),

    defineAction({
        id: "duplicate-project",
        name: "Duplicate Project",
        hidden: true,
        description: "Makes a copy of a project, named \"Copy of ...\", and returns it",
        template: "Duplicate project {project}",
        inputs: { project: { type: "string", label: "Project id", required: true } },
        output: { type: "object", label: "Project" },
        icon: "content_copy",
        run: async (_ctx: Ctx, inputs: { project?: string }) => {
            await actionsService.ready;
            return duplicateProject(inputs?.project);
        },
    }),

    defineAction({
        id: "delete-project",
        name: "Delete Project",
        hidden: true,
        description: "Deletes a project and every flow in it. This can't be undone. With onlyDraft, only a project not kept yet (no flows saved) is deleted",
        template: "Delete project {project}",
        inputs: {
            project: { type: "string", label: "Project id", required: true },
            onlyDraft: { type: "boolean", label: "Only if not kept yet" },
        },
        output: { type: "object", label: "Deleted" },
        icon: "delete",
        run: async (_ctx: Ctx, inputs: { project?: string; onlyDraft?: boolean }) => {
            await actionsService.ready;
            await deleteProject(inputs?.project, inputs?.onlyDraft === true);
            return { deleted: inputs?.project };
        },
    }),

    defineAction({
        id: "widget-flow",
        name: "Widget Flow",
        internal: true,
        description: "What a Home Run button's workflow is called, or that it is gone",
        template: "Describe widget flow",
        inputs: { flowId: { type: "string", label: "Workflow", required: true } },
        output: { type: "object", label: "Workflow" },
        icon: "widgets",
        run: async (_ctx: Ctx, inputs: { flowId?: unknown }) => {
            await actionsService.ready;
            return describeWidgetFlow(inputs?.flowId);
        },
    }),

    defineAction({
        id: "run-widget-flow",
        name: "Run Widget Flow",
        internal: true,
        description: "Runs the manual workflow a Home Run button names and returns its result",
        template: "Run widget flow",
        inputs: { flowId: { type: "string", label: "Workflow", required: true } },
        output: { type: "object", label: "Run Result" },
        icon: "play_arrow",
        run: async (ctx: Ctx, inputs: { flowId?: unknown }) => {
            await actionsService.ready;
            return runWidgetFlow(ctx, inputs?.flowId);
        },
    }),
];

export const actionsService = definePanelService({
    id: ACTIONS_PANEL_ID,
    state: {
        rev: 0,
        projects: [],
        projectsError: null,
        runs: [],
        running: [],
    } as ActionsServiceState,
    actions,
    // what the Run button's "Workflow" dropdown offers in Home's gallery
    widgetChoices: {
        "run-button": { flow: () => widgetFlowChoices() },
    },
    async onInit(ctx: Ctx) {
        serviceCtx = ctx;

        await initVariablesStore();

        let metas: ProjectMeta[] = [];
        try {
            metas = await readIndex();
            projectsError = null;
        } catch (err) {
            projectsError = `Actions couldn't read its projects: ${err instanceof Error ? err.message : String(err)}`;
            // the panel shows this; nothing is written over a list that
            // could not be read
            console.error("[ActionsService] Failed to read the project list:", err);
        }

        for (const meta of metas) {
            try {
                await openProject(meta);
            } catch (err) {
                // the project stays listed, with the reason, instead of vanishing
                const project = bareProject(meta);
                project.loadError = err instanceof Error ? err.message : String(err);
                projects.set(meta.id, project);
                console.error("[ActionsService]", project.loadError);
            }
        }
        rev += 1;
        resubscribeTriggers();
        publish();
        console.log(`[ActionsService] Ready with ${projects.size} project(s).`);
    },
});

export default actionsService;
