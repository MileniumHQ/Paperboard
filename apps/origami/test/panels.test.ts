import { beforeEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import worker from "../src/index";
import { releaseMessage } from "../../paperboard/papercrane/releaseSignature";
import {
    createWranglerStorage,
    MAX_ARCHIVE_BYTES,
    publishPanel,
    unlistPanel,
    type PanelUpload,
} from "../scripts/lib/panelPublish";
import { createRegistry, wranglerRunner, writes, type Registry, type WranglerCall } from "./helpers/cloudflare";

const ORIGIN = "https://origami.ariapis.com";
const { privateKey } = generateKeyPairSync("ed25519");

let registry: Registry;
let calls: WranglerCall[];
let ctx: { storage: ReturnType<typeof createWranglerStorage>; origin: string };

beforeEach(() => {
    registry = createRegistry();
    calls = [];
    ctx = { storage: createWranglerStorage(wranglerRunner(registry, calls)), origin: ORIGIN };
    // a live registry always has its index, even when it lists nothing
    registry.kv.setJson("panels:index", {});
});

function request(path: string, init: RequestInit = {}): Promise<Response> {
    return worker.fetch(new Request(`${ORIGIN}${path}`, init), registry.env, {} as ExecutionContext);
}

const signable = (id: string, version: string) => [id, version].every((f) => f && !/[\n\r]/.test(f));

function upload(id: string, version: string, extra: Partial<PanelUpload> = {}): PanelUpload {
    const archive = extra.archive ?? new TextEncoder().encode(`archive of ${id}@${version}`);
    const sha256 = createHash("sha256").update(archive).digest("hex");
    return {
        id,
        name: `Panel ${id}`,
        version,
        // the publisher stores the signature; clients verify it. Invalid ids and
        // versions have no canonical message, so those sign the raw fields.
        signature: btoa(String.fromCharCode(...sign(null, signable(id, version) ? releaseMessage.panel(id, version, sha256) : new TextEncoder().encode(`${id}\n${version}`), privateKey))),
        manifest: { id, name: `Panel ${id}`, version },
        archive,
        ...extra,
    };
}

/** Everything the registry holds, to prove a refused operation changed none of it. */
function snapshot() {
    return {
        kv: [...registry.kv.values.entries()].sort(),
        r2: [...registry.panels.objects.keys()].sort(),
    };
}

async function refused(run: () => Promise<unknown>, message: RegExp): Promise<void> {
    const before = snapshot();
    const writesBefore = writes(calls).length;
    await expect(run()).rejects.toThrow(message);
    expect(writes(calls).length).toBe(writesBefore);
    expect(snapshot()).toEqual(before);
}

// The worker is read-only and its indexes are faithful.
describe("the worker is read-only and its indexes are faithful", () => {
    test("publish and delete requests write nothing and never answer 200", async () => {
        await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        const before = snapshot();
        const attempts: [string, RequestInit][] = [
            ["/panel/publish", { method: "POST", body: "{}" }],
            ["/panel/dev.example.clock", { method: "DELETE" }],
            ["/panel/dev.example.clock", { method: "PUT", body: "{}" }],
            ["/panel/dev.example.clock/download", { method: "DELETE" }],
            ["/panel/dev.example.clock/download", { method: "POST" }],
            ["/panels/index.json", { method: "POST", body: "{}" }],
            ["/package/index.json", { method: "PUT", body: "{}" }],
        ];
        for (const [path, init] of attempts) {
            const res = await request(path, init);
            expect({ path, method: init.method, ok: res.ok }).toEqual({ path, method: init.method, ok: false });
        }
        expect(snapshot()).toEqual(before);
        expect((await request("/panel/dev.example.clock")).status).toBe(200);
    });

    test("a download serves only the archive the registry hosts, never a record's off-registry URL", async () => {
        const record = await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        const hosted = await request("/panel/dev.example.clock/download");
        expect(hosted.status).toBe(200);
        expect(hosted.headers.get("content-type")).toBe("application/gzip");
        expect(hosted.headers.get("content-disposition")).toBe('attachment; filename="dev.example.clock-1.0.0.tar.gz"');
        expect(createHash("sha256").update(new Uint8Array(await hosted.arrayBuffer())).digest("hex")).toBe(record.sha256!);

        // a legacy record whose bytes live elsewhere
        registry.kv.setJson("panel:dev.example.legacy", {
            id: "dev.example.legacy",
            name: "Legacy",
            version: "0.1.0",
            downloadUrl: "https://evil.test/panel.tar.gz",
        });
        // and a record whose hosted archive is gone
        registry.kv.setJson("panel:dev.example.gone", { ...record, id: "dev.example.gone", archiveKey: "panels/dev.example.gone/missing.tar.gz" });
        for (const id of ["dev.example.legacy", "dev.example.gone", "dev.example.never"]) {
            const res = await request(`/panel/${id}/download`, { redirect: "manual" });
            expect({ id, status: res.status }).toEqual({ id, status: 404 });
            expect(res.headers.get("location")).toBeNull();
            expect(await res.text()).not.toContain("evil.test");
        }
    });

    test("the package index lists package records only", async () => {
        await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        registry.kv.setJson("java-21", { name: "java-21", version: "21.0.5", platforms: {} });
        registry.kv.setJson("ollama", { name: "ollama", version: "0.9.0", platforms: {} });
        registry.kv.setJson("dl/pb", { latest: "0.3.0", versions: {} });
        registry.kv.setJson("dl/crane", { latest: "0.3.0", versions: {} });
        registry.kv.setJson("trash:dev.example.old", { id: "dev.example.old" });
        registry.kv.setJson("board:legacy", { id: "legacy" });
        registry.kv.setJson("boards:index", {});
        const res = await request("/package/index.json");
        expect(res.status).toBe(200);
        expect(Object.keys((await res.json()) as object).sort()).toEqual(["java-21", "ollama"]);
    });

    test("an unreadable panel record fails the panels index instead of dropping the panel", async () => {
        await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        await publishPanel(upload("dev.example.notes", "1.0.0"), ctx);
        // the index projection is gone, so the worker rebuilds it from the records
        await registry.kv.delete("panels:index");
        const rebuilt = await request("/panels/index.json");
        expect(rebuilt.status).toBe(200);
        expect(Object.keys((await rebuilt.json()) as object).sort()).toEqual(["dev.example.clock", "dev.example.notes"]);

        registry.kv.values.set("panel:dev.example.notes", "{ not json");
        const res = await request("/panels/index.json");
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(await res.text()).not.toContain("dev.example.clock");
    });
});

// Panel id and version are validated before any write.
describe("panel id and version are validated before any write", () => {
    test("ids that could reach the index namespace or break headers are refused", async () => {
        for (const id of [
            "s:index",
            "panels:index",
            'dev.example"clock',
            "dev.example'clock",
            "dev/example",
            "dev\\example",
            "../dev.example",
            "dev..example",
            "dev example",
            "Dev.Example",
            "a".repeat(129),
        ]) {
            await refused(() => publishPanel(upload(id, "1.0.0"), ctx), /invalid panel id/);
        }
        expect(calls).toEqual([]);
    });

    test("versions with spaces, quotes or slashes, or over 64 characters, are refused", async () => {
        for (const version of ["1.0 .0", '1.0"', "1.0'", "1/0", "1\\0", "1.0;rm", "1".repeat(65), ""]) {
            await refused(() => publishPanel(upload("dev.example.clock", version), ctx), /invalid panel version|must include/);
        }
        expect(calls).toEqual([]);
    });

    test("real dotted ids and semver with prerelease and build parts publish", async () => {
        const id = `dev.paperboard.${"x".repeat(128 - "dev.paperboard.".length)}`;
        for (const [panel, version] of [
            ["dev.paperboard.gameserver", "1.2.3-beta.1+build.5"],
            ["dev.example.clock_face-2", "0.0.1-rc.2"],
            [id, "9".repeat(64)],
        ] as const) {
            const record = await publishPanel(upload(panel, version), ctx);
            expect(record.version).toBe(version);
            expect(registry.kv.json<{ version: string }>(`panel:${panel}`)?.version).toBe(version);
        }
    });
});

// A publish is signed, matches its manifest, and never rewrites a live version.
describe("a publish is signed, matches its manifest, and never rewrites a live version", () => {
    test("a missing or malformed release signature is refused", async () => {
        for (const signature of [undefined, "", "not a signature", "c2ln", "!".repeat(88)]) {
            await refused(
                () => publishPanel({ ...upload("dev.example.clock", "1.0.0"), signature: signature as string }, ctx),
                /release signature/,
            );
        }
    });

    test("a manifest id that differs from the published id is refused", async () => {
        await refused(
            () => publishPanel(upload("dev.example.clock", "1.0.0", { manifest: { id: "dev.example.other" } }), ctx),
            /manifest id must match/,
        );
    });

    test("an id and version already live is refused and the live record keeps its bytes", async () => {
        const live = await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        await refused(
            () => publishPanel(upload("dev.example.clock", "1.0.0", { archive: new TextEncoder().encode("different bytes") }), ctx),
            /already published/,
        );
        expect(registry.kv.json<{ sha256: string }>("panel:dev.example.clock")?.sha256).toBe(live.sha256!);
        // a new version is a new publish
        expect((await publishPanel(upload("dev.example.clock", "1.0.1"), ctx)).version).toBe("1.0.1");
    });

    test("an existing record that cannot be read refuses the publish", async () => {
        registry.kv.values.set("panel:dev.example.clock", "{ truncated");
        await refused(() => publishPanel(upload("dev.example.clock", "2.0.0"), ctx), /not valid JSON/);
    });

    test("a missing or unreadable panels index refuses the publish without touching the registry's records", async () => {
        for (const index of [undefined, "{ truncated", "[]"]) {
            if (index === undefined) registry.kv.values.delete("panels:index");
            else registry.kv.values.set("panels:index", index);
            const kvBefore = [...registry.kv.values.entries()].sort();
            await expect(publishPanel(upload("dev.example.clock", "1.0.0"), ctx)).rejects.toThrow(/panels:index|not valid JSON/);
            // the archive bytes may already be in the bucket; no record or index references them
            expect([...registry.kv.values.entries()].sort()).toEqual(kvBefore);
            expect(calls.filter((c) => c.args[1] === "kv" && c.args.includes("put"))).toEqual([]);
            expect((await request("/panel/dev.example.clock")).status).toBe(404);
        }
    });
});

// Publisher-supplied content cannot gain library authority.
describe("publisher-supplied content cannot gain library authority", () => {
    test("an icon's content type comes from its extension, and an unsupported one is refused", async () => {
        await refused(
            () => publishPanel(upload("dev.example.clock", "1.0.0", { icon: { name: "icon.exe", bytes: new Uint8Array([77, 90]) } }), ctx),
            /unsupported icon extension/,
        );
        await refused(
            () => publishPanel(upload("dev.example.clock", "1.0.0", { icon: { name: "icon.svg.html", bytes: new Uint8Array([60]) } }), ctx),
            /unsupported icon extension/,
        );
        const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        await publishPanel(upload("dev.example.clock", "1.0.0", { icon: { name: "logo.svg", bytes: svg } }), ctx);
        expect(registry.panels.objects.get("panels/dev.example.clock/icon.svg")?.contentType).toBe("image/svg+xml");
    });

    test("icons are served sandboxed and unsniffable", async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        await publishPanel(upload("dev.example.clock", "1.0.0", { icon: { name: "icon.svg", bytes: new TextEncoder().encode("<svg/>") } }), ctx);
        await publishPanel(upload("dev.example.notes", "1.0.0", { icon: { name: "icon.png", bytes: png } }), ctx);
        for (const [id, type] of [["dev.example.clock", "image/svg+xml"], ["dev.example.notes", "image/png"]] as const) {
            const res = await request(`/panel/${id}/icon`);
            expect(res.status).toBe(200);
            expect(res.headers.get("content-type")).toBe(type);
            expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
            expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        }
    });

    test("record URLs come only from the configured origin", async () => {
        const record = await publishPanel(
            upload("dev.example.clock", "1.0.0", {
                icon: { name: "icon.png", bytes: new Uint8Array([1]) },
                manifest: {
                    id: "dev.example.clock",
                    downloadUrl: "https://evil.test/a.tar.gz",
                    iconUrl: "https://evil.test/i.png",
                    store: { screenshots: [{ light: "store/one.png", dark: "store/one-dark.png" }] },
                },
                store: { files: new Map([["screenshot-0-light", new Uint8Array([1])], ["screenshot-0-dark", new Uint8Array([2])]]) },
            }),
            ctx,
        );
        const urls = [record.downloadUrl, record.iconUrl, ...record.store!.screenshots.flatMap((s) => [s.light, s.dark])];
        expect(urls).toHaveLength(4);
        for (const url of urls) expect(url!.startsWith(`${ORIGIN}/panel/dev.example.clock/`)).toBe(true);
        // the screenshot the record names is served from the registry
        const shot = await request(new URL(record.store!.screenshots[0]!.light).pathname);
        expect(shot.status).toBe(200);
        expect(shot.headers.get("x-content-type-options")).toBe("nosniff");
    });

    test("an archive over 64 MiB is refused before any write", async () => {
        await refused(
            () => publishPanel(upload("dev.example.clock", "1.0.0", { archive: new Uint8Array(MAX_ARCHIVE_BYTES + 1) }), ctx),
            /archive exceeds/,
        );
        expect(calls).toEqual([]);
    });

    test("store paths that escape store/ are refused before any write", async () => {
        for (const store of [
            { about: "../README.md" },
            { about: "store/../../secret.md" },
            { screenshots: [{ light: "../shot.png" }] },
            { screenshots: [{ light: "/etc/shot.png" }] },
            { screenshots: [{ light: "store/../shot.png" }] },
        ]) {
            await refused(
                () =>
                    publishPanel(
                        upload("dev.example.clock", "1.0.0", {
                            manifest: { id: "dev.example.clock", store },
                            store: { about: "About", files: new Map([["screenshot-0-light", new Uint8Array([1])]]) },
                        }),
                        ctx,
                    ),
                /inside store/,
            );
        }
        expect(writes(calls)).toEqual([]);
    });
});

// Unlisting removes a panel from the store but keeps it for installs.
describe("unlisting removes a panel from the store but keeps it for installs", () => {
    async function storeIds(): Promise<string[]> {
        const res = await request("/panels/index.json");
        expect(res.status).toBe(200);
        return Object.keys((await res.json()) as object).sort();
    }

    test("an unlisted panel leaves the store, including a rebuilt index, and keeps serving its record and archive", async () => {
        await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        await publishPanel(upload("dev.example.notes", "1.0.0"), ctx);
        expect(await storeIds()).toEqual(["dev.example.clock", "dev.example.notes"]);

        const unlisted = await unlistPanel("dev.example.clock", ctx);
        expect(typeof unlisted.unlistedAt).toBe("string");
        expect(await storeIds()).toEqual(["dev.example.notes"]);

        await registry.kv.delete("panels:index");
        expect(await storeIds()).toEqual(["dev.example.notes"]);

        const record = await request("/panel/dev.example.clock");
        expect(record.status).toBe(200);
        const body = (await record.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ id: "dev.example.clock", version: "1.0.0", unlistedAt: unlisted.unlistedAt });
        expect(typeof body.signature).toBe("string");
        expect(typeof body.sha256).toBe("string");
        expect((await request("/panel/dev.example.clock/download")).status).toBe(200);
    });

    test("a release whose manifest says unlisted stays off the store, and installs still get it", async () => {
        await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        await publishPanel(upload("dev.example.clock", "1.1.0", { manifest: { id: "dev.example.clock", unlisted: true } }), ctx);
        expect(await storeIds()).toEqual([]);
        const record = (await (await request("/panel/dev.example.clock")).json()) as { version: string; unlistedAt?: string };
        expect(record.version).toBe("1.1.0");
        expect(typeof record.unlistedAt).toBe("string");
        await registry.kv.delete("panels:index");
        expect(await storeIds()).toEqual([]);
    });

    test("unlisting an unknown, invalid or already-unlisted id writes nothing", async () => {
        await publishPanel(upload("dev.example.clock", "1.0.0"), ctx);
        await unlistPanel("dev.example.clock", ctx);
        await refused(() => unlistPanel("dev.example.never", ctx), /no panel/);
        await refused(() => unlistPanel("Dev/Bad", ctx), /invalid panel id/);
        await refused(() => unlistPanel("dev.example.clock", ctx), /isn't on the store/);
    });
});
