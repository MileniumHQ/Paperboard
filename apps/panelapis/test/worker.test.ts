import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from "miniflare";

const SECRET = "test-only-steam-key-never-real";
const fixture = {
  result: 1, visibility: 0, publishedfileid: "123", consumer_app_id: 4000,
  title: "A Workshop item", description: "Description", preview_url: "https://images.steamusercontent.com/example.jpg",
  creator: "76561198000000000", tags: [{ tag: "Build" }], subscriptions: 42,
  favorited: 8, time_updated: 1700000000, file_size: "2048", children: [{ publishedfileid: "456" }],
  file_url: "https://do-not-return.invalid/file", private_field: "must not pass through",
};
// IPublishedFileService/QueryFiles names fields differently from ISteamRemoteStorage details.
const { consumer_app_id, description, ...shared } = fixture;
const queryFixture = { ...shared, consumer_appid: consumer_app_id, short_description: "Short description" };
let script: string;
beforeAll(async () => {
  const result = await build({ stdin: {
    contents: `import worker, { SteamBudget } from './src/index.ts';
      export default worker;
      export class TestBudget extends SteamBudget {
        constructor(state) { super(state); this.storage = state.storage; }
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === '/seed') { await this.storage.put('hours', await request.json()); return new Response('seeded'); }
          if (path === '/count') return Response.json(await this.storage.get('hours') ?? []);
          return super.fetch(request);
        }
      }`, resolveDir: import.meta.dir + "/..", loader: "ts",
  }, bundle: true, format: "esm", write: false, target: "es2022" });
  script = result.outputFiles[0]!.text;
});
const instances: Miniflare[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(m => m.dispose())); });
async function setup(options: { secret?: string; limit?: number; upstream?: (url: URL, body: string) => unknown; status?: number } = {}) {
  const calls: { url: URL; body: string; method: string }[] = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "panelapis",
    modules: true, script, compatibilityDate: "2026-10-01",
    bindings: { STEAM_WEB_API_KEY: options.secret ?? SECRET },
    durableObjects: { BUDGET: { className: "TestBudget", useSQLite: true } },
    ratelimits: { CLIENT_LIMIT: { namespace_id: "1281930", simple: { limit: options.limit ?? 60, period: 60 } } },
    outboundService: async request => {
      const url = new URL(request.url); const body = await request.text();
      calls.push({ url, body, method: request.method });
      if (url.hostname !== "api.steampowered.com") throw new Error("Unexpected upstream");
      const payload = options.upstream ? options.upstream(url, body) : { response: { total: 1, publishedfiledetails: [url.pathname.includes("QueryFiles") ? queryFixture : fixture] } };
      return new MFResponse(typeof payload === "string" ? payload : JSON.stringify(payload), { status: options.status ?? 200 });
    },
  }] }));
  instances.push(mf);
  const ns = await mf.getDurableObjectNamespace("BUDGET");
  const budget = ns.get(ns.idFromName("steam-key-budget-v1"));
  const worker = await mf.getWorker("panelapis");
  const request = (path: string, method = "GET", ip = "192.0.2.1") => worker.fetch(`https://panels.ariapis.com${path}`, { method, headers: { "CF-Connecting-IP": ip } });
  return { mf, calls, request, budget };
}
const base = "/modscan/v1/garrysmod";
describe("Modscan HTTP boundary in workerd", () => {
  it("routes by first path segment and rejects unknown panel APIs", async () => {
    const { request, calls } = await setup();
    for (const path of ["/", "/other/v1/search", "/constructor", "/v1/garrysmod/search"]) {
      const response = await request(path);
      expect(response.status).toBe(404);
      expect((await response.json() as any).error.code).toBe("not_found");
    }
    expect((await request(`${base}/search`)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });
  it("rejects unknown games, paths, parameters, duplicates, bounds and methods before Steam", async () => {
    const { request, calls } = await setup();
    for (const path of ["/", "/modscan/v1/other/search", `${base}/other`, `${base}/collections/nope`, "/modscan/v1/constructor/search"]) {
      expect((await request(path)).status).toBe(404);
    }
    for (const suffix of ["search?appid=440", "search?key=evil", "search?url=https://evil.invalid", "search?q=a&q=b", "search?sort=constructor", "search?sort=nope", "search?page=0", "search?page=1001", `search?q=${"x".repeat(201)}`, "items", "items?ids=0", "items?ids=18446744073709551616", "items?ids=1,1", `items?ids=${Array.from({ length: 21 }, (_, i) => i + 1).join(",")}`, "collections/123?q=evil"]) {
      expect((await request(`${base}/${suffix}`)).status).toBe(400);
    }
    for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) expect((await request(`${base}/search`, method)).status).toBe(405);
    expect(calls).toHaveLength(0);
  });
  it("constructs only fixed search parameters, reshapes and caches canonical requests", async () => {
    const { request, calls, budget } = await setup();
    const response = await request(`${base}/search?q=hello&page=2&sort=updated`);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    const body = await response.json() as any;
    expect(body.items[0]).toEqual({ id: "123", title: fixture.title, description: queryFixture.short_description, previewImageUrl: fixture.preview_url, tags: ["Build"], authorId: fixture.creator, subscriptions: 42, favorites: 8, timeUpdated: fixture.time_updated, fileSize: 2048, children: ["456"], workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=123" });
    expect(body.meta.attribution).toBe("Powered by Steam");
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(calls[0]!.url.pathname).toBe("/IPublishedFileService/QueryFiles/v1/");
    expect([...calls[0]!.url.searchParams.keys()].sort()).toEqual(["input_json", "key"]);
    expect(JSON.parse(calls[0]!.url.searchParams.get("input_json")!)).toEqual({ appid: 4000, search_text: "hello", page: 2, query_type: 19, numperpage: 20, return_tags: true, return_children: true, return_short_description: true });
    expect((await request(`${base}/search?sort=updated&page=2&q=hello`)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect((await (await budget.fetch("https://budget/count")).json() as number[][])[0]![1]).toBe(1);
  });
  it("uses POST form for item details without forwarding the key or arbitrary data", async () => {
    const { request, calls } = await setup();
    const response = await request(`${base}/items?ids=123`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(calls[0]!.method).toBe("POST");
    expect([...new URLSearchParams(calls[0]!.body)]).toEqual([["itemcount", "1"], ["publishedfileids[0]", "123"]]);
    expect(calls[0]!.url.search).toBe("");
  });
  it("checks collection game via details before fetching collection children", async () => {
    const { request, calls } = await setup({ upstream: url => ({ response: url.pathname.includes("GetCollectionDetails") ? { collectiondetails: [{ result: 1, publishedfileid: "123", children: [{ publishedfileid: "789" }] }] } : { publishedfiledetails: [fixture] } }) });
    const response = await request(`${base}/collections/123`);
    expect(response.status).toBe(200);
    expect((await response.json() as any).items[0].children).toEqual(["789"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toBe("collectioncount=1&publishedfileids%5B0%5D=123");
  });
  it("rejects cross-game items and never requests cross-game collection children", async () => {
    const { request, calls } = await setup({ upstream: () => ({ response: { publishedfiledetails: [{ ...fixture, consumer_app_id: 440 }] } }) });
    expect((await request(`${base}/collections/123`)).status).toBe(404);
    expect(calls).toHaveLength(1);
  });
  it("does not expose private Workshop metadata accessible to the key owner", async () => {
    const { request } = await setup({ upstream: () => ({ response: { publishedfiledetails: [{ ...fixture, visibility: 2 }] } }) });
    const response = await request(`${base}/items?ids=123`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("item_not_public");
  });
  it("never follows redirects or returns their bodies", async () => {
    const { request, calls } = await setup({ status: 302, upstream: () => SECRET });
    const response = await request(`${base}/search`);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(SECRET);
    expect(calls).toHaveLength(1);
  });
  it("uses the real Cache API expiry rather than serving expired entries", async () => {
    const { mf, request, calls } = await setup();
    const cache = await (await mf.getCaches()).open("modscan-v1");
    await cache.put("https://panels.ariapis.com/modscan/cache/v1/garrysmod/search?q=&page=1&sort=relevance", new MFResponse("expired", { headers: { "Cache-Control": "public, max-age=0" } }));
    const response = await request(`${base}/search`);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toBe("expired");
    expect(calls).toHaveLength(1);
  });
  it("maps every allowlisted game to its constant consumer app ID", async () => {
    const games = { tmodloader: 1281930, garrysmod: 4000, tf2: 440, cs2: 730, palworld: 1623730 };
    const { request, calls } = await setup({ upstream: url => {
      const appid = JSON.parse(url.searchParams.get("input_json")!).appid;
      return { response: { total: 1, publishedfiledetails: [{ ...queryFixture, consumer_appid: appid }] } };
    } });
    for (const [game, appid] of Object.entries(games)) {
      expect((await request(`/modscan/v1/${game}/search`)).status).toBe(200);
      expect(JSON.parse(calls.at(-1)!.url.searchParams.get("input_json")!).appid).toBe(appid);
    }
  });
  it("fails clearly with a missing secret", async () => {
    const { request, calls } = await setup({ secret: "" });
    const response = await request(`${base}/search`);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("STEAM_WEB_API_KEY is missing");
    expect(calls).toHaveLength(0);
  });
  it("enforces the real client limiter even for cached requests", async () => {
    const { request, calls } = await setup({ limit: 1 });
    expect((await request(`${base}/search`)).status).toBe(200);
    const response = await request(`${base}/search`);
    expect(response.status).toBe(429);
    expect(await response.text()).toContain("client_rate_limit");
    expect((await request(`${base}/search`, "GET", "192.0.2.2")).status).toBe(200);
    expect(calls).toHaveLength(1);
  });
  it("atomically reserves the final budget slot across concurrent callers, survives eviction, and rejects HTTP misses", async () => {
    const { mf, budget, request, calls } = await setup();
    const hour = Math.floor(Date.now() / 3_600_000);
    await budget.fetch("https://budget/seed", { method: "POST", body: JSON.stringify([[hour - 1, 89999]]) });
    const responses = await Promise.all(Array.from({ length: 8 }, () => budget.fetch("https://budget/reserve", { method: "POST" })));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => r.status === 429)).toHaveLength(7);
    await mf.unsafeEvictDurableObject("panelapis", "TestBudget", { name: "steam-key-budget-v1" });
    const response = await request(`${base}/search`);
    expect(response.status).toBe(429);
    expect(await response.text()).toContain("steam_budget");
    expect(calls).toHaveLength(0);
  });
  it("retains midnight-adjacent reservations and expires only old rolling buckets", async () => {
    const { budget } = await setup(); const hour = Math.floor(Date.now() / 3_600_000);
    await budget.fetch("https://budget/seed", { method: "POST", body: JSON.stringify([[hour - 24, 90000]]) });
    expect((await budget.fetch("https://budget/reserve", { method: "POST" })).status).toBe(429);
    await budget.fetch("https://budget/seed", { method: "POST", body: JSON.stringify([[hour - 25, 90000]]) });
    expect((await budget.fetch("https://budget/reserve", { method: "POST" })).status).toBe(200);
  });
  it("maps upstream HTTP failures without exposing bodies or caching errors", async () => {
    const { request, calls } = await setup({ status: 403, upstream: () => SECRET });
    for (let i = 0; i < 2; i++) {
      const response = await request(`${base}/search`);
      expect(response.status).toBe(502);
      const body = await response.text(); expect(body).toContain("HTTP 403"); expect(body).not.toContain(SECRET);
    }
    expect(calls).toHaveLength(2);
  });
  it("rejects malformed data and upstream attempts to echo the secret", async () => {
    for (const payload of ["not json", { response: {} }, { response: { total: 1, publishedfiledetails: [{ ...queryFixture, title: SECRET }] } }]) {
      const { request } = await setup({ upstream: () => payload });
      const response = await request(`${base}/search`);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain(SECRET);
    }
  });
});
