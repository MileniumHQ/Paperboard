// Projects: each one a canvas of flows with a name, listed on the Blocks
// home screen like documents, as Actions lists its own. The index says
// which projects exist and whether their flows run; each canvas is its own
// file. The store runs in the service and in the tests, over any storage
// that reads and writes JSON by path.
import { EMPTY_FLOWS as EMPTY, type SavedFlows } from "../panel";
import { readFlows } from "./flows";
import { isHat } from "./interpreter";

/** the project index, in the panel's files */
export const PROJECTS_FILE = "projects.json";
export const PROJECTS_VERSION = 1;
/** the one canvas from before projects (the panel's config document) becomes this project */
export const MIGRATED_PROJECT_NAME = "My flows";
export const NEW_PROJECT_NAME = "Untitled project";
export const MAX_PROJECT_NAME = 128;
/** a project is a canvas a person keeps; more than this is not a workspace */
export const MAX_PROJECTS = 200;
/** the most stacks a card's miniature draws */
export const MAX_PREVIEW_RECTS = 200;

export interface PreviewRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A project's canvas in miniature: where each stack of blocks sits, as the page last drew them. */
export interface CanvasPreview {
    bounds: PreviewRect;
    rects: PreviewRect[];
}

export interface ProjectMeta {
    /** stable, never shown */
    id: string;
    name: string;
    /** whether the project's flows start on their events */
    enabled: boolean;
    /** epoch ms */
    createdAt: number;
    /** epoch ms of the last saved edit */
    editedAt: number;
    preview: CanvasPreview | null;
}

/** A project as the windows see it. */
export interface ProjectSummary extends ProjectMeta {
    /** a new project with no blocks yet: kept once it has one, gone if left empty */
    draft: boolean;
    /** why its canvas couldn't be read; its flows don't run until it can be */
    loadError: string | null;
    /** the flows it holds: its stacks that start from an event or from Run */
    flowCount: number;
}

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

/** "Untitled project", or "Untitled project 2" when that is taken. */
export function nextProjectName(names: readonly string[], base = NEW_PROJECT_NAME): string {
    const taken = new Set(names);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRect = (v: unknown): v is PreviewRect => isRecord(v) && finite(v.x) && finite(v.y) && finite(v.w) && finite(v.h) && v.w >= 0 && v.h >= 0;

/** A miniature the page sent, or null when it isn't one. */
export function readPreview(raw: unknown): CanvasPreview | null {
    if (raw === null || raw === undefined) return null;
    if (!isRecord(raw) || !isRect(raw.bounds) || !Array.isArray(raw.rects) || !raw.rects.every(isRect)) throw new Error("The canvas preview is broken");
    if (raw.rects.length > MAX_PREVIEW_RECTS) return { bounds: raw.bounds, rects: raw.rects.slice(0, MAX_PREVIEW_RECTS) };
    return { bounds: raw.bounds, rects: raw.rects };
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
        } catch {
            // a miniature is drawn again on the next edit; the project itself is fine
        }
        return {
            id: p.id,
            name: p.name,
            enabled: p.enabled !== false,
            createdAt: finite(p.createdAt) ? p.createdAt : 0,
            editedAt: finite(p.editedAt) ? p.editedAt : 0,
            preview,
        };
    });
}

/** The stacks on a canvas: blocks the saved workspace holds at its top level. */
const topBlocks = (flows: SavedFlows) => flows.workspace.blocks?.blocks ?? [];

/** True when a canvas holds anything worth keeping. */
export function hasBlocks(flows: SavedFlows): boolean {
    return topBlocks(flows).length > 0;
}

export function flowCount(flows: SavedFlows): number {
    return topBlocks(flows).filter((b) => isHat(b.type)).length;
}

interface Project {
    meta: ProjectMeta;
    flows: SavedFlows;
    draft: boolean;
    loadError: string | null;
}

export class ProjectStore {
    private readonly projects = new Map<string, Project>();
    private queue: Promise<unknown> = Promise.resolve();
    private opened = false;

    constructor(private readonly storage: ProjectStorage) {}

    /**
     * Reads every project. Before projects there was one canvas, in the
     * panel's config document: the first open copies it into a project
     * named "My flows" and leaves the document as it was, as the backup.
     */
    async open(): Promise<void> {
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
                project.loadError = err instanceof Error ? err.message : String(err);
            }
            this.projects.set(meta.id, project);
        }
        this.opened = true;
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

    summaryOf(id: unknown): ProjectSummary {
        return this.summary(this.require(id));
    }

    /** A new project; with no blocks it is a draft, written once it has one. */
    create(name?: unknown, initial: SavedFlows = EMPTY, preview: CanvasPreview | null = null): Promise<ProjectSummary> {
        return this.serial(async () => {
            this.requireOpen();
            if (this.projects.size >= MAX_PROJECTS) throw new Error(`Blocks holds at most ${MAX_PROJECTS} projects`);
            const names = [...this.projects.values()].map((p) => p.meta.name);
            const clean = name === undefined || name === "" ? nextProjectName(names) : cleanProjectName(name);
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
                    await this.storage.set(null, projectFlowsPath(meta.id));
                    throw err;
                }
            }
            return this.summary(project);
        });
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
            const before = { ...project.meta };
            if (change.name !== undefined) project.meta.name = cleanProjectName(change.name);
            if (change.enabled !== undefined) {
                if (typeof change.enabled !== "boolean") throw new Error("enabled is true or false");
                project.meta.enabled = change.enabled;
            }
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

    /** A copy named "Copy of ...", with the same flows. */
    async duplicate(id: unknown): Promise<ProjectSummary> {
        const source = this.require(id);
        if (source.loadError) throw new Error(`"${source.meta.name}" couldn't be read, so it can't be copied: ${source.loadError}`);
        const names = [...this.projects.values()].map((p) => p.meta.name);
        return this.create(nextProjectName(names, `Copy of ${source.meta.name}`.slice(0, MAX_PROJECT_NAME)), structuredClone(source.flows), source.meta.preview);
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
                // the canvas file is emptied, not kept: a deleted project is gone
                await this.storage.set(null, projectFlowsPath(project.meta.id));
            }
            return true;
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

    private writeIndex(): Promise<void> {
        const kept = [...this.projects.values()].filter((p) => !p.draft).map((p) => p.meta);
        return this.storage.set({ version: PROJECTS_VERSION, projects: kept }, PROJECTS_FILE);
    }

    /** Changes run one at a time, each written before the next. */
    private serial<T>(op: () => Promise<T>): Promise<T> {
        const next = this.queue.then(op, op);
        this.queue = next.catch(() => undefined);
        return next;
    }
}
