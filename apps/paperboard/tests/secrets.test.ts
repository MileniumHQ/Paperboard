// secrets vault unit tests (bun test); CredentialStore + engine purge
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CredentialStore, SECRET_MAX_LENGTH } from "../papercrane/credentials";
import { PaperCraneEngine } from "../papercrane/engine";

let tmp = "";
let store: CredentialStore;

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-test-"));
    store = new CredentialStore(tmp);
});

afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("CredentialStore", () => {
    it("round-trips set/get", () => {
        store.set("bot-token", "tok123", "dev.test.a");
        expect(store.get("bot-token", "dev.test.a")).toEqual({ found: true, value: "tok123" });
    });

    it("returns found:false with null value for unknown secrets", () => {
        expect(store.get("nope", "dev.test.a")).toEqual({ found: false, value: null });
    });

    it("lists names only, never widened past the addressed panel", () => {
        store.set("aaa", "v", "dev.test.list");
        store.set("bbb", "v", "dev.test.list2");
        expect(store.list("dev.test.list")).toEqual(["dev.test.list/aaa"]);
        expect(store.list("dev.test.list2")).toEqual(["dev.test.list2/bbb"]);
        expect(store.list("dev.test.list").every((k) => /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(k))).toBe(true);
    });

    it("rejects invalid panel ids at the boundary", () => {
        expect(() => store.set("x", "v", "../evil")).toThrow();
        expect(() => store.set("x", "v", "")).toThrow();
        // invalid panel id is a caller bug → fail loud; invalid name is a miss
        expect(() => store.get("x", "../etc")).toThrow();
        expect(() => store.delete("x", "../evil")).toThrow();
        expect(() => store.purge("../evil")).toThrow();
    });

    it("rejects invalid names", () => {
        expect(() => store.set("", "v", "dev.test.a")).toThrow();
        expect(() => store.set("has/slash", "v", "dev.test.a")).toThrow();
        expect(() => store.set("x".repeat(65), "v", "dev.test.a")).toThrow();
    });

    it("rejects empty and oversized values, accepts the exact cap", () => {
        expect(() => store.set("empty", "", "dev.test.a")).toThrow();
        expect(() => store.set("big", "x".repeat(SECRET_MAX_LENGTH + 1), "dev.test.a")).toThrow();
        store.set("edge", "x".repeat(SECRET_MAX_LENGTH), "dev.test.a");
        expect(store.get("edge", "dev.test.a").found).toBe(true);
    });

    it("persists across instances over the same file", () => {
        store.set("persisted", "yes", "dev.test.a");
        const reloaded = new CredentialStore(tmp);
        expect(reloaded.get("bot-token", "dev.test.a")).toEqual({ found: true, value: "tok123" });
        expect(reloaded.get("persisted", "dev.test.a")).toEqual({ found: true, value: "yes" });
    });

    it("deletes and reports existence", () => {
        store.set("gone", "v", "dev.test.a");
        expect(store.delete("gone", "dev.test.a")).toBe(true);
        expect(store.delete("gone", "dev.test.a")).toBe(false);
        expect(store.get("gone", "dev.test.a")).toEqual({ found: false, value: null });
    });

    it("purges only the target panel", () => {
        store.set("one", "v", "dev.test.purgeA");
        store.set("two", "v", "dev.test.purgeB");
        expect(store.purge("dev.test.purgeA")).toBe(1);
        expect(store.get("one", "dev.test.purgeA").found).toBe(false);
        expect(store.get("two", "dev.test.purgeB").found).toBe(true);
    });

    it("keeps setAt stable and stamps updatedAt on overwrite", () => {
        store.set("rev", "one", "dev.test.a");
        const firstFile = JSON.parse(fs.readFileSync(secretsFile(), "utf-8"))["dev.test.a/rev"];
        expect(firstFile.setAt).toBeString();
        expect(Object.keys(firstFile).sort()).toEqual(["setAt", "value"]);
        const overwrite = new CredentialStore(tmp); // fresh load proves persistence
        overwrite.set("rev", "two", "dev.test.a");
        const secondFile = JSON.parse(fs.readFileSync(secretsFile(), "utf-8"))["dev.test.a/rev"];
        expect(secondFile.value).toBe("two");
        expect(secondFile.updatedAt).toBeString();
        expect(secondFile.setAt).toBe(firstFile.setAt);
    });

    it("survives a corrupted store by starting empty", () => {
        const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-bad-"));
        fs.mkdirSync(path.join(badDir, "local"), { recursive: true });
        fs.writeFileSync(path.join(badDir, "local", "secrets.json"), "{not json");
        const bad = new CredentialStore(badDir);
        expect(bad.list("dev.test.a")).toEqual([]);
        bad.set("fresh", "v", "dev.test.a");
        expect(bad.get("fresh", "dev.test.a")).toEqual({ found: true, value: "v" });
        fs.rmSync(badDir, { recursive: true, force: true });
    });

    it("mode-locks the store file to owner-only", () => {
        const mode = fs.statSync(secretsFile()).mode & 0o777;
        expect(mode).toBe(0o600);
    });
});

describe("Engine integration", () => {
    it("keeps credentials in the restricted vault on uninstall for reinstalling", async () => {
        const etmp = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-engine-"));
        const engine = new PaperCraneEngine(etmp);
        engine.setSecret("tok", "v", "dev.test.panel");
        expect(engine.getSecret("tok", "dev.test.panel")).toEqual({ found: true, value: "v" });
        expect(engine.listSecrets("dev.test.panel")).toEqual(["dev.test.panel/tok"]);
        await engine.uninstallPanel("dev.test.panel");
        expect(engine.getSecret("tok", "dev.test.panel")).toEqual({ found: true, value: "v" });
        fs.rmSync(etmp, { recursive: true, force: true });
    });
});

function secretsFile(): string {
    return path.join(tmp, "local", "secrets.json");
}
