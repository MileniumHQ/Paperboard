// publishLib proofs (bun test): tags, canonical asset names, download
// URLs, latest.yml feeds, version-record merges, and the legacy redirect
// map. The worker and publish.ts both build behavior on these, so the
// contract is pinned here.
import { describe, expect, it } from "bun:test";
import {
    storeUploadParts,
    ALL_TARGETS,
    archOf,
    assetFileName,
    paperboardArtifacts,
    buildCraneIndex,
    buildLatestYml,
    dlFileUrl,
    isArch,
    isOs,
    isValidFileSegment,
    isValidVersionSegment,
    KV_PACKAGES_BINDING,
    kvKeyFor,
    legacyDownloadRedirect,
    mergeVersionRecord,
    PAPERDL_R2_BUCKET,
    parseUsbArgs,
    r2YmlKey,
    releaseAssetUrl,
    tagFor,
    targetsForOses,
    USB_ARCHES,
    USB_OSES,
    ymlKeyFor,
    type DlAppRecord,
} from "./publishLib";

describe("deploy targets", () => {
    it("pins the R2 bucket and KV binding from wrangler.jsonc", () => {
        expect(PAPERDL_R2_BUCKET).toBe("paperboard-paperdl");
        expect(KV_PACKAGES_BINDING).toBe("PACKAGES");
    });
});

describe("usb OS and arch selection", () => {
    it("presents every OS and arch that has targets", () => {
        expect(USB_OSES).toEqual(["windows", "macos", "linux"]);
        for (const os of USB_OSES) expect(isOs(os)).toBe(true);
        expect(isOs("solaris")).toBe(false);
        expect(USB_ARCHES).toEqual(["x64", "arm64"]);
        for (const arch of USB_ARCHES) expect(isArch(arch)).toBe(true);
        expect(isArch("riscv64")).toBe(false);
        expect(ALL_TARGETS.map(archOf)).toEqual(["x64", "arm64", "x64", "arm64", "x64"]);
    });

    it("scopes crane targets to the chosen OSes and arches", () => {
        expect(targetsForOses(["windows"])).toEqual(["windows-x64"]);
        expect(targetsForOses(["macos"])).toEqual(["macos-x64", "macos-arm64"]);
        expect(targetsForOses(["linux"])).toEqual(["linux-x64", "linux-arm64"]);
        // ALL_TARGETS order is preserved however the OSes were selected.
        expect(targetsForOses(["linux", "macos"])).toEqual([
            "linux-x64",
            "linux-arm64",
            "macos-x64",
            "macos-arm64",
        ]);
        // Arches narrow each OS; an OS with no target of that arch drops out.
        expect(targetsForOses(["linux", "windows"], ["arm64"])).toEqual(["linux-arm64"]);
        expect(targetsForOses(["macos", "linux"], ["x64"])).toEqual([
            "linux-x64",
            "macos-x64",
        ]);
    });

    it("parses --os and --arch in comma-separated and repeated forms, deduped", () => {
        expect(parseUsbArgs(["--os", "windows"])).toEqual({
            oses: ["windows"],
            arches: null,
            help: false,
        });
        expect(parseUsbArgs(["--os=linux,macos"])).toEqual({
            oses: ["linux", "macos"],
            arches: null,
            help: false,
        });
        expect(parseUsbArgs(["-o", "windows", "--os", "windows"])).toEqual({
            oses: ["windows"],
            arches: null,
            help: false,
        });
        expect(parseUsbArgs(["--arch", "arm64"])).toEqual({
            oses: null,
            arches: ["arm64"],
            help: false,
        });
        expect(parseUsbArgs(["--arch=x64,arm64", "-a", "x64"])).toEqual({
            oses: null,
            arches: ["x64", "arm64"],
            help: false,
        });
        expect(parseUsbArgs(["--os=linux", "--arch=arm64"])).toEqual({
            oses: ["linux"],
            arches: ["arm64"],
            help: false,
        });
        expect(parseUsbArgs([])).toEqual({ oses: null, arches: null, help: false });
        expect(parseUsbArgs(["--help"])).toEqual({ oses: null, arches: null, help: true });
    });

    it("refuses unknown OSes/arches, missing values, and stray flags", () => {
        expect(() => parseUsbArgs(["--os", "solaris"])).toThrow(/Unknown OS/);
        expect(() => parseUsbArgs(["--os"])).toThrow(/needs a value/);
        expect(() => parseUsbArgs(["--arch", "riscv64"])).toThrow(/Unknown architecture/);
        expect(() => parseUsbArgs(["--arch"])).toThrow(/needs a value/);
        expect(() => parseUsbArgs(["--wat"])).toThrow(/Unknown usb option/);
    });
});

describe("release tags and URLs", () => {
    it("uses one tag per version for both release lines", () => {
        expect(tagFor("3.0.0-alpha")).toBe("v3.0.0-alpha");
        expect(tagFor("0.1.0")).toBe("v0.1.0");
    });

    it("release assets address the GitHub tag, never Origami bytes", () => {
        // the app and its embedded server share the version's one tag
        expect(releaseAssetUrl("3.0.0-alpha", "paperboard-macos-x64.zip")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/v3.0.0-alpha/paperboard-macos-x64.zip",
        );
        expect(releaseAssetUrl("3.0.0-alpha", "crane-linux-arm64.tar.gz")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/v3.0.0-alpha/crane-linux-arm64.tar.gz",
        );
    });

    it("public download URLs use the dl host and app segment", () => {
        expect(dlFileUrl("pb", "latest", "paperboard-macos-x64.zip")).toBe(
            "https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip",
        );
        expect(dlFileUrl("crane", "2.0.0-alpha", "crane-linux-arm64.tar.gz")).toBe(
            "https://i.paperboard.dev/crane/2.0.0-alpha/crane-linux-arm64.tar.gz",
        );
    });
});

describe("canonical asset names", () => {
    it("names every shipped app target versionlessly", () => {
        expect(assetFileName("pb", "linux-x64")).toBe("paperboard-linux-x64.AppImage");
        expect(assetFileName("pb", "linux-arm64")).toBe("paperboard-linux-arm64.AppImage");
        expect(assetFileName("pb", "macos-x64")).toBe("paperboard-macos-x64.zip");
        expect(assetFileName("pb", "macos-arm64")).toBe("paperboard-macos-arm64.zip");
        expect(assetFileName("pb", "windows-x64")).toBe("paperboard-windows-x64-setup.exe");
    });

    it("ships one macOS ZIP per arch that is both installer and update payload", () => {
        for (const arch of ["x64", "arm64"] as const) {
            expect(paperboardArtifacts(`macos-${arch}`, "0.1.0")).toEqual({
                buildFile: `paperboard-0.1.0-${arch}.zip`,
                releaseFile: `paperboard-macos-${arch}.zip`,
            });
        }
    });

    it("ships crane binaries as tarballs on posix, zip on windows", () => {
        expect(assetFileName("crane", "linux-x64")).toBe("crane-linux-x64.tar.gz");
        expect(assetFileName("crane", "linux-arm64")).toBe("crane-linux-arm64.tar.gz");
        expect(assetFileName("crane", "macos-x64")).toBe("crane-macos-x64.tar.gz");
        expect(assetFileName("crane", "macos-arm64")).toBe("crane-macos-arm64.tar.gz");
        expect(assetFileName("crane", "windows-x64")).toBe("crane-windows-x64.zip");
    });
});

describe("URL segment guards", () => {
    it("accepts real versions and filenames", () => {
        expect(isValidVersionSegment("3.0.0-alpha")).toBe(true);
        expect(isValidVersionSegment("2.0.0")).toBe(true);
        expect(isValidFileSegment("paperboard-macos-x64.zip")).toBe(true);
        expect(isValidFileSegment("crane-linux-arm64.tar.gz")).toBe(true);
    });

    it("rejects anything that could break out of its path slot", () => {
        for (const bad of ["../x", "a/b", "a%20b", "a b", "a?b", "a#b", "", ".hidden", "-lead"]) {
            expect(isValidVersionSegment(bad)).toBe(false);
            expect(isValidFileSegment(bad)).toBe(false);
        }
    });

    it("lets 'latest' through the version shape so the router can reserve it", () => {
        expect(isValidVersionSegment("latest")).toBe(true);
    });
});

describe("KV version records", () => {
    it("starts a record from nothing", () => {
        const rec = mergeVersionRecord(null, "3.0.0-alpha", [
            { file: "paperboard-macos-x64.zip", sha256: "abc", size: 1 },
        ]);
        expect(rec.latest).toBe("3.0.0-alpha");
        expect(Object.keys(rec.versions)).toEqual(["3.0.0-alpha"]);
    });

    it("retains previous versions and moves latest", () => {
        const prev: DlAppRecord = {
            latest: "3.0.0-alpha",
            versions: {
                "3.0.0-alpha": { files: [{ file: "a", sha256: "x", size: 1 }] },
            },
        };
        const rec = mergeVersionRecord(prev, "3.1.0-alpha", [
            { file: "b", sha256: "y", size: 2 },
        ]);
        expect(rec.latest).toBe("3.1.0-alpha");
        expect(Object.keys(rec.versions).sort()).toEqual(["3.0.0-alpha", "3.1.0-alpha"]);
        expect(rec.versions["3.0.0-alpha"].files[0].file).toBe("a");
    });

    it("uses dl/ keys in the shared KV namespace", () => {
        expect(kvKeyFor("pb")).toBe("dl/pb");
        expect(kvKeyFor("crane")).toBe("dl/crane");
    });
});

describe("latest.yml feeds", () => {
    it("points every file at the dl latest alias with hashes", () => {
        const { key, text } = buildLatestYml(
            "macos",
            "3.0.0-alpha",
            [
                { target: "macos-x64", file: "paperboard-macos-x64.zip", sha512: "s1", size: 10 },
                { target: "macos-arm64", file: "paperboard-macos-arm64.zip", sha512: "s2", size: 20 },
            ],
            "2026-01-01T00:00:00.000Z",
        );
        expect(key).toBe("pb/latest-mac.yml");
        expect(r2YmlKey("windows")).toBe("pb/latest.yml");
        expect(r2YmlKey("linux")).toBe("pb/latest-linux.yml");
        expect(ymlKeyFor("windows")).toBe("latest.yml");
        expect(text).toContain("version: 3.0.0-alpha");
        expect(text).toContain("url: https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip");
        expect(text).toContain("url: https://i.paperboard.dev/pb/latest/paperboard-macos-arm64.zip");
        expect(text).toContain("sha512: s1");
        expect(text).toContain("size: 20");
        expect(text).toContain("path: https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip");
        expect(text).toContain("releaseDate: '2026-01-01T00:00:00.000Z'");
    });
});

describe("legacy download redirects", () => {
    it("maps old paperboard targets to canonical latest files", () => {
        expect(legacyDownloadRedirect("paperboard", "macos-x64")).toBe(
            "https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip",
        );
        expect(legacyDownloadRedirect("paperboard", "windows-x64")).toBe(
            "https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe",
        );
        expect(legacyDownloadRedirect("crane", "linux-arm64")).toBe(
            "https://i.paperboard.dev/crane/latest/crane-linux-arm64.tar.gz",
        );
    });

    it("returns null for unknown targets instead of fabricating a URL", () => {
        expect(legacyDownloadRedirect("paperboard", "solaris-sparc")).toBeNull();
        expect(legacyDownloadRedirect("crane", "")).toBeNull();
    });
});

describe("storeUploadParts", () => {
    const files: Record<string, Uint8Array> = {
        "./store/about.md": new TextEncoder().encode("# About"),
        "./store/1-light.png": new Uint8Array([1]),
        "./store/1-dark.webp": new Uint8Array([2]),
    };
    const read = (rel: string) => {
        const bytes = files[rel];
        if (!bytes) throw new Error(`ENOENT ${rel}`);
        return bytes;
    };

    it("maps every declared file to the field Origami reads", () => {
        const parts = storeUploadParts(
            {
                about: "./store/about.md",
                screenshots: [{ light: "./store/1-light.png", dark: "./store/1-dark.webp" }],
            },
            read,
        );
        expect(parts.about).toBe("# About");
        expect(parts.files.map(({ field, fileName, type }) => ({ field, fileName, type }))).toEqual([
            { field: "screenshot-0-light", fileName: "1-light.png", type: "image/png" },
            { field: "screenshot-0-dark", fileName: "1-dark.webp", type: "image/webp" },
        ]);
    });

    it("no listing uploads nothing; a missing or invalid listing refuses the publish", () => {
        expect(storeUploadParts(undefined, read)).toEqual({ files: [] });
        expect(() => storeUploadParts({ screenshots: [{ light: "./store/2.png" }] }, read)).toThrow(/ENOENT/);
        expect(() => storeUploadParts({ about: "./about.md" }, read)).toThrow(/inside store/);
    });
});

describe("crane update index", () => {
    it("keys one signed entry per target in the shape updatePlan reads", () => {
        const index = buildCraneIndex("2.0.0", [
            { target: "linux-x64", file: "crane-linux-x64.tar.gz", sha256: "a".repeat(64), signature: "sig-linux" },
            { target: "windows-x64", file: "crane-windows-x64.zip", sha256: "b".repeat(64), signature: "sig-win" },
        ]);
        expect(Object.keys(index).sort()).toEqual(["linux-x64", "windows-x64"]);
        expect(index["linux-x64"]).toEqual({
            version: "2.0.0",
            sha256: "a".repeat(64),
            downloadUrl: dlFileUrl("crane", "2.0.0", "crane-linux-x64.tar.gz"),
            signature: "sig-linux",
        });
        // every entry carries the signature the daemon verifies
        for (const entry of Object.values(index)) {
            expect(entry.signature).toBeTruthy();
            expect(entry.downloadUrl).toContain("2.0.0");
        }
    });
});

describe("first-party store listings", () => {
    const { readdirSync, readFileSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const panelsDir = join(import.meta.dir, "../panels");

    it.each(readdirSync(panelsDir))("%s: listing validates and every named file exists", (id) => {
        const dir = join(panelsDir, id);
        const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        const parts = storeUploadParts(manifest.store, (rel) => readFileSync(join(dir, rel)));
        expect(parts.about?.length).toBeGreaterThan(0);
        expect(parts.files.length).toBeGreaterThan(0);
    });
});


it("Linux x64 build input matches electron-builder while release name stays canonical", () => {
    expect(paperboardArtifacts("linux-x64", "0.1.0")).toEqual({ buildFile: "paperboard-0.1.0-linux-x86_64.AppImage", releaseFile: "paperboard-linux-x64.AppImage" });
});

