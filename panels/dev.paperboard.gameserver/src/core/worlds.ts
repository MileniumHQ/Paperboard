import { trashRemovePathsWith, type TrashRemoveDeps } from "./trash";

export const WORLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// shell-safe level names for DELETION: single-quoteable on posix (only '
// is unsafe there) and double-quoteable on Windows (only " and % are
// unsafe there — cmd expands %VAR% inside quotes). Creation stays on the
// stricter WORLD_NAME_PATTERN; an exotic-but-valid level-name refuses
// loudly instead of deleting the wrong directory.
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

// names reach shell commands, so stricter than the entry pattern
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

export interface WorldDeleteDeps extends TrashRemoveDeps {}

// deletes <level>, <level>_nether and <level>_the_end via a short-lived
// pty — trash first, then remove (see core/trash.ts), never a bare rm
export async function deleteWorldDirs(
    levelName: string,
    deps: WorldDeleteDeps,
): Promise<void> {
    const dirs = getWorldDirsToDelete(levelName);
    await trashRemovePathsWith(deps, dirs, "delete-world-pty");
}

// ─── World manager model ─────────────────────────────────────────────
// Pure data + decisions for the Worlds tab. IO (exists checks,
// server.properties reads) lives in service/worlds.ts; the component
// renders WorldInfo[] and calls back with validated names.

export interface WorldInfo {
    name: string;
    active: boolean;
    // level.dat present on disk. A configured-but-never-started world is
    // listed with generated=false instead of being hidden.
    generated: boolean;
    hasNether: boolean;
    hasEnd: boolean;
}

export interface WorldCandidate {
    name: string;
    generated: boolean;
}

// creation names must survive as fresh directories AND future shell
// commands, so creation stays on the strict pattern (no spaces, no dots,
// no leading dash). Switching to an existing directory only needs the
// shell-safe check — a world created elsewhere may contain spaces.
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

// one decision point for "make this world active": already active is a
// noop (no restart prompt), an existing directory is a switch, anything
// else is a fresh generation on next boot. Case-insensitive — the server
// resolves level-name against a case-insensitive filesystem on some
// platforms, so "World" vs "world" must not fork two generations.
export function planWorldActivation(
    requested: string,
    existing: string[],
    active: string,
): ActivationPlan {
    const name = String(requested ?? "").trim();
    if (!name) throw new Error("World name is required");
    const lower = name.toLowerCase();
    if (lower === active.toLowerCase()) return { kind: "noop-active", name };
    const match = existing.find((e) => e.toLowerCase() === lower);
    if (match) return { kind: "switch", name: match };
    return { kind: "create", name: assertCreatableWorldName(name) };
}

// merges on-disk worlds with the active level-name into renderable cards.
// A configured world that has not generated yet (no directory / no
// level.dat) still appears, flagged generated:false, so "I made a world
// and nothing showed up" cannot happen. Active sorts first, then
// alphabetically.
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
    const activeKey = active.toLowerCase();
    if (active && !seen.has(activeKey)) {
        infos.push({
            name: active,
            active: true,
            generated: false,
            hasNether: false,
            hasEnd: false,
        });
    }
    return infos.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}
