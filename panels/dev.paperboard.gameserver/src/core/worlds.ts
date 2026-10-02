export const WORLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// level names a world may be DELETED or switched by: one plain path
// segment (deletion is a rename inside the server folder, service/trash.ts).
// Creation stays on the stricter WORLD_NAME_PATTERN; an exotic-but-valid
// level-name refuses loudly instead of deleting the wrong directory.
export const SHELL_SAFE_LEVEL_NAME = /^[A-Za-z0-9][A-Za-z0-9 _().-]{0,63}$/;

export function assertShellSafeLevelName(levelName: unknown): string {
    const safe = String(levelName ?? "").trim();
    if (
        !SHELL_SAFE_LEVEL_NAME.test(safe) ||
        safe.includes("..") ||
        safe.includes("/") ||
        safe.includes("\\")
    ) {
        throw new Error(`Refusing to delete unsafe world name: ${JSON.stringify(levelName)}`);
    }
    return safe;
}

// one level name becomes three server-folder paths, so it is checked here
export function getWorldDirsToDelete(levelName: string): string[] {
    const safe = assertShellSafeLevelName(levelName);
    return [safe, `${safe}_nether`, `${safe}_the_end`];
}

export interface WorldListDeps {
    entries: string[];
    sanitize: (name: string) => string | null;
    exists: (path: string) => Promise<boolean>;
    onError?: (filename: string, err: unknown) => void;
}

// a directory is a world if it contains level.dat
export async function collectWorldDirs(deps: WorldListDeps): Promise<string[]> {
    const { entries, sanitize, exists, onError } = deps;
    const worlds: string[] = [];
    for (const entry of entries) {
        const safe = sanitize(entry);
        if (!safe) continue;
        try {
            if (await exists(`${safe}/level.dat`)) {
                worlds.push(safe);
            }
        } catch (err) {
            onError?.(safe, err);
        }
    }
    return worlds.sort((a, b) => a.localeCompare(b));
}

// ─── World manager model ─────────────────────────────────────────────
// Pure data + decisions for the Worlds tab. IO (exists checks,
// server.properties reads) lives in service/worlds.ts; the component
// renders WorldInfo[] and calls back with validated names.

export interface WorldInfo {
    name: string;
    active: boolean;
    // level.dat present on disk. A created-but-never-started world is
    // listed with generated=false instead of being hidden.
    generated: boolean;
    hasNether: boolean;
    hasEnd: boolean;
}

export interface WorldCandidate {
    name: string;
    generated: boolean;
}

// creation names become fresh directories on every OS, so creation stays
// on the strict pattern (no spaces, no dots, no leading dash). Switching to
// an existing directory only needs the level-name check — a world created
// elsewhere may contain spaces.
export function assertCreatableWorldName(name: unknown): string {
    const clean = String(name ?? "").trim();
    if (!WORLD_NAME_PATTERN.test(clean)) {
        throw new Error(
            `Refusing to create world with unsafe name: ${JSON.stringify(name)}`,
        );
    }
    return clean;
}

export type ActivationKind = "noop-active" | "switch" | "create";

export interface ActivationPlan {
    kind: ActivationKind;
    name: string;
}

// case-insensitive duplicate check shared by the New World dialog and any
// future caller: the server may treat level-name case-insensitively, so
// "World" vs "world" must not create a second world.
export function isWorldNameTaken(names: string[], proposed: string): boolean {
    const clean = String(proposed ?? "").trim().toLowerCase();
    if (!clean) return false;
    return names.some((name) => name.toLowerCase() === clean);
}

// one decision point for "make this world active": the active world on
// disk is a noop (no restart prompt), an existing directory is a switch,
// anything else is a fresh generation on next boot. The configured
// level-name with no directory (fresh server, or its world was deleted)
// is a create too: its seed must apply and it must be remembered as a
// created world, not silently dropped as a noop. Case-insensitive — the
// server resolves level-name against a case-insensitive filesystem on some
// platforms, so "World" vs "world" must not fork two generations.
export function planWorldActivation(
    requested: string,
    existing: string[],
    active: string,
): ActivationPlan {
    const name = String(requested ?? "").trim();
    if (!name) throw new Error("World name is required");
    const lower = name.toLowerCase();
    const match = existing.find((e) => e.toLowerCase() === lower);
    if (match && lower === active.toLowerCase()) return { kind: "noop-active", name: match };
    if (match) return { kind: "switch", name: match };
    return { kind: "create", name: assertCreatableWorldName(name) };
}

// merges on-disk worlds and created-but-ungenerated worlds into renderable
// cards, flagging the one matching the active level-name. The level-name
// alone does not make a card: after its directories are deleted it names
// nothing, and listing it kept a deleted world on screen until the user
// switched away. Created worlds come in as candidates (generated:false),
// so "I made a world and nothing showed up" still cannot happen. Active
// sorts first, then alphabetically.
export function buildWorldInfos(
    candidates: WorldCandidate[],
    active: string,
): WorldInfo[] {
    const seen = new Set<string>();
    const infos: WorldInfo[] = [];
    for (const candidate of candidates) {
        const key = candidate.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        infos.push({
            name: candidate.name,
            active: key === active.toLowerCase(),
            generated: candidate.generated,
            hasNether: false,
            hasEnd: false,
        });
    }
    return infos.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}
