// The shipped model catalog (src/data/models.json): local Ollama library
// models with their makers, capabilities and per-tag download sizes.
// Cloud-only models are not in it; the file is curated by hand. Each entry
// also carries the library's "updated" date so the default sort can weigh
// recency against downloads.

export interface CatalogTag {
    tag: string; // "8b", "latest"
    bytes: number; // download size
    context: number; // max context window
}

export interface CatalogModel {
    name: string;
    maker: string;
    description: string;
    capabilities: string[]; // tools, vision, thinking, audio
    /** the library's "updated" date (YYYY-MM-DD), when the scrape saw one */
    updatedAt?: string;
    pulls: number;
    tags: CatalogTag[];
}

export interface CatalogMaker {
    name: string;
    icon: string | null;
}

export interface Catalog {
    schemaVersion: 1;
    makers: Record<string, CatalogMaker>;
    models: CatalogModel[];
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Validates the catalog file; a malformed entry is a build-time defect. */
export function parseCatalog(raw: unknown): Catalog {
    const data = raw as Partial<Catalog>;
    if (!data || data.schemaVersion !== 1 || typeof data.makers !== "object" || !Array.isArray(data.models)) {
        throw new Error("model catalog: unsupported shape");
    }
    for (const m of data.models) {
        if (!NAME_RE.test(m.name)) throw new Error(`model catalog: bad name ${JSON.stringify(m.name)}`);
        if (!data.makers[m.maker]) throw new Error(`model catalog: ${m.name} has unknown maker ${m.maker}`);
        if (m.updatedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(m.updatedAt)) {
            throw new Error(`model catalog: ${m.name} has malformed updatedAt`);
        }
        if (!Array.isArray(m.tags) || m.tags.length === 0) throw new Error(`model catalog: ${m.name} has no tags`);
        for (const t of m.tags) {
            if (!TAG_RE.test(t.tag) || !(t.bytes > 0) || !(t.context > 0)) {
                throw new Error(`model catalog: ${m.name}:${t.tag} is malformed`);
            }
        }
    }
    return data as Catalog;
}

export type CatalogSort = "newest" | "downloads";

export interface CatalogQuery {
    text?: string;
    toolsOnly?: boolean;
    capability?: string;
    /** newest first unless asked otherwise */
    sort?: CatalogSort;
}

export function searchCatalog(catalog: Catalog, query: CatalogQuery): CatalogModel[] {
    const text = query.text?.trim().toLowerCase() ?? "";
    const list = catalog.models.filter((m) => {
        if (query.toolsOnly && !m.capabilities.includes("tools")) return false;
        if (query.capability && !m.capabilities.includes(query.capability)) return false;
        if (!text) return true;
        const maker = catalog.makers[m.maker]?.name.toLowerCase() ?? "";
        return m.name.includes(text) || maker.includes(text) || m.description.toLowerCase().includes(text);
    });
    const byDownloads = (a: CatalogModel, b: CatalogModel) => b.pulls - a.pulls || a.name.localeCompare(b.name);
    if (query.sort === "downloads") return [...list].sort(byDownloads);
    // an unknown date is not "new"; it sorts behind everything dated
    return [...list].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || byDownloads(a, b));
}

/** "qwen3" + "8b" → "qwen3:8b"; the "latest" tag is Ollama's default name. */
export function modelRef(name: string, tag: string): string {
    return `${name}:${tag}`;
}

/** Splits "qwen3:8b" / "qwen3" into name and tag (default "latest"). */
export function splitModelRef(ref: string): { name: string; tag: string } {
    const i = ref.lastIndexOf(":");
    if (i <= 0) return { name: ref, tag: "latest" };
    return { name: ref.slice(0, i), tag: ref.slice(i + 1) };
}

export function findCatalogTag(catalog: Catalog, ref: string): { model: CatalogModel; tag: CatalogTag } | null {
    const { name, tag } = splitModelRef(ref);
    const model = catalog.models.find((m) => m.name === name);
    const found = model?.tags.find((t) => t.tag === tag);
    return model && found ? { model, tag: found } : null;
}

// Ollama model references: library names, optional namespace, optional tag.
// Hosts (hf.co/...) are refused: the panel pulls from the Ollama library.
const REF_RE = /^(?:[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,79}(?::[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})?$/;

export function isValidModelRef(ref: string): boolean {
    return REF_RE.test(ref) && !ref.includes("..");
}
