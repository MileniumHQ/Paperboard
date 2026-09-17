import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    writeFileAtomic,
    writeJsonAtomicSync,
    readJsonFileSync,
    sanitizeId,
    resolveSecureTargetPath,
    validatePanelManifest,
    coerceRegistryRecord,
    makeSafeTarFilter,
} from "../papercrane/storage";

let tmp: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-storage-"));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("atomic writes", () => {
    it("writeFileAtomic writes content", async () => {
        const file = path.join(tmp, "sub", "file.txt");
        await writeFileAtomic(file, "hello");
        expect(fs.readFileSync(file, "utf8")).toBe("hello");
    });

    it("writeJsonAtomicSync round-trips JSON and leaves no temp files", () => {
        const file = path.join(tmp, "state.json");
        writeJsonAtomicSync(file, { a: 1 });
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ a: 1 });
        const leftovers = fs.readdirSync(tmp).filter((f) => f.includes(".tmp-"));
        expect(leftovers).toEqual([]);
    });

    it("writeJsonAtomicSync overwrites existing file cleanly", () => {
        const file = path.join(tmp, "state.json");
        writeJsonAtomicSync(file, { v: 1 });
        writeJsonAtomicSync(file, { v: 2 });
        expect(readJsonFileSync(file, null)).toEqual({ v: 2 });
    });

    it("readJsonFileSync returns fallback for missing or corrupt files", () => {
        expect(readJsonFileSync(path.join(tmp, "nope.json"), { d: 1 })).toEqual({ d: 1 });
        const bad = path.join(tmp, "bad.json");
        fs.writeFileSync(bad, "{not json", "utf8");
        expect(readJsonFileSync(bad, [])).toEqual([]);
    });
});

describe("sanitizeId", () => {
    it("accepts normal ids", () => {
        expect(sanitizeId("com.example.terminal")).toBe("com.example.terminal");
        expect(sanitizeId("game-server_2")).toBe("game-server_2");
    });

    it("rejects traversal and unsafe ids", () => {
        expect(sanitizeId("../etc")).toBeNull();
        expect(sanitizeId("..")).toBeNull();
        expect(sanitizeId(".hidden")).toBeNull();
        expect(sanitizeId("a/b")).toBeNull();
        expect(sanitizeId("a\\b")).toBeNull();
        expect(sanitizeId("")).toBeNull();
        expect(sanitizeId(undefined)).toBeNull();
        expect(sanitizeId("space id")).toBeNull();
    });
});

describe("resolveSecureTargetPath", () => {
    const baseDir = path.join("/data", "apps");

    it("resolves simple relative paths inside the app dir", () => {
        expect(resolveSecureTargetPath(baseDir, "server.properties", "myapp")).toBe(
            path.resolve(baseDir, "myapp/server.properties"),
        );
    });

    it("strips leading slashes so absolute-looking paths stay contained", () => {
        expect(resolveSecureTargetPath(baseDir, "/etc/passwd", "myapp")).toBe(
            path.resolve(baseDir, "myapp/etc/passwd"),
        );
    });

    it("rejects .. traversal outside the app dir", () => {
        expect(() => resolveSecureTargetPath(baseDir, "../../etc/crontab", "myapp")).toThrow();
        expect(() => resolveSecureTargetPath(baseDir, "..", "myapp")).toThrow();
    });

    it("rejects sibling directories that share the prefix", () => {
        expect(() =>
            resolveSecureTargetPath(baseDir, "../myapp-evilest/x.txt", "myapp"),
        ).toThrow();
    });

    it("allows internal navigation that stays inside the app dir", () => {
        const resolved = resolveSecureTargetPath(baseDir, "world/../config.yml", "myapp");
        expect(resolved).toBe(path.resolve(baseDir, "myapp/config.yml"));
    });

    it("sanitizes unsafe characters in appId", () => {
        const resolved = resolveSecureTargetPath(baseDir, "x.txt", "../../evil");
        expect(resolved.startsWith(path.resolve(baseDir) + path.sep)).toBe(true);
    });
});

describe("validatePanelManifest", () => {
    it("accepts a valid manifest and fills fallback id", () => {
        const m = validatePanelManifest({ name: "Terminal" }, "com.example.terminal");
        expect(m.id).toBe("com.example.terminal");
        expect(m.name).toBe("Terminal");
    });

    it("refuses malformed and mismatched manifest identities without rewriting them", () => {
        expect(() => validatePanelManifest({ id: "../../evil", name: "X" }, "safe-id")).toThrow();
        expect(() => validatePanelManifest({ id: "panel.b" }, "panel.a")).toThrow(/does not match/);
    });

    it("rejects non-object manifests", () => {
        expect(() => validatePanelManifest(null, "id")).toThrow();
        expect(() => validatePanelManifest([1, 2], "id")).toThrow();
        expect(() => validatePanelManifest("string", "id")).toThrow();
    });

    it("drops the deleted permissions field instead of preserving it", () => {
        const m = validatePanelManifest(
            { name: "T", permissions: ["terminal.create", 42] },
            "id",
        );
        expect("permissions" in m).toBe(false);
        expect(m.name).toBe("T");
    });

    it("rejects absolute base paths", () => {
        expect(() =>
            validatePanelManifest({ base: "/etc/passwd" }, "id"),
        ).toThrow(/base/);
    });

    it("rejects base paths containing ..", () => {
        expect(() =>
            validatePanelManifest({ base: "dist/../../escape.html" }, "id"),
        ).toThrow(/base/);
    });

    it("accepts relative base paths", () => {
        const m = validatePanelManifest({ base: "./dist/index.html" }, "id");
        expect(m.base).toBe("./dist/index.html");
    });

    it("bounds field lengths", () => {
        const m = validatePanelManifest({ name: "x".repeat(10_000) }, "id");
        expect((m.name as string).length).toBeLessThanOrEqual(128);
    });
});

describe("coerceRegistryRecord", () => {
    it("falls back to safe defaults on garbage input", () => {
        const r = coerceRegistryRecord(null, "fallback");
        expect(r.id).toBe("fallback");
        expect(r.name).toBe("fallback");
    });

    it("drops dangerous ids", () => {
        const r = coerceRegistryRecord({ id: "../evil" }, "fallback");
        expect(r.id).toBe("fallback");
    });

    it("keeps valid fields", () => {
        const r = coerceRegistryRecord(
            { id: "terminal", name: "Terminal", version: "2.1.0", sha256: "abc123" },
            "fallback",
        );
        expect(r.id).toBe("terminal");
        expect(r.version).toBe("2.1.0");
        expect(r.sha256).toBe("abc123");
    });
});

describe("makeSafeTarFilter", () => {
    it("allows normal relative entries", () => {
        const filter = makeSafeTarFilter("/dest");
        expect(filter("dist/index.html")).toBe(true);
        expect(filter("./assets/logo.png")).toBe(true);
    });

    it("rejects absolute and traversal entries", () => {
        const filter = makeSafeTarFilter("/dest");
        expect(filter("/etc/passwd")).toBe(false);
        expect(filter("../outside.txt")).toBe(false);
        expect(filter("dist/../../../outside")).toBe(false);
    });
});
