// Projects: each one a canvas of its own (flows, notes, functions) with a
// name, listed on the Actions home screen like documents. The index says
// which projects exist and whether their flows run; each canvas is its own
// file. Pure, so the service and its tests share one implementation.

/** the project index, in the panel's files */
export const PROJECTS_FILE = "projects.json";
export const PROJECTS_VERSION = 1;
export const NEW_PROJECT_NAME = "Untitled project";
export const MAX_PROJECT_NAME = 128;
/** a project is a canvas a person keeps; more than this is not a workspace */
export const MAX_PROJECTS = 200;

export interface ProjectMeta {
    /** stable, never shown; doubles as the project's id in the Actions API */
    id: string;
    name: string;
    /** whether the project's flows start on their events */
    enabled: boolean;
    /** epoch ms */
    createdAt: number;
    /** epoch ms of the last saved edit */
    editedAt: number;
}

export interface ProjectIndex {
    version: number;
    projects: ProjectMeta[];
}

export function projectCanvasPath(id: string): string {
    if (!isProjectId(id)) throw new Error(`"${id}" is not a project id`);
    return `projects/${id}.json`;
}

// the Actions API's project id rule (papercrane PROJECT_ID_PATTERN)
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isProjectId(id: unknown): id is string {
    return typeof id === "string" && PROJECT_ID.test(id);
}

export function createProjectId(): string {
    return `p-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** A name a person typed, made fit to keep; empty is refused. */
export function cleanProjectName(name: unknown): string {
    const clean = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
    if (!clean) throw new Error("A project needs a name");
    if (clean.length > MAX_PROJECT_NAME) throw new Error(`A project name may be at most ${MAX_PROJECT_NAME} characters`);
    return clean;
}

/**
 * Reads the stored index. Missing (null) is "no index yet"; anything else
 * that is not an index, or one written by a newer Actions, is refused.
 */
export function readProjectIndex(saved: unknown): ProjectMeta[] | null {
    if (saved === null || saved === undefined) return null;
    const index = saved as Partial<ProjectIndex>;
    if (typeof index !== "object" || !Array.isArray(index.projects)) {
        throw new Error("the project list is damaged");
    }
    if (typeof index.version === "number" && index.version > PROJECTS_VERSION) {
        throw new Error(`it was saved by a newer version of Actions (projects version ${index.version}); update Actions to open it`);
    }
    const seen = new Set<string>();
    return index.projects.map((p: any, i) => {
        if (!p || !isProjectId(p.id) || seen.has(p.id) || typeof p.name !== "string" || !p.name.trim()) {
            throw new Error(`project ${i + 1} in the project list is damaged`);
        }
        seen.add(p.id);
        return {
            id: p.id,
            name: p.name,
            enabled: p.enabled !== false,
            createdAt: Number.isFinite(p.createdAt) ? p.createdAt : 0,
            editedAt: Number.isFinite(p.editedAt) ? p.editedAt : 0,
        };
    });
}

export function projectIndexDocument(projects: ProjectMeta[]): ProjectIndex {
    return { version: PROJECTS_VERSION, projects };
}

/** Most recently edited first, as the home screen lists them. */
export function byRecentEdit(projects: readonly ProjectMeta[]): ProjectMeta[] {
    return [...projects].sort((a, b) => b.editedAt - a.editedAt || a.name.localeCompare(b.name));
}

/** "Untitled project", or "Untitled project 2" when that is taken. */
export function nextProjectName(projects: readonly ProjectMeta[], base = NEW_PROJECT_NAME): string {
    const taken = new Set(projects.map((p) => p.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
