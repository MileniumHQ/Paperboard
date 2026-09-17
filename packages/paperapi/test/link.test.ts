// link --force rename-to-trash discipline (T23g, bun test): the replaced
// panel directory remains recoverable after replacement.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { linkPanel } from "../src/link";

let homeTmp: string;
let sourceDir: string;
let savedHome: string | undefined;

beforeEach(() => {
    homeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "paperapi-link-"));
    sourceDir = path.join(homeTmp, "source");
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(
        path.join(sourceDir, "manifest.json"),
        JSON.stringify({ id: "dev.test.link", name: "Link Test" }),
    );
    savedHome = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = homeTmp;
});

afterEach(() => {
    if (savedHome === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedHome;
    fs.rmSync(homeTmp, { recursive: true, force: true });
});

describe("linkPanel force replace", () => {
    test("--force replaces a physical directory via a trash rename", () => {
        const panelsDir = path.join(homeTmp, "panels");
        const existing = path.join(panelsDir, "dev.test.link");
        fs.mkdirSync(existing, { recursive: true });
        fs.writeFileSync(path.join(existing, "keep-me.txt"), "old bytes");

        const res = linkPanel({ targetDir: sourceDir, force: true });

        expect(res.id).toBe("dev.test.link");
        // the link now points at the new source
        expect(fs.readlinkSync(res.linkPath)).toBe(sourceDir);
        // Recovery contains the actual previous bytes, not just a renamed entry.
        const entries = fs.readdirSync(panelsDir);
        const recovery = entries.find((name) => name.startsWith(".trash-"))!;
        expect(fs.readFileSync(path.join(panelsDir, recovery, "keep-me.txt"), "utf8")).toBe("old bytes");
    });

    test("--force on a directory without --force is refused", () => {
        const panelsDir = path.join(homeTmp, "panels");
        fs.mkdirSync(path.join(panelsDir, "dev.test.link"), {
            recursive: true,
        });
        expect(() => linkPanel({ targetDir: sourceDir })).toThrow(
            /already exists/,
        );
    });
});
