// Package recipes: how a vendor's own release becomes a package on the
// user's computer, for builds Paperboard does not host. A recipe is data,
// never a script: one of a fixed set of unpack steps, then a list of moves
// from the unpacked tree into the package dir. The daemon runs it after
// the archive's sha256 has been checked, and the release signature covers
// the recipe as well as the archive, so a registry cannot swap the steps.
//
//   { "unpack": "dmg", "take": { "bin/Helium.app": "Helium.app" } }
//
// Origami writes recipes (apps/origami/scripts/lib/records.ts validates
// them with parsePackageRecipe); papercrane/engineArchives.ts runs them.
import crypto from "crypto";

/**
 * - zip: the bundled unzip
 * - tar: the bundled tar reader (plain, gzip or zstd, told apart by the bytes)
 * - tar.xz: the system's xz decompresses, the bundled reader extracts
 * - dmg: macOS only; hdiutil mounts the image read-only and ditto copies out
 */
export const RECIPE_UNPACKS = ["zip", "tar", "tar.xz", "dmg"] as const;
export type RecipeUnpack = (typeof RECIPE_UNPACKS)[number];

export interface PackageRecipe {
    unpack: RecipeUnpack;
    /** package path ← path in the unpacked tree, both relative */
    take: Record<string, string>;
}

const MAX_TAKES = 16;
const MAX_PATH = 200;
const SEGMENT_RE = /^[A-Za-z0-9 _+.,@()-]+$/;

function checkPath(value: unknown, what: string): string {
    if (typeof value !== "string" || !value || value.length > MAX_PATH) {
        throw new Error(`Package recipe ${what} must be a short relative path: ${JSON.stringify(value)}`);
    }
    for (const segment of value.split("/")) {
        if (!SEGMENT_RE.test(segment) || segment === "." || segment === "..") {
            throw new Error(`Package recipe ${what} is not a plain relative path: ${JSON.stringify(value)}`);
        }
    }
    return value;
}

// A recipe this daemon cannot follow exactly is refused, never guessed.
export function parsePackageRecipe(value: unknown): PackageRecipe {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Package recipe must be an object: ${JSON.stringify(value)}`);
    }
    const { unpack, take, ...rest } = value as Record<string, unknown>;
    const extra = Object.keys(rest);
    if (extra.length) throw new Error(`Package recipe has unknown fields: ${extra.join(", ")}`);
    if (typeof unpack !== "string" || !(RECIPE_UNPACKS as readonly string[]).includes(unpack)) {
        throw new Error(`Unsupported package recipe unpack ${JSON.stringify(unpack)}`);
    }
    if (!take || typeof take !== "object" || Array.isArray(take)) {
        throw new Error("Package recipe needs a take map");
    }
    const entries = Object.entries(take as Record<string, unknown>);
    if (entries.length === 0 || entries.length > MAX_TAKES) {
        throw new Error(`Package recipe takes 1 to ${MAX_TAKES} paths, not ${entries.length}`);
    }
    const out: Record<string, string> = {};
    for (const [dest, source] of entries) {
        out[checkPath(dest, "destination")] = checkPath(source, "source");
    }
    const dests = Object.keys(out);
    for (const a of dests) {
        for (const b of dests) {
            if (a !== b && b.startsWith(`${a}/`)) throw new Error(`Package recipe destinations overlap: ${a} and ${b}`);
        }
    }
    if (!dests.some((d) => d === "bin" || d.startsWith("bin/"))) {
        throw new Error("Package recipe must put something in bin/");
    }
    return { unpack: unpack as RecipeUnpack, take: out };
}

/** sha256 over the recipe's canonical form: the field the release signature covers */
export function recipeDigest(recipe: PackageRecipe): string {
    const take = Object.entries(recipe.take).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return crypto.createHash("sha256").update(JSON.stringify([recipe.unpack, take])).digest("hex");
}

/** refused before any download: an unpack step this computer cannot run */
export function assertRecipeRunsHere(recipe: PackageRecipe, platform: NodeJS.Platform = process.platform): void {
    if (recipe.unpack === "dmg" && platform !== "darwin") {
        throw new Error("This package unpacks a macOS disk image, which only macOS can open");
    }
}
