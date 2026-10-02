// link --force rename-to-trash discipline (T23g, bun test): the replaced
// panel directory remains recoverable after replacement.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { linkAllPanels, linkPanel } from "../src/link";

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
    test("--force replaces a physical directory and keeps no copy", () => {
        const panelsDir = path.join(homeTmp, "panels");
        const existing = path.join(panelsDir, "dev.test.link");
        fs.mkdirSync(existing, { recursive: true });
        fs.writeFileSync(path.join(existing, "keep-me.txt"), "old bytes");

        const res = linkPanel({ targetDir: sourceDir, force: true });

        expect(res.id).toBe("dev.test.link");
        // the link now points at the new source
        expect(fs.readlinkSync(res.linkPath)).toBe(sourceDir);
        expect(
            fs.readdirSync(panelsDir).filter((name) => name.startsWith(".trash-")),
        ).toEqual([]);
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

describe("linkAllPanels", () => {
    function makePanel(root: string, id: string): string {
        const dir = path.join(root, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, "manifest.json"),
            JSON.stringify({ id, name: id }),
        );
        return dir;
    }

    test("links every manifest directory and ignores non-panels", () => {
        const panelsRoot = path.join(homeTmp, "source-panels");
        makePanel(panelsRoot, "dev.test.one");
        makePanel(panelsRoot, "dev.test.two");
        fs.mkdirSync(path.join(panelsRoot, "not-a-panel"), { recursive: true });

        const result = linkAllPanels(panelsRoot);

        expect(result.skipped).toEqual([]);
        expect(result.linked.map((entry) => entry.id).sort()).toEqual([
            "dev.test.one",
            "dev.test.two",
        ]);
        expect(
            fs.readlinkSync(path.join(homeTmp, "panels", "dev.test.one")),
        ).toBe(path.join(panelsRoot, "dev.test.one"));
    });

    test("reports a physical target conflict instead of swallowing it", () => {
        const panelsRoot = path.join(homeTmp, "conflict-panels");
        makePanel(panelsRoot, "dev.test.conflict");
        // a registry install already occupies the target
        fs.mkdirSync(path.join(homeTmp, "panels", "dev.test.conflict"), {
            recursive: true,
        });

        const result = linkAllPanels(panelsRoot);

        expect(result.linked).toEqual([]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].reason).toMatch(/already exists/);
        // --force replaces it recoverably
        const forced = linkAllPanels(panelsRoot, { force: true });
        expect(forced.skipped).toEqual([]);
        expect(forced.linked[0].id).toBe("dev.test.conflict");
    });
});
