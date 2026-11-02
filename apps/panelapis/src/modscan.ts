export interface Env {
  STEAM_WEB_API_KEY?: string;
  CLIENT_LIMIT: RateLimit;
  BUDGET: DurableObjectNamespace;
}

export const GAMES = { tmodloader: 1281930, garrysmod: 4000, tf2: 440, cs2: 730, palworld: 1623730 } as const;
// What a search is for, where a game's Workshop holds more than its mods. Valve's
// QueryFiles `filetype` (EPublishedFileInfoMatchingFileType) 18 is "ready to use"
// items, the Workshop's own section for Team Fortress 2 maps; without it a search
// also returns the game's cosmetic submissions, guides, art and videos, which
// the Game Server panel only throws away again. Other games search everything.
const SEARCH_FILETYPE: Partial<Record<keyof typeof GAMES, number>> = { tf2: 18 };
const SORTS = { relevance: 12, subscriptions: 9, updated: 19 } as const;
const META = {
  attribution: "Powered by Steam",
  source: "https://store.steampowered.com/",
  legal: "©2026 Valve Corporation. Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries.",
  disclaimer: "Paperboard is not endorsed by or affiliated with Valve or Steam. Steam Data is provided as is, with all faults and as available, without warranties of accuracy, availability, merchantability, fitness or non-infringement. To the extent permitted by law, Valve and its suppliers are not liable for damages arising from its use.",
};
class Failure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const bad = () => new Failure(400, "invalid_request", "Invalid or unsupported request parameters.");
const malformed = () => new Failure(502, "steam_schema", "Steam returned invalid Workshop data.");
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw malformed();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw malformed(); return value; }
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) throw malformed();
  return value;
}
function number(value: unknown): number {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw malformed();
  return n;
}
function text(value: unknown, max: number): string { if (typeof value !== "string") throw malformed(); return value.slice(0, max); }
export interface Item {
  id: string; title: string; description: string; previewImageUrl: string | null;
  tags: string[]; authorId: string; subscriptions: number | null; favorites: number | null;
  timeUpdated: number; fileSize: number; children: string[] | null; workshopUrl: string;
}
// Some items (videos, art) carry no tags, and Steam may leave out an empty list rather than send [].
function tags(value: unknown): string[] { return value === undefined ? [] : array(value).slice(0, 100).map(t => text(record(t).tag, 100)); }
function children(value: unknown): string[] { return array(value).map(v => id(record(v).publishedfileid)); }
// Both IPublishedFileService methods report the game as `consumer_appid`.
function item(value: unknown, appid: number): Item {
  const v = record(value);
  if (number(v.result) !== 1) throw new Failure(404, "item_unavailable", "A requested Workshop item is unavailable.");
  if (number(v.consumer_appid) !== appid) throw new Failure(404, "wrong_game", "Workshop item does not belong to this game.");
  if (number(v.visibility) !== 0) throw new Failure(404, "item_not_public", "Only public Workshop items are available.");
  const itemId = id(v.publishedfileid);
  let preview: string | null = null;
  if (v.preview_url !== undefined && v.preview_url !== "") {
    const raw = text(v.preview_url, 2048);
    let url: URL;
    try { url = new URL(raw); } catch { throw malformed(); }
    if (url.protocol !== "https:" || url.username || url.password) throw malformed();
    preview = url.href;
  }
  return {
    id: itemId, title: text(v.title, 256), description: text(v.short_description ?? v.description, 500),
    previewImageUrl: preview, tags: tags(v.tags),
    authorId: id(v.creator), subscriptions: v.subscriptions === undefined ? null : number(v.subscriptions),
    favorites: v.favorited === undefined ? null : number(v.favorited), timeUpdated: number(v.time_updated),
    fileSize: number(v.file_size), children: v.children === undefined ? null : children(v.children),
    workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${itemId}`,
  };
}

// A single durable, transactional counter shared by every isolate and game.
// Retain the current hour plus the previous 24: conservatively covers any rolling 24h.
export class SteamBudget {
  constructor(private readonly state: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/reserve") return json({ error: "Unknown budget operation" }, 404);
    const hour = Math.floor(Date.now() / 3_600_000);
    const allowed = await this.state.storage.transaction(async tx => {
      const buckets = (await tx.get<[number, number][]>("hours") ?? []).filter(([h]) => h >= hour - 24);
      if (buckets.reduce((sum, [, n]) => sum + n, 0) >= 90_000) return false;
      const current = buckets.find(([h]) => h === hour);
      if (current) current[1]++; else buckets.push([hour, 1]);
      await tx.put("hours", buckets);
      return true;
    });
    return json({ allowed }, allowed ? 200 : 429);
  }
}

async function steam(env: Env, method: "search" | "items" | "collection", params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const budget = await env.BUDGET.get(env.BUDGET.idFromName("steam-key-budget-v1")).fetch("https://budget/reserve", { method: "POST" });
  if (budget.status === 429) throw new Failure(429, "steam_budget", "Steam API budget exhausted. Try again after earlier calls expire from the 24-hour window.");
  if (!budget.ok) throw new Failure(503, "budget_unavailable", "Steam API budget guard is unavailable.");
  // QueryFiles and GetDetails take the key and input_json; collections are a keyless POST form
  const url = new URL(method === "search"
    ? "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/"
    : method === "items" ? "https://api.steampowered.com/IPublishedFileService/GetDetails/v1/"
    : "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/");
  let init: RequestInit = { redirect: "manual", signal: AbortSignal.timeout(10_000) };
  if (method !== "collection") {
    url.searchParams.set("key", env.STEAM_WEB_API_KEY!);
    url.searchParams.set("input_json", JSON.stringify(params));
  } else {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) form.set(k, String(v));
    init = { ...init, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() };
  }
  let response: Response;
  try { response = await fetch(url, init); } catch { throw new Failure(502, "steam_unreachable", "Steam request failed or timed out."); }
  if (!response.ok) throw new Failure(response.status === 429 ? 429 : 502, "steam_http", `Steam API returned HTTP ${response.status}.`);
  // Bound response size, and never return or log upstream bodies or exceptions.
  const reader = response.body?.getReader();
  if (!reader) throw malformed();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 2_000_000) { await reader.cancel(); throw malformed(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const raw = new TextDecoder().decode(bytes);
  if (raw.includes(env.STEAM_WEB_API_KEY!)) throw malformed();
  try { return record(JSON.parse(raw)); } catch { throw malformed(); }
}
function collectionParams(ids: string[]) {
  const params: Record<string, unknown> = { collectioncount: ids.length };
  ids.forEach((v, i) => { params[`publishedfileids[${i}]`] = v; }); return params;
}

export const modscan = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method !== "GET") return json({ error: { code: "method_not_allowed", message: "Only GET is supported." } }, 405, { Allow: "GET" });
      const url = new URL(request.url);
      if (url.href.length > 4096) throw bad();
      const match = /^\/modscan\/v1\/([a-z0-9]+)\/(search|items|collections\/([1-9]\d{0,19}))$/.exec(url.pathname);
      if (!match || !Object.hasOwn(GAMES, match[1]!)) throw new Failure(404, "not_found", "Unknown Modscan game or endpoint.");
      const game = match[1] as keyof typeof GAMES;
      const appid = GAMES[game];
      const mode = match[2]!;
      const allowed = mode === "search" ? ["q", "page", "sort"] : mode === "items" ? ["ids"] : [];
      for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw bad();
      let ids: string[] = [];
      let query = "", page = 1, sort: keyof typeof SORTS = "relevance";
      if (mode === "search") {
        query = (url.searchParams.get("q") ?? "").trim();
        const rawPage = url.searchParams.get("page") ?? "1";
        const rawSort = url.searchParams.get("sort") ?? "relevance";
        if (query.length > 200 || /[\x00-\x1f\x7f]/.test(query) || !/^[1-9]\d{0,3}$/.test(rawPage) || Number(rawPage) > 1000 || !Object.hasOwn(SORTS, rawSort)) throw bad();
        page = Number(rawPage); sort = rawSort as keyof typeof SORTS;
      } else {
        ids = mode === "items" ? (url.searchParams.get("ids") ?? "").split(",") : [match[3]!];
        if (ids.length > 20 || new Set(ids).size !== ids.length) throw bad();
        try { ids.forEach(id); } catch { throw bad(); }
      }
      if (!env.STEAM_WEB_API_KEY?.trim()) throw new Failure(503, "missing_secret", "Modscan is not configured: STEAM_WEB_API_KEY is missing.");
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip) throw new Failure(503, "missing_client_ip", "Client IP is unavailable for rate limiting.");
      if (!(await env.CLIENT_LIMIT.limit({ key: ip })).success) throw new Failure(429, "client_rate_limit", "Client rate limit exceeded. Try again in one minute.");
      // Canonical cache keys contain only validated values, never the secret or client IP.
      const cacheKey = new Request(`https://panels.ariapis.com/modscan/cache/v1/${match[1]}/${mode === "search" ? `search?q=${encodeURIComponent(query)}&page=${page}&sort=${sort}` : `${mode === "items" ? "items" : "collection"}?ids=${ids.join(",")}`}`);
      const cache = await caches.open("modscan-v1");
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      let items: Item[]; let total: number | null = null;
      if (mode === "search") {
        const result = record((await steam(env, "search", { appid, search_text: query, page, query_type: SORTS[sort], numperpage: 20, return_tags: true, return_children: true, return_short_description: true, ...(SEARCH_FILETYPE[game] === undefined ? {} : { filetype: SEARCH_FILETYPE[game] }) })).response);
        if (result.result !== undefined && number(result.result) !== 1) throw malformed();
        items = array(result.publishedfiledetails).map(v => item(v, appid)); total = number(result.total);
      } else {
        // GetDetails, unlike ISteamRemoteStorage's details, says what each item requires
        const result = record((await steam(env, "items", { publishedfileids: ids, includetags: true, includechildren: true, short_description: true })).response);
        items = array(result.publishedfiledetails).map(v => item(v, appid));
        if (items.length !== ids.length || items.some(v => !ids.includes(v.id)) || new Set(items.map(v => v.id)).size !== ids.length) throw malformed();
        if (mode !== "items") {
          const result = record((await steam(env, "collection", collectionParams(ids))).response);
          const details = array(result.collectiondetails);
          if (details.length !== 1) throw malformed();
          const collection = record(details[0]);
          if (id(collection.publishedfileid) !== ids[0] || number(collection.result) !== 1) throw new Failure(404, "collection_unavailable", "Workshop collection is unavailable.");
          items[0]!.children = children(collection.children);
        }
      }
      const response = json({ items, total, meta: META }, 200, { "Cache-Control": `public, max-age=${mode === "search" ? 60 : 300}` });
      if ((await response.clone().text()).includes(env.STEAM_WEB_API_KEY)) throw malformed();
      await cache.put(cacheKey, response.clone());
      return response;
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure(503, "service_unavailable", "Modscan could not complete the request: an upstream, cache or binding operation failed.");
      return json({ error: { code: failure.code, message: failure.message } }, failure.status);
    }
  },
} satisfies ExportedHandler<Env>;
