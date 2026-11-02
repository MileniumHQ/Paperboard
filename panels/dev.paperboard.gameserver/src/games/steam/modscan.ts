// Steam Workshop metadata through Paperboard's modscan service
// (apps/panelapis). The Steam Web API key stays in that Worker; the panel
// sends only a game slug and a query. Metadata only: mod files come from
// SteamCMD. Answers are checked here, and every failure carries modscan's
// own message so the tab can show it.

export const MODSCAN_URL = "https://panels.ariapis.com/modscan/v1";
export type ModscanGame = "tmodloader" | "tf2";
export type ModscanSort = "relevance" | "subscriptions" | "updated";

export interface WorkshopItem {
    id: string;
    title: string;
    description: string;
    previewImageUrl: string | null;
    tags: string[];
    authorId: string;
    subscriptions: number | null;
    favorites: number | null;
    /** Unix seconds */
    timeUpdated: number;
    fileSize: number;
    /** required Workshop items; null when Steam did not say */
    children: string[] | null;
    workshopUrl: string;
}

/** Valve's attribution and disclaimers; shown wherever results are. */
export interface WorkshopMeta {
    attribution: string;
    source: string;
    legal: string;
    disclaimer: string;
}

export interface WorkshopPage {
    items: WorkshopItem[];
    total: number | null;
    meta: WorkshopMeta;
}

const ID = /^[1-9]\d{0,19}$/;

function fail(message: string): never {
    throw new Error(`Steam Workshop answered with data Paperboard can't read: ${message}`);
}
const str = (v: unknown, what: string): string => (typeof v === "string" ? v : fail(`${what} is not text`));
const count = (v: unknown, what: string): number | null =>
    v === null ? null : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail(`${what} is not a count`);

function item(raw: unknown): WorkshopItem {
    if (!raw || typeof raw !== "object") fail("an item is not an object");
    const v = raw as Record<string, unknown>;
    const id = str(v.id, "id");
    if (!ID.test(id)) fail(`item id ${id}`);
    const children = v.children === null ? null : Array.isArray(v.children) ? v.children.map(c => { const child = str(c, "dependency id"); if (!ID.test(child)) fail(`dependency id ${child}`); return child; }) : fail("dependencies are not a list");
    const preview = v.previewImageUrl === null ? null : str(v.previewImageUrl, "preview");
    if (preview !== null && !preview.startsWith("https://")) fail("preview is not an HTTPS address");
    const url = str(v.workshopUrl, "Workshop address");
    if (!url.startsWith("https://steamcommunity.com/")) fail("Workshop address is not on steamcommunity.com");
    return {
        id, title: str(v.title, "title"), description: str(v.description, "description"), previewImageUrl: preview,
        tags: Array.isArray(v.tags) ? v.tags.map(t => str(t, "tag")) : fail("tags are not a list"),
        authorId: str(v.authorId, "author"), subscriptions: count(v.subscriptions, "subscriptions"), favorites: count(v.favorites, "favorites"),
        timeUpdated: count(v.timeUpdated, "update time") ?? fail("update time is missing"), fileSize: count(v.fileSize, "size") ?? fail("size is missing"),
        children, workshopUrl: url,
    };
}

async function call(base: string, path: string, signal?: AbortSignal): Promise<WorkshopPage> {
    let response: Response;
    try {
        response = await fetch(`${base}${path}`, { signal: signal ?? AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
    } catch (err) {
        if (signal?.aborted) throw err;
        throw new Error(`Couldn't reach Steam Workshop search: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await response.text();
    let body: any;
    try { body = JSON.parse(text); } catch { throw new Error(`Steam Workshop search answered HTTP ${response.status} without JSON`); }
    if (!response.ok) {
        const message = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
        throw new Error(`Steam Workshop search failed: ${message}`);
    }
    if (!body || !Array.isArray(body.items)) fail("no item list");
    const meta = body.meta ?? fail("no attribution");
    return {
        items: body.items.map(item),
        total: body.total === null ? null : count(body.total, "total"),
        meta: { attribution: str(meta.attribution, "attribution"), source: str(meta.source, "source"), legal: str(meta.legal, "legal notice"), disclaimer: str(meta.disclaimer, "disclaimer") },
    };
}

export function searchWorkshop(game: ModscanGame, query: string, options: { page?: number; sort?: ModscanSort; base?: string; signal?: AbortSignal } = {}): Promise<WorkshopPage> {
    const params = new URLSearchParams({ q: query.trim().slice(0, 200), page: String(options.page ?? 1), sort: options.sort ?? "relevance" });
    return call(options.base ?? MODSCAN_URL, `/${game}/search?${params}`, options.signal);
}

/** At most 20 per request, as modscan takes them; more are asked in turns. */
export async function workshopItems(game: ModscanGame, ids: readonly string[], options: { base?: string } = {}): Promise<WorkshopPage> {
    const unique = [...new Set(ids)];
    for (const id of unique) if (!ID.test(id)) throw new Error(`Not a Workshop item id: ${id}`);
    if (unique.length === 0) throw new Error("Choose Workshop items to look up");
    const pages: WorkshopPage[] = [];
    for (let i = 0; i < unique.length; i += 20) pages.push(await call(options.base ?? MODSCAN_URL, `/${game}/items?ids=${unique.slice(i, i + 20).join(",")}`));
    return { items: pages.flatMap(p => p.items), total: null, meta: pages[0]!.meta };
}
