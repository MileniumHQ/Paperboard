import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { STEAM_KEY, startPanelapis, steamJson, workshopItems, type Panelapis } from "./helpers/worker";

let api: Panelapis;
let items: Record<string, unknown>[];
let nextIp = 1;
// each test is its own client, so no test spends another's rate limit
const freshIp = () => `198.51.100.${nextIp++}`;

const ITEM_FIELDS = [
    "authorId", "children", "description", "favorites", "fileSize", "id", "previewImageUrl",
    "subscriptions", "tags", "timeUpdated", "title", "workshopUrl",
].sort();

beforeAll(async () => {
    api = await startPanelapis();
    items = await workshopItems();
}, 60_000);

afterAll(async () => {
    await api?.dispose();
});

function item(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const base = items[index];
    if (!base) throw new Error(`the fixture has no item ${index}`);
    return { ...base, ...overrides };
}

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
    const body = (await res.json()) as { error?: { code: string; message: string } };
    if (!body.error) throw new Error(`expected an error body, got ${JSON.stringify(body)}`);
    return body.error;
}

// Only allowlisted requests reach Steam, and the key never leaks.
describe("only allowlisted requests reach Steam, and the key never leaks", () => {
    test("unknown routes, games, methods and parameters are refused without an upstream call", async () => {
        const ip = freshIp();
        const refused: [string, RequestInit, number, string][] = [
            ["/elsewhere/v1/tf2/search", {}, 404, "not_found"],
            ["/modscan/v1/minecraft/search", {}, 404, "not_found"],
            ["/modscan/v1/tf2/files", {}, 404, "not_found"],
            ["/modscan/v1/tf2/search/extra", {}, 404, "not_found"],
            ["/modscan/v1/tf2/search", { method: "POST" }, 405, "method_not_allowed"],
            ["/modscan/v1/tf2/search", { method: "DELETE" }, 405, "method_not_allowed"],
            ["/modscan/v1/tf2/search?appid=730", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/search?key=attacker", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/search?url=https://evil.test/", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/search?q=a&q=b", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/search?page=0", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/search?page=1001", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/search?sort=random", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/items?ids=1597573871,1597573871", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/items?ids=0", {}, 400, "invalid_request"],
            ["/modscan/v1/tf2/items?ids=1597573871&page=2", {}, 400, "invalid_request"],
        ];
        for (const [route, init, status, code] of refused) {
            const res = await api.get(route, { ...init, ip });
            expect({ route, method: init.method ?? "GET", status: res.status }).toEqual({ route, method: init.method ?? "GET", status });
            expect((await errorOf(res)).code).toBe(code);
        }
        expect(api.calls).toHaveLength(0);
    });

    test("a search sends Steam only the fixed parameters and answers without private fields or the key", async () => {
        api.calls.length = 0;
        // Steam's own response carries the fields Modscan must never pass on
        api.steam.answer = () =>
            steamJson({ response: { total: 2, publishedfiledetails: [item(0, { file_url: "https://cdn.steam.test/private.bsp" }), item(1)] } });
        const res = await api.get("/modscan/v1/tf2/search?q=%20snow%20&page=2&sort=updated", { ip: freshIp() });
        const raw = await res.text();
        expect(res.status).toBe(200);

        expect(api.calls).toHaveLength(1);
        const call = api.calls[0]!;
        expect(call.method).toBe("GET");
        expect(call.url.origin + call.url.pathname).toBe("https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/");
        expect([...call.url.searchParams.keys()].sort()).toEqual(["input_json", "key"]);
        expect(call.url.searchParams.get("key")).toBe(STEAM_KEY);
        expect(JSON.parse(call.url.searchParams.get("input_json")!)).toEqual({
            appid: 440,
            search_text: "snow",
            page: 2,
            query_type: 19,
            numperpage: 20,
            return_tags: true,
            return_children: true,
            return_short_description: true,
            filetype: 18,
        });

        expect(raw).not.toContain(STEAM_KEY);
        expect(raw).not.toContain("file_url");
        expect(raw).not.toContain("private.bsp");
        expect(raw).not.toContain("hcontent_file");
        const body = JSON.parse(raw) as { items: Record<string, unknown>[]; total: number };
        expect(body.total).toBe(2);
        expect(body.items.map((i) => i.id)).toEqual([items[0]!.publishedfileid, items[1]!.publishedfileid]);
        for (const answered of body.items) expect(Object.keys(answered).sort()).toEqual(ITEM_FIELDS);
    });

    test("a Steam answer that echoes the key is refused, and the key is not in the error", async () => {
        api.calls.length = 0;
        api.steam.answer = () => steamJson({ response: { publishedfiledetails: [item(2, { description: `debug key=${STEAM_KEY}` })] } });
        const res = await api.get(`/modscan/v1/tf2/items?ids=${items[2]!.publishedfileid}`, { ip: freshIp() });
        const raw = await res.text();
        expect(res.status).toBe(502);
        expect(raw).not.toContain(STEAM_KEY);
        expect((JSON.parse(raw) as { error: { code: string } }).error.code).toBe("steam_schema");
        expect(api.calls).toHaveLength(1);
    });

    test("an item that is not public answers 404", async () => {
        api.steam.answer = () => steamJson({ response: { publishedfiledetails: [item(3, { visibility: 2 })] } });
        const res = await api.get(`/modscan/v1/tf2/items?ids=${items[3]!.publishedfileid}`, { ip: freshIp() });
        expect(res.status).toBe(404);
        expect((await errorOf(res)).code).toBe("item_not_public");
    });

    test("an upstream error answers 502 without Steam's body and is not cached", async () => {
        api.calls.length = 0;
        const upstreamBody = `<html>internal trace for ${STEAM_KEY}</html>`;
        api.steam.answer = () => new Response(upstreamBody, { status: 500 });
        const ip = freshIp();
        const route = "/modscan/v1/tf2/search?q=uncached-failure";
        for (const attempt of [1, 2]) {
            const res = await api.get(route, { ip });
            const raw = await res.text();
            expect({ attempt, status: res.status }).toEqual({ attempt, status: 502 });
            expect(raw).not.toContain("internal trace");
            expect(raw).not.toContain(STEAM_KEY);
            expect((JSON.parse(raw) as { error: { code: string } }).error.code).toBe("steam_http");
        }
        // the second request went upstream again: the failure was never cached
        expect(api.calls).toHaveLength(2);
    });

    test("a successful answer is cached, so the same request does not reach Steam twice", async () => {
        api.calls.length = 0;
        api.steam.answer = () => steamJson({ response: { publishedfiledetails: [item(4)] } });
        const route = `/modscan/v1/tf2/items?ids=${items[4]!.publishedfileid}`;
        const first = await api.get(route, { ip: freshIp() });
        expect(first.status).toBe(200);
        const firstBody = await first.text();
        const second = await api.get(route, { ip: freshIp() });
        expect(second.status).toBe(200);
        expect(await second.text()).toBe(firstBody);
        expect(api.calls).toHaveLength(1);
    });
});
