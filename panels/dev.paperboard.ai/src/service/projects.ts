// The projects folder: files/agent inside the panel's own storage. Each
// project is a plain directory directly in it; nothing outside is listed or
// resolved, and a symlink is never a project.

import fs from "node:fs";
import path from "node:path";
import { MAX_PROJECTS, projectName } from "../core/projects";

export interface ProjectList {
    names: string[];
    /** more projects exist than are listed */
    truncated: boolean;
}

export class Projects {
    readonly root: string;

    constructor(filesDir: string) {
        this.root = path.join(filesDir, "agent");
    }

    async list(): Promise<ProjectList> {
        await fs.promises.mkdir(this.root, { recursive: true });
        const names: string[] = [];
        let truncated = false;
        const dir = await fs.promises.opendir(this.root);
        for await (const entry of dir) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
            if (names.length === MAX_PROJECTS) {
                truncated = true;
                break;
            }
            names.push(entry.name);
        }
        names.sort((a, b) => a.localeCompare(b));
        return { names, truncated };
    }

    /** Makes a new, empty project; an existing name is refused, not reused. */
    async create(raw: unknown): Promise<string> {
        const name = projectName(raw);
        await fs.promises.mkdir(this.root, { recursive: true });
        try {
            await fs.promises.mkdir(path.join(this.root, name));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`A project named "${name}" already exists.`);
            throw err;
        }
        return name;
    }

    /** The folder an agent works in for a project; refused unless it is a real project folder. */
    async path(raw: unknown): Promise<string> {
        const name = projectName(raw);
        const dir = path.join(this.root, name);
        let stat: fs.Stats;
        try {
            stat = await fs.promises.lstat(dir);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`The project "${name}" no longer exists.`);
            throw err;
        }
        if (!stat.isDirectory()) throw new Error(`"${name}" is not a project folder.`);
        return dir;
    }
}
