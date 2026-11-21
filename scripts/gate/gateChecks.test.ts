// The gate's shell checks, run for real against a throwaway tree. Each case is
// a hole a broken check would pass silently: a literal it should flag sitting
// next to the near miss it must let through.
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A repo root holding copies of `scripts` (in scripts/gate) and `files` (path → content).
function tree(scripts: string[], files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "paperboard-gatecheck-"));
    dirs.push(root);
    for (const s of scripts) cpSync(join(import.meta.dir, s), join(root, "scripts", "gate", s));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
    }
    return root;
}

function run(root: string, cmd: string[]): { code: number; out: string } {
    const r = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

describe("check-paperui-styling.sh: literal units in component CSS", () => {
    const check = (css: string) =>
        run(
            tree(["check-paperui-styling.sh"], {
                "packages/paperui/src/components/PaperX/index.module.css": css,
                "packages/paperui/src/templates/PaperT/index.module.css": ".t {}\n",
            }),
            ["bash", "scripts/gate/check-paperui-styling.sh"],
        );

    test.each([".a { padding: 10px; }", ".a { width: 120px; }", ".a { margin: 0px 12px; }"])(
        "flags %s",
        (css) => {
            const r = check(css);
            expect(r.code).toBe(1);
            expect(r.out).toContain("literal px/rem/em in component CSS");
        },
    );

    test.each([".a { margin: 0px; }", "@property --x { syntax: '<length>'; initial-value: 0px; }"])("passes %s", (css) => {
        expect(check(css)).toEqual({ code: 0, out: "ok: paperui styling invariant\n" });
    });
});

describe("check-todo-expiry.sh: due removals", () => {
    const check = (appVersion: string, todo: string) =>
        run(
            tree(["check-todo-expiry.sh"], {
                "apps/paperboard/package.json": JSON.stringify({ version: appVersion }),
                "src/a.ts": `// ${todo}\n`,
            }),
            ["bash", "scripts/gate/check-todo-expiry.sh"],
        );

    // versions compare as numbers: v0.9 is due at v0.10, and v0.11 is not
    test.each([
        ["0.10.0", "TODO(remove after v0.9)"],
        ["0.10.0", "TODO(deny after v0.10)"],
        ["1.0.0", "TODO(remove after v0.99)"],
    ])("at v%s, %s fails", (appVersion, todo) => {
        const r = check(appVersion, todo);
        expect(r.code).toBe(1);
        expect(r.out).toContain("FAIL: expired");
    });

    test.each([
        ["0.10.0", "TODO(remove after v0.11)"],
        ["0.9.0", "TODO(remove after v1.0)"],
    ])("at v%s, %s passes", (appVersion, todo) => {
        expect(check(appVersion, todo).code).toBe(0);
    });
});

describe("check-app-styling: hairlines are exempt, sizes are not", () => {
    const check = (css: string) => {
        const root = tree(["check-app-styling.sh", "check-app-styling.py"], { "panels/p/src/a.module.css": css });
        for (const cmd of [["git", "init", "-q"], ["git", "add", "panels"]]) expect(run(root, cmd).code).toBe(0);
        return run(root, ["bash", "scripts/gate/check-app-styling.sh", "panels/p"]);
    };

    test.each([".a { padding: 10px; }", ".a { margin: 1px 12px; }", ".a { width: 1.5px; }"])("warns on %s", (css) => {
        const r = check(css);
        expect(r.code).toBe(0);
        expect(r.out).toContain("size:");
    });

    test.each([".a { border: 1px solid; }", ".a { margin: 0px; }", ".a {\n    --gutter: 12px;\n}"])("passes %s", (css) => {
        expect(check(css)).toEqual({ code: 0, out: "ok: app styling\n" });
    });
});

describe("check-store-listing.ts: a panel's store block passes the publisher's validation", () => {
    const check = (store: unknown, files: Record<string, string> = {}) => {
        const root = tree([], { "manifest.json": JSON.stringify({ id: "dev.me", version: "0.1.0", store }), ...files });
        return { root, ...run(root, ["bun", join(import.meta.dir, "check-store-listing.ts"), root]) };
    };

    test("a broken listing fails with the panel and the reason", () => {
        const r = check({ about: "./store/about.md" });
        expect(r.code).toBe(1);
        expect(r.out).toContain(`FAIL: ${r.root} store listing:`);
        expect(r.out).toContain("ENOENT");
    });

    test("a listing whose files exist passes, and so does a manifest without one", () => {
        expect(check({ about: "./store/about.md" }, { "store/about.md": "# Me\n" }).code).toBe(0);
        expect(check(undefined).code).toBe(0);
    });
});
