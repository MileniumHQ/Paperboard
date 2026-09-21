// publishLib proofs (bun test): tags, canonical asset names, download
// URLs, latest.yml feeds, version-record merges, and the legacy redirect
// map. The worker and publish.ts both build behavior on these, so the
// contract is pinned here.
import { describe, expect, it } from "bun:test";
import {
    ALL_TARGETS,
    assetFileName,
    buildLatestYml,
    dlFileUrl,
    isValidFileSegment,
    isValidVersionSegment,
    KV_PACKAGES_BINDING,
    kvKeyFor,
    legacyDownloadRedirect,
    mergeVersionRecord,
    PAPERDL_R2_BUCKET,
    r2YmlKey,
    releaseAssetUrl,
    tagFor,
    ymlKeyFor,
    type DlAppRecord,
} from "./publishLib";

describe("deploy targets", () => {
    it("pins the R2 bucket and KV binding from wrangler.jsonc", () => {
        expect(PAPERDL_R2_BUCKET).toBe("paperboard-paperdl");
        expect(KV_PACKAGES_BINDING).toBe("PACKAGES");
    });
});

describe("release tags and URLs", () => {
    it("tags carry the app so one repo hosts both lines", () => {
        expect(tagFor("pb", "3.0.0-alpha")).toBe("pb-v3.0.0-alpha");
        expect(tagFor("crane", "2.0.0-alpha")).toBe("crane-v2.0.0-alpha");
    });

    it("release assets address the GitHub tag, never Origami bytes", () => {
        expect(releaseAssetUrl("pb", "3.0.0-alpha", "paperboard-macos-x64.zip")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/pb-v3.0.0-alpha/paperboard-macos-x64.zip",
        );
        expect(releaseAssetUrl("crane", "2.0.0-alpha", "crane-linux-arm64.tar.gz")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/crane-v2.0.0-alpha/crane-linux-arm64.tar.gz",
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
