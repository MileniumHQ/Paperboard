// Unlisting: a panel taken off the store keeps its record and archive, so the
// installs that have it keep it. Driven through the operator's unlist and the
// worker's real routes over the same KV.
import { describe, expect, it } from "bun:test";
import worker, { type Env } from "../src/index";
import { publishPanel, unlistPanel, PanelPublishError, type PanelStorage } from "../scripts/lib/panelPublish";
import { PANELS_INDEX_KEY, PANEL_KEY_PREFIX } from "../src/panels";

const ORIGIN = "https://origami.ariapis.com";
const SIGNATURE = "A".repeat(86) + "==";

function registry() {
    const records = new Map<string, string>([[PANELS_INDEX_KEY, "{}"]]);
    const storage: PanelStorage = {
        getJson: async <T>(key: string) => (records.has(key) ? (JSON.parse(records.get(key)!) as T) : null),
        putJson: async (key, value) => void records.set(key, JSON.stringify(value)),
        putObject: async () => {},
    };
    const kv = {
        get: async (key: string, o?: { type?: string }) => {
            const v = records.get(key);
            return v === undefined ? null : o?.type === "json" ? JSON.parse(v) : v;
        },
        list: async (o: { prefix?: string }) => ({
            keys: [...records.keys()].filter((k) => k.startsWith(o.prefix ?? "")).map((name) => ({ name })),
            list_complete: true,
        }),
    } as unknown as KVNamespace;
    const get = async (path: string) => {
        const res = await worker.fetch(new Request(`http://localhost${path}`), { PACKAGES: kv } as Env, {} as never);
        return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    return { records, storage, get };
}

async function publish(storage: PanelStorage, id: string, version = "1.0.0") {
    await publishPanel(
        { id, name: id, version, signature: SIGNATURE, manifest: { id, name: id, version }, archive: new TextEncoder().encode(id) },
        { storage, origin: ORIGIN },
    );
}

describe("unlisting a panel", () => {
    it("takes it off the store and keeps its record for the installs that have it", async () => {
        const r = registry();
        await publish(r.storage, "dev.test.old");
        await publish(r.storage, "dev.test.kept");

        const record = await unlistPanel("dev.test.old", { storage: r.storage });
        expect(record.unlistedAt).toBeString();

        expect(Object.keys((await r.get("/panels/index.json")).body)).toEqual(["dev.test.kept"]);
        const kept = await r.get("/panel/dev.test.old");
        expect(kept.status).toBe(200);
        expect(kept.body).toMatchObject({ id: "dev.test.old", version: "1.0.0", sha256: expect.any(String), signature: SIGNATURE });

        // an index rebuilt from the records (the worker's fallback) leaves it out too
        r.records.delete(PANELS_INDEX_KEY);
        expect(Object.keys((await r.get("/panels/index.json")).body)).toEqual(["dev.test.kept"]);
    });

    it("refuses what it can't unlist, and writes nothing", async () => {
        const r = registry();
        await publish(r.storage, "dev.test.old");
        await expect(unlistPanel("dev.test.missing", { storage: r.storage })).rejects.toThrow(/has no panel dev.test.missing/);
        await expect(unlistPanel("s:index", { storage: r.storage })).rejects.toThrow(PanelPublishError);
        await unlistPanel("dev.test.old", { storage: r.storage });
        const before = new Map(r.records);
        await expect(unlistPanel("dev.test.old", { storage: r.storage })).rejects.toThrow(/isn't on the store/);
        expect(r.records).toEqual(before);
    });

    it("publishing it again lists it again", async () => {
        const r = registry();
        await publish(r.storage, "dev.test.old");
        await unlistPanel("dev.test.old", { storage: r.storage });
        await publish(r.storage, "dev.test.old", "1.0.1");
        expect(Object.keys((await r.get("/panels/index.json")).body)).toEqual(["dev.test.old"]);
        expect(JSON.parse(r.records.get(`${PANEL_KEY_PREFIX}dev.test.old`)!).unlistedAt).toBeUndefined();
    });
});
