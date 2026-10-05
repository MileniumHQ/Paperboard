// Publish-boundary hardening (bun test): the adversarial audit's O1–O3,
// O5, O9–O12 — now enforced by the operator-side direct publisher, since
// the public /panel/publish route is gone. Each test proves the attack
// fails; these are the proofs the migration ships with.
import { describe, it, expect } from "bun:test";
import {
    publishPanel,
    PanelPublishError,
    type PanelStorage,
    type PanelUpload,
} from "../scripts/lib/panelPublish";
import {
    isValidPanelId,
    isValidPanelVersion,
    PANELS_INDEX_KEY,
    PANEL_KEY_PREFIX,
} from "../src/panels";

const ORIGIN = "https://origami.ariapis.com";
// a well-formed release signature: the registry stores it but holds no key
const SIGNATURE = "A".repeat(86) + "==";

interface Mem {
    storage: PanelStorage;
    records: Map<string, string>;
    objects: Map<string, Uint8Array>;
    types: Map<string, string>;
}

function mem(seedIndex = true): Mem {
    const records = new Map<string, string>();
    const objects = new Map<string, Uint8Array>();
    const types = new Map<string, string>();
    if (seedIndex) records.set(PANELS_INDEX_KEY, JSON.stringify({}));
    const storage: PanelStorage = {
        async getJson<T>(key: string): Promise<T | null> {
            return records.has(key) ? (JSON.parse(records.get(key)!) as T) : null;
        },
        async putJson(key, value) {
            records.set(key, JSON.stringify(value));
        },
        async putObject(key, bytes, contentType) {
            objects.set(key, bytes);
            types.set(key, contentType);
        },
    };
    return { storage, records, objects, types };
}

function upload(overrides: Partial<PanelUpload> = {}): PanelUpload {
    return {
        id: "dev.test.panel",
        name: "Test Panel",
        version: "0.1.0",
        signature: SIGNATURE,
        manifest: { id: "dev.test.panel", name: "Test Panel", version: "0.1.0" },
        archive: new TextEncoder().encode("archive-bytes"),
        ...overrides,
    };
}

describe("O1: id/version validation before any write", () => {
    it("refuses an id that would collide with the index key namespace", async () => {
        const m = mem();
        await expect(
            publishPanel(upload({ id: "s:index" }), { storage: m.storage, origin: ORIGIN }),
        ).rejects.toBeInstanceOf(PanelPublishError);
        expect(m.objects.size).toBe(0);
    });

    it("refuses ids with quotes, slashes, traversal shapes, and control chars", async () => {
        for (const id of ['a"b', "a/b", "..", "a..b", "Upper.Case", "a b", "x".repeat(129)]) {
            const m = mem();
            await expect(
                publishPanel(upload({ id }), { storage: m.storage, origin: ORIGIN }),
            ).rejects.toThrow(/invalid panel id/);
            expect(m.objects.size).toBe(0);
        }
    });

    it("refuses versions that would break the download header", async () => {
        for (const version of ["a b", 'a"b', "a/b", "x".repeat(65)]) {
            const m = mem();
            await expect(
                publishPanel(upload({ version }), { storage: m.storage, origin: ORIGIN }),
            ).rejects.toThrow(/invalid panel version/);
        }
    });

    it("accepts real first-party dotted ids and versions", () => {
        for (const id of ["dev.paperboard.actions", "dev.paperboard.my-panel", "a.b_c"]) {
            expect(isValidPanelId(id)).toBe(true);
        }
        expect(isValidPanelVersion("0.1.0")).toBe(true);
        expect(isValidPanelVersion("1.2.3-beta.4+build")).toBe(true);
    });
});

describe("the upload must carry a release signature and matching manifest id", () => {
    it("refuses a missing or malformed signature", async () => {
        for (const signature of ["", "nope", "A".repeat(10)]) {
            const m = mem();
            await expect(
                publishPanel(upload({ signature }), { storage: m.storage, origin: ORIGIN }),
            ).rejects.toThrow(/release signature/);
        }
    });

    it("refuses a manifest whose id disagrees with the published id", async () => {
        const m = mem();
        await expect(
            publishPanel(
                upload({ manifest: { id: "dev.other.panel" } }),
                { storage: m.storage, origin: ORIGIN },
            ),
        ).rejects.toThrow(/manifest id must match/);
    });
});

describe("O2: icon content type is derived, never publisher-chosen", () => {
    it("stores text/html bytes under the svg-derived image type", async () => {
        const m = mem();
        const record = await publishPanel(
            upload({
                icon: { name: "icon.svg", bytes: new TextEncoder().encode("<html>attack</html>") },
            }),
            { storage: m.storage, origin: ORIGIN },
        );
        expect(m.types.get(`panels/${record.id}/icon.svg`)).toBe("image/svg+xml");
        expect(record.iconUrl).toBe(`${ORIGIN}/panel/${record.id}/icon`);
    });

    it("refuses an unsupported icon extension before writing", async () => {
        const m = mem();
        await expect(
            publishPanel(
                upload({ icon: { name: "icon.exe", bytes: new Uint8Array([1]) } }),
                { storage: m.storage, origin: ORIGIN },
            ),
        ).rejects.toThrow(/unsupported icon extension/);
        expect(m.objects.size).toBe(0);
    });
});

describe("O3: byte caps hold on the operator path", () => {
    it("refuses an archive over the cap before writing", async () => {
        const m = mem();
        const huge = new Uint8Array(64 * 1024 * 1024 + 1);
        await expect(
            publishPanel(upload({ archive: huge }), { storage: m.storage, origin: ORIGIN }),
        ).rejects.toThrow(/archive exceeds/);
        expect(m.objects.size).toBe(0);
    });
});

describe("O5: the index is an upsert projection of live records", () => {
    it("a publish adds the record to the index", async () => {
        const m = mem();
        const record = await publishPanel(upload(), { storage: m.storage, origin: ORIGIN });
        const index = JSON.parse(m.records.get(PANELS_INDEX_KEY)!) as Record<string, unknown>;
        expect(index[record.id]).toBeDefined();
        expect((index[record.id] as { sha256: string }).sha256).toBe(record.sha256);
    });

    it("refuses to write when the index is missing or unreadable", async () => {
        const m = mem(false);
        await expect(
            publishPanel(upload(), { storage: m.storage, origin: ORIGIN }),
        ).rejects.toThrow(/panels:index is missing or unreadable/);
        expect(m.records.has(`${PANEL_KEY_PREFIX}dev.test.panel`)).toBe(false);
    });
});

describe("a version names fixed bytes", () => {
    it("refuses to republish a live version instead of overwriting its bytes", async () => {
        const m = mem();
        await publishPanel(upload(), { storage: m.storage, origin: ORIGIN });
        await expect(
            publishPanel(upload({ archive: new TextEncoder().encode("different") }), {
                storage: m.storage,
                origin: ORIGIN,
            }),
        ).rejects.toThrow(/already published/);
    });

    it("allows a new version", async () => {
        const m = mem();
        await publishPanel(upload(), { storage: m.storage, origin: ORIGIN });
        const record = await publishPanel(upload({ version: "0.2.0" }), {
            storage: m.storage,
            origin: ORIGIN,
        });
        expect(record.version).toBe("0.2.0");
    });

    it("refuses the publish when the existing record cannot be read", async () => {
        const broken: PanelStorage = {
            async getJson() {
                throw new Error("kv unavailable");
            },
            async putJson() {},
            async putObject() {},
        };
        await expect(publishPanel(upload(), { storage: broken, origin: ORIGIN })).rejects.toThrow(
            /kv unavailable/,
        );
    });
});

describe("O9/O10/O11/O12: record hygiene", () => {
    it("record URLs come from the configured origin, not the request", async () => {
        const m = mem();
        const record = await publishPanel(upload(), {
            storage: m.storage,
            origin: "https://registry.example",
        });
        expect(record.downloadUrl).toBe("https://registry.example/panel/dev.test.panel/download");
    });

    it("never stores a publisher-supplied icon URL field", async () => {
        const m = mem();
        const record = await publishPanel(
            upload({ manifest: { id: "dev.test.panel", icon: "https://evil.test/i.png" } }),
            { storage: m.storage, origin: ORIGIN },
        );
        expect(record.icon).toBeUndefined();
        expect(record.iconUrl).toBeUndefined();
    });
});

describe("store listing is validated in full before anything is written", () => {
    it("writes per-version media and derives its content type", async () => {
        const m = mem();
        const files = new Map<string, Uint8Array>([
            ["screenshot-0-light", new Uint8Array([1, 2, 3])],
        ]);
        const record = await publishPanel(
            upload({
                manifest: {
                    id: "dev.test.panel",
                    store: { screenshots: [{ light: "./store/1-light.png", alt: "Home" }] },
                },
                store: { files },
            }),
            { storage: m.storage, origin: ORIGIN },
        );
        const key = `panels/dev.test.panel/media/0.1.0/0-light.png`;
        expect(m.types.get(key)).toBe("image/png");
        expect(record.store?.screenshots[0]?.light).toBe(
            `${ORIGIN}/panel/dev.test.panel/media/0.1.0/0-light.png`,
        );
    });

    it("refuses a malformed listing before writing any bytes", async () => {
        const m = mem();
        await expect(
            publishPanel(
                upload({
                    manifest: { id: "dev.test.panel", store: { screenshots: [{ light: "../evil.png" }] } },
                }),
                { storage: m.storage, origin: ORIGIN },
            ),
        ).rejects.toThrow(/store\.screenshots/);
        expect(m.objects.size).toBe(0);
    });

    it("refuses when the about file is named but absent", async () => {
        const m = mem();
        await expect(
            publishPanel(
                upload({
                    manifest: { id: "dev.test.panel", store: { about: "./store/about.md" } },
                }),
                { storage: m.storage, origin: ORIGIN },
            ),
        ).rejects.toThrow(/no about text/);
        expect(m.objects.size).toBe(0);
    });
});
