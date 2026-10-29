import { apiFetch } from "./userAgent";
import { MODRINTH_API } from "../core/modrinth";

// The page's side of Modrinth: search runs here (the service never needs it),
// and every browser tab shares this one request and card parser.

export const SEARCH_LIMIT = 24;

export interface ModrinthHit {
    projectId: string;
    slug: string;
    title: string;
    description: string;
    downloads: number;
    follows: number;
    iconUrl?: string;
}

export interface RawHit {
    project_id?: string;
    slug?: string;
    title?: string;
    description?: string;
    downloads?: number;
    follows?: number;
    icon_url?: string;
}

// text first so non-JSON answers fail with a clear message
export async function modrinthFetch<T>(
    path: string,
    params?: Record<string, string>,
    signal?: AbortSignal,
): Promise<T> {
    const query = params
        ? `?${new URLSearchParams(params).toString()}`
        : "";
    const res = await apiFetch(`${MODRINTH_API}${path}${query}`, {
        signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
    });
    const text = await res.text();

    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `Modrinth returned a non-JSON response (HTTP ${res.status})`,
        );
    }

    if (!res.ok) {
        const description =
            typeof data === "object" &&
            data !== null &&
            "description" in data &&
            typeof (data as { description: unknown }).description === "string"
                ? (data as { description: string }).description
                : `HTTP ${res.status}`;
        throw new Error(`Modrinth request failed: ${description}`);
    }

    return data as T;
}

/** a Modrinth search page as cards; hits missing an id, slug or title are dropped */
export function parseSearchHits(raw: RawHit[] | undefined): ModrinthHit[] {
    const hits: ModrinthHit[] = [];
    for (const hit of (raw ?? []).slice(0, SEARCH_LIMIT)) {
        if (!hit.project_id || !hit.slug || !hit.title) continue;
        hits.push({
            projectId: hit.project_id,
            slug: hit.slug,
            title: hit.title,
            description: hit.description ?? "",
            downloads: typeof hit.downloads === "number" ? hit.downloads : 0,
            follows: typeof hit.follows === "number" ? hit.follows : 0,
            iconUrl: hit.icon_url || undefined,
        });
    }
    return hits;
}


/**
 * One page of Modrinth search results for the given facets (a list of
 * AND-ed groups, each an OR of "field:value"). An empty query browses by
 * downloads; a typed one ranks by relevance. `keep` drops hits the facets
 * let through that the caller cannot use.
 */
export async function searchProjects(opts: {
    query: string;
    facets: string[][];
    signal?: AbortSignal;
    keep?: (hit: RawHit & { server_side?: string }) => boolean;
}): Promise<ModrinthHit[]> {
    const data = await modrinthFetch<{ hits?: (RawHit & { server_side?: string })[] }>(
        "/search",
        {
            query: opts.query,
            limit: String(SEARCH_LIMIT),
            facets: JSON.stringify(opts.facets),
            index: opts.query ? "relevance" : "downloads",
        },
        opts.signal,
    );
    return parseSearchHits(opts.keep ? data.hits?.filter(opts.keep) : data.hits);
}

export interface ModrinthProject {
    projectId: string;
    slug: string;
    title: string;
    description: string;
    body: string;
    downloads: number;
    follows: number;
    loaders: string[];
    license: string;
    dateModified: string;
    iconUrl?: string;
}

export interface RawProject {
    id?: string;
    slug?: string;
    title?: string;
    description?: string;
    body?: string;
    downloads?: number;
    followers?: number;
    loaders?: string[];
    license?: { id?: string; name?: string; url?: string };
    updated?: string;
    icon_url?: string;
}


export async function getProject(projectIdOrSlug: string): Promise<ModrinthProject> {
    const data = await modrinthFetch<RawProject>(
        `/project/${encodeURIComponent(projectIdOrSlug)}`,
    );
    if (!data.id || !data.slug || !data.title) {
        throw new Error("Modrinth returned an incomplete project");
    }
    const licenseName =
        data.license?.name ||
        (data.license?.id ? data.license.id.toUpperCase() : undefined) ||
        data.license?.url ||
        "Unknown";
    return {
        projectId: data.id,
        slug: data.slug,
        title: data.title,
        description: data.description ?? "",
        body: data.body ?? "",
        downloads: typeof data.downloads === "number" ? data.downloads : 0,
        follows: typeof data.followers === "number" ? data.followers : 0,
        loaders: Array.isArray(data.loaders) ? data.loaders : [],
        license: licenseName,
        dateModified: data.updated ?? "",
        iconUrl: data.icon_url || undefined,
    };
}
