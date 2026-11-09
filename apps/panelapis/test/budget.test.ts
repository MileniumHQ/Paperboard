import { afterEach, describe, expect, test } from "bun:test";
import { CLIENT_LIMIT, startPanelapis, steamJson, workshopItems, type Panelapis } from "./helpers/worker";

const HOUR = 3_600_000;
const BUDGET = 90_000;

let api: Panelapis | undefined;

afterEach(async () => {
    await api?.dispose();
    api = undefined;
});

async function hours(target: Panelapis): Promise<[number, number][]> {
    const res = await target.budget("hours");
    expect(res.status).toBe(200);
    return ((await res.json()) as [number, number][] | null) ?? [];
}

async function setClock(target: Panelapis, at: number): Promise<void> {
    expect((await target.budget("clock", String(at))).status).toBe(200);
}

// Client rate limit and the shared Steam key budget hold.
describe("the client rate limit and the shared Steam key budget hold", () => {
    test("the per-client limit applies to cached answers too", async () => {
        api = await startPanelapis();
        const items = await workshopItems();
        api.steam.answer = () => steamJson({ response: { publishedfiledetails: [items[0]] } });
        const route = `/modscan/v1/tf2/items?ids=${items[0]!.publishedfileid}`;
        // The rate-limit binding counts in windows aligned to the wall clock.
        // A run that straddles a window boundary proves nothing either way,
        // so it is repeated once on a fresh client: two boundaries cannot
        // fall inside one sub-second run.
        for (const attempt of [1, 2]) {
            const ip = `192.0.2.${attempt}`;
            const window = Math.floor(Date.now() / 60_000);
            const statuses: number[] = [];
            let last: Response | undefined;
            for (let i = 0; i <= CLIENT_LIMIT; i++) {
                last = await api.get(route, { ip });
                statuses.push(last.status);
            }
            if (Math.floor(Date.now() / 60_000) !== window) {
                if (attempt === 2) throw new Error("two rate-limit windows rolled over during the test");
                continue;
            }
            expect(statuses.slice(0, CLIENT_LIMIT)).toEqual(Array(CLIENT_LIMIT).fill(200));
            expect(statuses[CLIENT_LIMIT]).toBe(429);
            expect(((await last!.json()) as { error: { code: string } }).error.code).toBe("client_rate_limit");
            break;
        }
        // one Steam call: every answer after the first came from the cache
        expect(api.calls).toHaveLength(1);
    }, 60_000);

    test("the budget's last slot goes to exactly one of several concurrent callers", async () => {
        api = await startPanelapis();
        const items = await workshopItems();
        const hour = 500_000;
        await setClock(api, hour * HOUR + 1_000);
        expect((await api.budget("seed", [[hour - 3, 50_000], [hour, BUDGET - 50_001]])).status).toBe(200);
        api.steam.answer = (call) => {
            const ids = JSON.parse(call.url.searchParams.get("input_json")!).publishedfileids as string[];
            return steamJson({ response: { publishedfiledetails: items.filter((i) => ids.includes(i.publishedfileid as string)) } });
        };
        // different items, so no answer can come from the cache
        const results = await Promise.all(
            items.map((item, i) => api!.get(`/modscan/v1/tf2/items?ids=${item.publishedfileid}`, { ip: `192.0.2.${10 + i}` })),
        );
        const statuses = results.map((r) => r.status).sort();
        expect(statuses).toEqual([200, ...Array(items.length - 1).fill(429)]);
        for (const res of results.filter((r) => r.status === 429)) {
            expect(((await res.json()) as { error: { code: string } }).error.code).toBe("steam_budget");
        }
        expect(api.calls).toHaveLength(1);
        expect(await hours(api)).toEqual([[hour - 3, 50_000], [hour, BUDGET - 50_000]]);
    }, 60_000);

    test("the count survives eviction and a restart of the runtime", async () => {
        api = await startPanelapis();
        for (let i = 0; i < 3; i++) expect((await api.budget("reserve")).status).toBe(200);
        await api.mf.unsafeEvictDurableObject("panelapis", "SteamBudget", { name: "steam-key-budget-v1" });
        expect((await api.budget("reserve")).status).toBe(200);
        const persistDir = api.persistDir;
        await api.stop();
        const restarted = await startPanelapis({ persistDir });
        try {
            expect((await restarted.budget("reserve")).status).toBe(200);
            const total = (await hours(restarted)).reduce((sum, [, n]) => sum + n, 0);
            expect(total).toBe(5);
        } finally {
            await restarted.stop();
        }
    }, 60_000);

    test("reservations expire only after a rolling 24 hours", async () => {
        api = await startPanelapis();
        const hour = 500_000;
        expect((await api.budget("seed", [[hour - 24, BUDGET]])).status).toBe(200);

        // 24 hours later the full hour still counts: refused
        await setClock(api, hour * HOUR + HOUR - 1);
        const refused = await api.budget("reserve");
        expect(refused.status).toBe(429);
        expect(await refused.json()).toEqual({ allowed: false });
        expect(await hours(api)).toEqual([[hour - 24, BUDGET]]);

        // one hour on, it has left the window: allowed, and dropped from storage
        await setClock(api, (hour + 1) * HOUR);
        const allowed = await api.budget("reserve");
        expect(allowed.status).toBe(200);
        expect(await allowed.json()).toEqual({ allowed: true });
        expect(await hours(api)).toEqual([[hour + 1, 1]]);
    }, 60_000);
});
