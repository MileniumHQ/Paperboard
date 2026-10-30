// Named subsets of a panel's data. Durable so routine backups keep working
// with the panel closed. No workload-specific knowledge belongs here.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PaperCraneEngine } from "../engine";
import { writeFileAtomicSync } from "../storage";
import { requirePanelId } from "../../../../packages/paperapi/src/panelIdentity";

export type ConfigSelector = Array<string | { id: string }>;
export interface BackupSource {
    id: string;
    directory: string;
    config: ConfigSelector;
    processes: string[];
    exclude?: string[];
    /** Keep the panel's existing backup history, destination and schedule. */
    legacy?: boolean;
}
interface Source extends BackupSource {
    owner: string;
    key: string;
}
const relative = (value: unknown) =>
    typeof value === "string" &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    (value === "" ||
        value
            .split("/")
            .every((part) => /^[A-Za-z0-9._ -]+$/.test(part) && part !== "." && part !== ".."));
function validate(raw: BackupSource): void {
    if (
        !raw ||
        typeof raw.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw.id) ||
        !relative(raw.directory) ||
        !Array.isArray(raw.config) ||
        !raw.config.length ||
        raw.config.some((v) =>
            typeof v === "string"
                ? !v || ["__proto__", "prototype", "constructor"].includes(v)
                : !v || typeof v.id !== "string",
        ) ||
        (raw.legacy !== undefined && typeof raw.legacy !== "boolean") ||
        !Array.isArray(raw.processes) ||
        raw.processes.some((v) => typeof v !== "string" || !v || v.length > 128) ||
        (raw.exclude !== undefined &&
            (!Array.isArray(raw.exclude) ||
                raw.exclude.some((v) => !relative(v) || !v || v.includes("/"))))
    )
        throw new Error("Invalid backup source");
}
function location(root: unknown, selector: ConfigSelector): { parent: any; key: string | number } {
    let current: any = root;
    for (let index = 0; index < selector.length; index++) {
        const step = selector[index]!;
        const key =
            typeof step === "string"
                ? step
                : Array.isArray(current)
                  ? current.findIndex((entry: any) => entry?.id === step.id)
                  : -1;
        if (
            current === null ||
            typeof current !== "object" ||
            key === -1 ||
            !Object.hasOwn(current, key)
        )
            throw new Error("The backup source's config no longer exists");
        if (index === selector.length - 1) return { parent: current, key };
        current = current[key];
    }
    throw new Error("Empty config selector");
}
function sourceKey(owner: string, source: BackupSource): string {
    return source.legacy ? owner : `backup.${createHash("sha256").update(`${owner}/${source.id}`).digest("hex").slice(0, 32)}`;
}
export class BackupSources {
    private readonly file: string;
    constructor(private readonly engine: PaperCraneEngine) {
        this.file = path.join(engine.getAppDataDir(), "backups", "sources.json");
    }
    private read(): Source[] {
        if (!fs.existsSync(this.file)) return [];
        const sources = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (!Array.isArray(sources)) throw new Error("The backup sources file is damaged");
        const seen = new Set<string>();
        for (const source of sources) {
            validate(source);
            requirePanelId(source.owner);
            requirePanelId(source.key);
            if (source.key !== sourceKey(source.owner, source) || seen.has(source.key)) throw new Error("The backup sources file is damaged");
            seen.add(source.key);
        }
        return sources;
    }
    keysForOwner(owner: string): string[] {
        return this.read()
            .filter((s) => s.owner === owner)
            .map((s) => s.key);
    }
    get(key: string): Source | undefined {
        return this.read().find((source) => source.key === key);
    }
    resolve(owner: string, id: string): string {
        const source = this.read().find((s) => s.owner === owner && s.id === id);
        if (!source) throw new Error("That backup source is not registered");
        return source.key;
    }
    define(owner: string, input: BackupSource): void {
        requirePanelId(owner);
        validate(input);
        const sources = this.read();
        const key = sourceKey(owner, input);
        const conflict = sources.find(
            (s) => s.key === key && (s.owner !== owner || s.id !== input.id),
        );
        if (conflict)
            throw new Error("This panel already assigned its legacy backups to another source");
        const source = { ...input, owner, key };
        // Re-registration on service restart must preserve the exact source.
        const previous = sources.find((s) => s.owner === owner && s.id === input.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(source))
            throw new Error("A backup source cannot change its files or config selector");
        if (!previous) {
            sources.push(source);
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            writeFileAtomicSync(this.file, JSON.stringify(sources));
        }
    }
    owner(key: string): string {
        return this.get(key)?.owner ?? key;
    }
    async snapshot(key: string, staging: string): Promise<{ files: string; config: string }> {
        const source = this.get(key);
        if (!source) throw new Error("Backup source not found");
        const entries = this.engine.panelDataEntries(source.owner);
        const from = path.join(this.engine.getAppDataDir(), entries.files, source.directory);
        const config = await this.engine.getConfig(source.owner);
        const selected = location(config, source.config);
        const to = path.join(staging, "files");
        fs.mkdirSync(to, { recursive: true });
        if (fs.existsSync(from))
            await fs.promises.cp(from, to, {
                recursive: true,
                filter: (file) => {
                    const relative = path.relative(from, file).split(path.sep).join("/");
                    return (
                        !fs.lstatSync(file).isSymbolicLink() &&
                        !(source.exclude ?? []).some(
                            (dir) => relative === dir || relative.startsWith(`${dir}/`),
                        )
                    );
                },
            });
        fs.writeFileSync(
            path.join(staging, "config.json"),
            JSON.stringify(selected.parent[selected.key]),
        );
        return { files: "files", config: "config.json" };
    }
    /** Stop only the source's owned processes, and replace only its data.
     * A failed service restart rolls the source back; other sources stay put. */
    async restore(
        key: string,
        staged: { filesDir: string; configFile: string | null },
    ): Promise<void> {
        const source = this.get(key);
        if (!source) throw new Error("Backup source not found");
        if (!staged.configFile) throw new Error("The source backup has no config");
        const restored = JSON.parse(fs.readFileSync(staged.configFile, "utf8"));
        const originalConfig = await this.engine.getConfig(source.owner);
        const originalFiles = path.join(
            this.engine.getAppDataDir(),
            this.engine.panelDataEntries(source.owner).files,
            source.directory,
        );
        const parked = path.join(path.dirname(this.file), `.source-restore-${randomUUID()}`);
        fs.mkdirSync(parked, { recursive: true });
        const keep = new Set(source.exclude ?? []);
        const parkedNames: string[] = [];
        const installedNames: string[] = [];
        const stop = async () => {
            for (const id of source.processes) {
                const owner = this.engine.clientOwner(id);
                if (owner !== null && owner !== source.owner)
                    throw new Error("A backup source cannot stop another panel's process");
                await this.engine.killProcess(id);
            }
        };
        let rolledBack = false;
        try {
            await this.engine.withServicePaused(
                source.owner,
                async () => {
                    await stop();
                    location(originalConfig, source.config);
                    fs.mkdirSync(originalFiles, { recursive: true });
                    for (const name of fs.readdirSync(originalFiles))
                        if (!keep.has(name)) {
                            await fs.promises.rename(
                                path.join(originalFiles, name),
                                path.join(parked, name),
                            );
                            parkedNames.push(name);
                        }
                    for (const name of fs.readdirSync(staged.filesDir))
                        if (!keep.has(name)) {
                            await fs.promises.rename(
                                path.join(staged.filesDir, name),
                                path.join(originalFiles, name),
                            );
                            installedNames.push(name);
                        }
                    const next = structuredClone(originalConfig);
                    const target = location(next, source.config);
                    target.parent[target.key] = restored;
                    await this.engine.setConfig(source.owner, next);
                },
                async () => {
                    await stop();
                    for (const name of installedNames)
                        await fs.promises.rm(path.join(originalFiles, name), {
                            recursive: true,
                            force: true,
                        });
                    for (const name of parkedNames)
                        await fs.promises.rename(
                            path.join(parked, name),
                            path.join(originalFiles, name),
                        );
                    await this.engine.setConfig(source.owner, originalConfig);
                    rolledBack = true;
                },
            );
        } catch (err) {
            if (rolledBack || (!parkedNames.length && !installedNames.length)) {
                await fs.promises.rm(parked, { recursive: true });
                throw err;
            }
            throw new Error(
                `The backup restore failed (${err instanceof Error ? err.message : String(err)}). Recovery is incomplete; parked files are kept at ${parked}`,
                { cause: err },
            );
        }
        await fs.promises.rm(parked, { recursive: true });
    }
}
