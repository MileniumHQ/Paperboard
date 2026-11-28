// A project's Data for a test's host: the real store, over files in memory.
import { DataStore } from "../../src/lib/data";
import type { ProjectData } from "../../src/lib/interpreter";
import type { ProjectStorage } from "../../src/lib/projects";

export function memoryStorage(files = new Map<string, unknown>()): ProjectStorage & { files: Map<string, unknown> } {
    return {
        files,
        get: async (path) => structuredClone(files.get(path ?? "") ?? null),
        set: async (value, path) => void files.set(path ?? "", structuredClone(value)),
    };
}

export function memoryData(project = "p-test", store = new DataStore(memoryStorage())): ProjectData {
    return {
        get: (key) => store.get(project, key),
        set: (key, value) => store.set(project, key, value),
        delete: (key) => store.delete(project, key),
        has: (key) => store.has(project, key),
        keys: () => store.keys(project),
        change: (key, by) => store.change(project, key, by),
    };
}
