// Projects: each one a canvas of flows with a name, listed on the Blocks
// home screen like documents. The index says
// which projects exist and whether their flows run; each canvas is its own
// file. The store runs in the service and in the tests, over any storage
// that reads and writes JSON by path.
import { EMPTY_FLOWS as EMPTY, MAX_PREVIEW_BLOCKS, MAX_PREVIEW_PATH, PANEL_ID, type CanvasPreview, type PreviewBlock, type PreviewRect, type ProjectMeta, type ProjectSummary, type SavedFlows } from "../panel";
import { readFlows } from "./flows";
import { isHat } from "./interpreter";
import { errorMessage, isRecord, SerialQueue } from "@mileniumhq/paperapi";

/** the project index, in the panel's files */
export const PROJECTS_FILE = "projects.json";
export const PROJECTS_VERSION = 1;
/** the one canvas from before projects (the panel's config document) becomes this project */
export const MIGRATED_PROJECT_NAME = "My flows";
export const NEW_PROJECT_NAME = "Untitled project";
export const MAX_PROJECT_NAME = 128;
/** a project is a canvas a person keeps; more than this is not a workspace */
export const MAX_PROJECTS = 200;

/** Reads and writes JSON by path; `undefined` is the panel's config document. */
export interface ProjectStorage {
    get(path?: string): Promise<unknown>;
    set(value: unknown, path?: string): Promise<void>;
}

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isProjectId(id: unknown): id is string {
    return typeof id === "string" && PROJECT_ID.test(id);
}

export function createProjectId(): string {
    return `p-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function projectFlowsPath(id: string): string {
    if (!isProjectId(id)) throw new Error(`"${id}" is not a project id`);
    return `projects/${id}.json`;
}

/** A name a person typed, made fit to keep; empty is refused. */
export function cleanProjectName(name: unknown): string {
    const clean = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
    if (!clean) throw new Error("A project needs a name");
    if (clean.length > MAX_PROJECT_NAME) throw new Error(`A project name may be at most ${MAX_PROJECT_NAME} characters`);
    return clean;
}

/** "Untitled project", or "Untitled project 2" when that is taken; a long base is cut so the number still fits. */
export function nextProjectName(names: readonly string[], base = NEW_PROJECT_NAME): string {
    const taken = new Set(names);
    for (let n = 1; ; n++) {
        const suffix = n === 1 ? "" : ` ${n}`;
        const name = base.slice(0, MAX_PROJECT_NAME - suffix.length).trimEnd() + suffix;
        if (!taken.has(name)) return name;
    }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRect = (v: unknown): v is PreviewRect => isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.w) && isFiniteNumber(v.h) && v.w >= 0 && v.h >= 0;

/** An SVG outline: path commands and numbers only, and no longer than a block's needs. */
const isOutline = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_PREVIEW_PATH && /^[MmLlHhVvCcSsQqTtAaZz0-9.,\se+-]*$/.test(v);
const isPreviewBlock = (v: unknown): v is PreviewBlock =>
    isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isOutline(v.path) && typeof v.fill === "string" && /^[a-z0-9-]+$/.test(v.fill);

/** A miniature the page sent, or null when it isn't one. */
export function readPreview(raw: unknown): CanvasPreview | null {
    if (raw === null || raw === undefined) return null;
    // stacks drawn as boxes, by a Blocks from before miniatures showed their blocks: drawn again on the next edit
    if (isRecord(raw) && "rects" in raw && !("blocks" in raw)) return null;
    if (!isRecord(raw) || !isRect(raw.bounds) || !Array.isArray(raw.blocks) || !raw.blocks.every(isPreviewBlock)) throw new Error("The canvas preview is broken");
    return { bounds: raw.bounds, blocks: raw.blocks.slice(0, MAX_PREVIEW_BLOCKS) };
}

/**
 * Reads the stored index. Missing (null) is "no index yet"; anything else
 * that is not an index, or one written by a newer Blocks, is refused.
 */
export function readProjectIndex(saved: unknown): ProjectMeta[] | null {
    if (saved === null || saved === undefined) return null;
    if (!isRecord(saved) || !Array.isArray(saved.projects)) throw new Error("the project list is damaged");
    if (typeof saved.version === "number" && saved.version > PROJECTS_VERSION) {
        throw new Error(`it was saved by a newer version of Blocks (projects version ${saved.version}); update Blocks to open it`);
    }
    const seen = new Set<string>();
    return saved.projects.map((p: unknown, i) => {
        if (!isRecord(p) || !isProjectId(p.id) || seen.has(p.id) || typeof p.name !== "string" || !p.name.trim()) {
            throw new Error(`project ${i + 1} in the project list is damaged`);
        }
        seen.add(p.id);
        let preview: CanvasPreview | null = null;
        try {
            preview = readPreview(p.preview);
        } catch (err) {
            // quiet: a miniature is drawn again on the next edit; the project itself is fine
            console.error(`[${PANEL_ID}] project ${p.id}'s canvas preview was dropped: ${errorMessage(err)}`);
        }
        return {
            id: p.id,
            name: p.name,
            enabled: p.enabled !== false,
            createdAt: isFiniteNumber(p.createdAt) ? p.createdAt : 0,
            editedAt: isFiniteNumber(p.editedAt) ? p.editedAt : 0,
            preview,
        };
    });
}

/** The stacks on a canvas, switched off or not: blocks the saved workspace holds at its top level. */
const stacks = (flows: SavedFlows) => flows.workspace.blocks?.blocks ?? [];

/** True when a canvas holds anything worth keeping. */
export function hasBlocks(flows: SavedFlows): boolean {
    return stacks(flows).length > 0;
}

/** The flows a project holds, the switched-off ones too: they are still on its canvas. */
export function flowCount(flows: SavedFlows): number {
    return stacks(flows).filter((b) => isHat(b.type)).length;
}

interface Project {
    meta: ProjectMeta;
    flows: SavedFlows;
    draft: boolean;
    loadError: string | null;
}

export class ProjectStore {
    private projects = new Map<string, Project>();
    private readonly queue = new SerialQueue();
    private opened = false;
    // while paused, one task holds the queue: nothing is written until letGo
    private held: Promise<void> | null = null;
    private letGo: (() => void) | null = null;
    private readAgain = false;

    constructor(private readonly storage: ProjectStorage) {}

    /**
     * Reads every project. Before projects there was one canvas, in the
     * panel's config document: the first open copies it into a project
     * named "My flows" and leaves the document as it was, as the backup.
     */
    async open(): Promise<void> {
        const projects = new Map<string, Project>();
        let metas = readProjectIndex(await this.storage.get(PROJECTS_FILE));
        if (!metas) {
            metas = [];
            const legacy = await this.storage.get();
            const isEmpty = legacy === undefined || legacy === null || (isRecord(legacy) && Object.keys(legacy).length === 0);
            if (!isEmpty) {
                // a canvas that can't be read is not moved, so it is not lost either: the error stops Blocks here
                const flows = readFlows(legacy);
                if (hasBlocks(flows)) {
                    const now = Date.now();
                    const meta: ProjectMeta = { id: createProjectId(), name: MIGRATED_PROJECT_NAME, enabled: true, createdAt: now, editedAt: now, preview: null };
                    await this.storage.set(flows, projectFlowsPath(meta.id));
                    metas.push(meta);
                }
            }
            await this.storage.set({ version: PROJECTS_VERSION, projects: metas }, PROJECTS_FILE);
        }
        for (const meta of metas) {
            const project: Project = { meta, flows: EMPTY, draft: false, loadError: null };
            try {
                const saved = await this.storage.get(projectFlowsPath(meta.id));
                project.flows = saved === undefined || saved === null ? EMPTY : readFlows(saved);
            } catch (err) {
                project.loadError = errorMessage(err);
            }
            projects.set(meta.id, project);
        }
        // the projects are swapped in whole: a read that fails leaves the ones held as they were
        this.projects = projects;
        this.opened = true;
    }

    get paused(): boolean {
        return this.held !== null;
    }

    /**
     * Resolves once every change before it is written, and holds the later
     * ones back until `resume`: the files can be copied or swapped meanwhile.
     */
    pause(): Promise<void> {
        if (this.held) throw new Error("The projects are already paused");
        return new Promise<void>((paused) => {
            this.held = this.queue.run(async () => {
                await new Promise<void>((go) => {
                    this.letGo = go;
                    paused();
                });
                // the files changed meanwhile: what is held is read again before any later change runs
                if (this.readAgain) await this.open();
            });
        });
    }

    /** Lets the changes held back run; with `reread` the projects are read from the files first, and a failure to is thrown. */
    async resume(reread: boolean): Promise<void> {
        const held = this.held;
        const go = this.letGo;
        if (!held || !go) throw new Error("The projects are not paused");
        this.held = null;
        this.letGo = null;
        this.readAgain = reread;
        go();
        await held;
    }

    /** Every project, the most recently edited first. */
    list(): ProjectSummary[] {
        return [...this.projects.values()]
            .map((p) => this.summary(p))
            .sort((a, b) => b.editedAt - a.editedAt || a.name.localeCompare(b.name));
    }

    /** The projects whose flows start on their events: switched on, and read. */
    running(): { id: string; flows: SavedFlows }[] {
        return [...this.projects.values()].filter((p) => p.meta.enabled && !p.loadError).map((p) => ({ id: p.meta.id, flows: p.flows }));
    }

    flows(id: unknown): SavedFlows {
        const project = this.require(id);
        if (project.loadError) throw new Error(`"${project.meta.name}" couldn't be read: ${project.loadError}`);
        return project.flows;
    }

    has(id: unknown): boolean {
        return typeof id === "string" && this.projects.has(id);
    }

    summaryOf(id: unknown): ProjectSummary {
        return this.summary(this.require(id));
    }

    /** A new project; with no blocks it is a draft, written once it has one. */
    create(name?: unknown, initial: SavedFlows = EMPTY, preview: CanvasPreview | null = null): Promise<ProjectSummary> {
        return this.serial(() => this.make(name, initial, preview));
    }

    /** A copy named "Copy of ...", with the flows the source has once the changes before it are written. */
    duplicate(id: unknown): Promise<ProjectSummary> {
        return this.serial(() => {
            const source = this.require(id);
            if (source.loadError) throw new Error(`"${source.meta.name}" couldn't be read, so it can't be copied: ${source.loadError}`);
            return this.make(nextProjectName(this.keptNames(), `Copy of ${source.meta.name}`), structuredClone(source.flows), source.meta.preview);
        });
    }

    /** create's work, run in its turn of `serial`. */
    private async make(name: unknown, initial: SavedFlows, preview: CanvasPreview | null): Promise<ProjectSummary> {
        this.requireOpen();
        if (this.kept().length >= MAX_PROJECTS) throw new Error(`Blocks holds at most ${MAX_PROJECTS} projects`);
        const clean = name === undefined || name === "" ? nextProjectName(this.keptNames()) : cleanProjectName(name);
        const now = Date.now();
        const meta: ProjectMeta = { id: createProjectId(), name: clean, enabled: true, createdAt: now, editedAt: now, preview };
        const project: Project = { meta, flows: initial, draft: !hasBlocks(initial), loadError: null };
        if (!project.draft) await this.storage.set(initial, projectFlowsPath(meta.id));
        this.projects.set(meta.id, project);
        if (!project.draft) {
            try {
                await this.writeIndex();
            } catch (err) {
                this.projects.delete(meta.id);
                // what is said is why the project wasn't made, and the cleanup's failure after it
                await this.storage.set(null, projectFlowsPath(meta.id)).catch((why: unknown) => {
                    throw new Error(`${errorMessage(err)} Its file ${projectFlowsPath(meta.id)} wasn't removed either: ${errorMessage(why)}`);
                });
                throw err;
            }
        }
        return this.summary(project);
    }

    /** A project's canvas as the page saved it. A draft is written from its first block on. */
    save(id: unknown, flows: SavedFlows, preview: CanvasPreview | null): Promise<ProjectSummary> {
        return this.serial(async () => {
            const project = this.require(id);
            if (project.draft && !hasBlocks(flows)) {
                project.flows = flows;
                project.meta.preview = preview;
                return this.summary(project);
            }
            await this.storage.set(flows, projectFlowsPath(project.meta.id));
            const before = { meta: { ...project.meta }, flows: project.flows, draft: project.draft, loadError: project.loadError };
            project.flows = flows;
            project.loadError = null;
            project.draft = false;
            project.meta.editedAt = Date.now();
            project.meta.preview = preview;
            try {
                await this.writeIndex();
            } catch (err) {
                Object.assign(project, before);
                throw err;
            }
            return this.summary(project);
        });
    }

    update(id: unknown, change: { name?: unknown; enabled?: unknown }): Promise<ProjectSummary> {
        return this.serial(async () => {
            const project = this.require(id);
            // both are checked before either changes, so a refused change changes nothing
            const name = change.name === undefined ? undefined : cleanProjectName(change.name);
            const enabled = change.enabled;
            if (enabled !== undefined && typeof enabled !== "boolean") throw new Error("enabled is true or false");
            const before = { ...project.meta };
            if (name !== undefined) project.meta.name = name;
            if (typeof enabled === "boolean") project.meta.enabled = enabled;
            try {
                // a draft's name and switch are written with it, once it has a block
                if (!project.draft) await this.writeIndex();
            } catch (err) {
                project.meta = before;
                throw err;
            }
            return this.summary(project);
        });
    }

    /** `onlyDraft`: a project kept by now stays, as leaving an empty new one asks. */
    remove(id: unknown, onlyDraft = false): Promise<boolean> {
        return this.serial(async () => {
            const project = this.require(id);
            if (onlyDraft && !project.draft) return false;
            this.projects.delete(project.meta.id);
            // a draft was never written: there is nothing to take back
            if (!project.draft) {
                try {
                    await this.writeIndex();
                } catch (err) {
                    this.projects.set(project.meta.id, project);
                    throw err;
                }
                // the canvas file is emptied, not kept: a deleted project is gone. The
                // project is deleted by now, so a file that stays says only that
                await this.storage.set(null, projectFlowsPath(project.meta.id)).catch((why: unknown) => {
                    throw new Error(`"${project.meta.name}" was deleted, but its file ${projectFlowsPath(project.meta.id)} wasn't emptied: ${errorMessage(why)}`);
                });
            }
            return true;
        });
    }

    /** Lets go of every draft: none is written, so nothing is taken back. How many went. */
    dropDrafts(): Promise<number> {
        return this.serial(async () => {
            const drafts = [...this.projects.values()].filter((p) => p.draft);
            for (const draft of drafts) this.projects.delete(draft.meta.id);
            return drafts.length;
        });
    }

    private summary(p: Project): ProjectSummary {
        return { ...p.meta, draft: p.draft, loadError: p.loadError, flowCount: p.loadError ? 0 : flowCount(p.flows) };
    }

    private require(id: unknown): Project {
        this.requireOpen();
        const project = typeof id === "string" ? this.projects.get(id) : undefined;
        if (!project) throw new Error(`There's no project "${String(id)}"; it may have been deleted`);
        return project;
    }

    private requireOpen(): void {
        if (!this.opened) throw new Error("The projects haven't been read yet");
    }

    /**
     * The projects kept: a draft is only its editor's until it has a block. A
     * draft whose window closed lives on here unseen while another window is
     * open (until none is: dropDrafts), so it takes no name and no place, and
     * nothing is written of it.
     */
    private kept(): Project[] {
        return [...this.projects.values()].filter((p) => !p.draft);
    }

    private keptNames(): string[] {
        return this.kept().map((p) => p.meta.name);
    }

    private writeIndex(): Promise<void> {
        return this.storage.set({ version: PROJECTS_VERSION, projects: this.kept().map((p) => p.meta) }, PROJECTS_FILE);
    }

    /** Changes run one at a time, each written before the next. */
    private serial<T>(op: () => Promise<T>): Promise<T> {
        return this.queue.run(op);
    }
}
