// The scoped gate decides what a pull request is allowed to skip, so a hole
// here lets a broken change merge green. Each case is a reference the graph
// must follow next to the near miss it must not.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allTargets, jobsOf, type Repo, scopeOf, workingRepo } from "./scope";

/** an in-memory repo: path → content */
function repo(files: Record<string, string>): Repo {
    return {
        files: Object.keys(files),
        read: (f) => {
            const text = files[f];
            if (text === undefined) throw new Error(`no file ${f}`);
            return text;
        },
    };
}

const pkg = (name: string, deps: Record<string, Record<string, string>> = {}) => JSON.stringify({ name, ...deps });

/** a small workspace shaped like the real one */
const BASE = {
    "packages/paperapi/package.json": pkg("@mileniumhq/paperapi"),
    "packages/paperapi/src/index.ts": "export const api = 1;\n",
    "packages/paperapi/test/api.test.ts": 'import { api } from "../src/index";\n',
    "packages/release/package.json": pkg("@mileniumhq/release"),
    "packages/release/src/index.ts": "export const sign = 1;\n",
    "apps/daemon/package.json": pkg("daemon", { dependencies: { "@mileniumhq/paperapi": "workspace:*" } }),
    "apps/daemon/src/main.ts": 'import { api } from "@mileniumhq/paperapi";\n',
    "apps/daemon/test/main.test.ts": 'import "../src/main";\n',
    "packages/testkit/package.json": pkg("testkit", { dependencies: { daemon: "workspace:*" } }),
    "packages/testkit/src/crane.ts": 'import "daemon";\n',
    "apps/paperboard/package.json": pkg("paperboard", { devDependencies: { daemon: "workspace:*", testkit: "workspace:*" } }),
    "apps/paperboard/src/main/index.ts": "export {};\n",
    "apps/paperboard/tests/platform/boot.test.ts": 'import "testkit/crane";\n',
    "panels/dev.paperboard.terminal/package.json": pkg("terminal", { devDependencies: { testkit: "workspace:*" } }),
    "panels/dev.paperboard.terminal/src/App.tsx": "export {};\n",
    "panels/dev.paperboard.terminal/README.md": "# Terminal\n",
    "panels/dev.paperboard.gameserver/package.json": pkg("gameserver", { devDependencies: { paperboard: "workspace:*" } }),
    "panels/dev.paperboard.gameserver/src/App.tsx": "export {};\n",
    "services/origami/package.json": pkg("origami"),
    "services/origami/src/index.ts": "export {};\n",
    "scripts/publish/publish.ts": "export {};\n",
    "scripts/publish/smoke.ts": "export {};\n",
    "scripts/publish/publish.test.ts": 'import "./publish";\n',
    "README.md": "# Paperboard\n",
};

const scope = (files: Record<string, string>, changed: string[]) => scopeOf(repo({ ...BASE, ...files }), changed);
const targets = (files: Record<string, string>, changed: string[]) => scope(files, changed).targets;

describe("ownership", () => {
    test("a panel's README reruns that panel and the repo-wide checks, nothing else", () => {
        expect(targets({}, ["panels/dev.paperboard.terminal/README.md"])).toEqual(["global", "terminal"]);
    });

    test("a file no target owns reruns only the repo-wide checks", () => {
        expect(targets({}, ["README.md"])).toEqual(["global"]);
        expect(targets({ "branding/logo.svg": "<svg/>" }, ["branding/logo.svg"])).toEqual(["global"]);
    });

    test("no change reruns nothing", () => {
        expect(scope({}, [])).toEqual({ targets: [], platform: false });
    });

    test("a deleted file is still owned by its folder", () => {
        expect(targets({}, ["services/origami/src/gone.ts"])).toEqual(["global", "origami"]);
    });

    test("the gate's tooling, the lockfile and the root manifest rerun everything", () => {
        const all = allTargets(repo(BASE));
        for (const f of ["bun.lock", "package.json", "scripts/gate/gate.sh", ".github/workflows/gate.yml"]) {
            expect(scope({}, [f])).toEqual({ targets: all, platform: true });
        }
        // a script outside scripts/gate is a script like any other
        expect(targets({}, ["scripts/publish/smoke.ts"])).toEqual(["global", "scripts"]);
    });

    test("the gate naming a part's files doesn't make the gate one of its consumers", () => {
        // gate.sh runs the app's checker; the publish scripts use the gate's own tsconfig
        const files = {
            "apps/paperboard/scripts/check.sh": "exit 0\n",
            "scripts/gate/gate.sh": 'bash "apps/paperboard/scripts/check.sh"\n',
            "scripts/gate/check.ts": "export {};\n",
            "services/origami/src/lint.ts": 'import "../../../scripts/gate/check";\n',
        };
        expect(targets(files, ["apps/paperboard/src/main/index.ts"])).toEqual(["gameserver", "global", "paperboard"]);
    });
});

describe("package dependencies", () => {
    test("a library's source reruns everything that runs it, and those that test against them", () => {
        // paperapi → daemon (runs it) → testkit (runs the daemon) → the app and terminal (test with testkit)
        expect(targets({}, ["packages/paperapi/src/index.ts"])).toEqual(["daemon", "global", "packages", "paperapi", "paperboard", "terminal", "testkit"]);
    });

    test("a devDependency reruns the consumer but stops there", () => {
        // gameserver builds against the app; the app changing reruns gameserver, gameserver's consumers (none) aside
        expect(targets({}, ["apps/paperboard/src/main/index.ts"])).toEqual(["gameserver", "global", "paperboard"]);
        // the app consumes the daemon only to test with it: the daemon's change doesn't reach gameserver through it
        expect(targets({}, ["apps/daemon/src/main.ts"])).not.toContain("gameserver");
    });

    test("a library's own test reruns only that library", () => {
        expect(targets({}, ["packages/paperapi/test/api.test.ts"])).toEqual(["global", "packages", "paperapi"]);
        expect(targets({}, ["apps/daemon/test/main.test.ts"])).toEqual(["daemon", "global"]);
    });

    test("a package no one depends on reruns only itself", () => {
        expect(targets({}, ["packages/release/src/index.ts"])).toEqual(["global", "release"]);
    });
});

describe("paths in strings", () => {
    test("a relative path into another part is followed", () => {
        const files = { "services/origami/src/sign.ts": 'import "../../../packages/release/src/index";\n' };
        expect(targets(files, ["packages/release/src/index.ts"])).toEqual(["global", "origami", "release"]);
    });

    test("a repo path and a path built from segments are followed when they exist", () => {
        const byPath = { "services/origami/src/sign.ts": 'const at = "packages/release/src/index.ts";\n' };
        expect(targets(byPath, ["packages/release/src/index.ts"])).toContain("origami");
        const bySegments = { "services/origami/src/sign.ts": 'join(root, "packages", "release", "src", "index.ts");\n' };
        expect(targets(bySegments, ["packages/release/src/index.ts"])).toContain("origami");
    });

    test("a path that doesn't exist is not a reference", () => {
        const files = { "services/origami/src/sign.ts": 'const route = "packages/release/latest";\n' };
        expect(targets(files, ["packages/release/src/index.ts"])).toEqual(["global", "release"]);
    });

    test("naming a part's whole folder is a place, not a use of its code", () => {
        const files = { "services/origami/src/sign.ts": 'spawn("bun", { cwd: "packages/release" });\n' };
        expect(targets(files, ["packages/release/src/index.ts"])).toEqual(["global", "release"]);
    });

    test("a folder inside a part stands for its files", () => {
        const files = { "services/origami/src/sign.ts": 'readdir("packages/release/src");\n' };
        expect(targets(files, ["packages/release/src/index.ts"])).toContain("origami");
    });

    test("a reference from a part's tests reruns that part, not its consumers", () => {
        const files = { "apps/daemon/test/sign.test.ts": 'import "../../../packages/release/src/index";\n' };
        const reached = targets(files, ["packages/release/src/index.ts"]);
        expect(reached).toContain("daemon");
        expect(reached).not.toContain("testkit");
        expect(reached).not.toContain("paperboard");
    });

    test("another part's tests using a fixture rerun when the fixture changes", () => {
        const files = {
            "packages/release/test/fixtures/key.json": "{}",
            "services/origami/test/sign.test.ts": 'read("../../../packages/release/test/fixtures/key.json");\n',
        };
        expect(targets(files, ["packages/release/test/fixtures/key.json"])).toEqual(["global", "origami", "release"]);
        // a private file nobody else points at stays private
        expect(targets(files, ["packages/release/test/other.test.ts"])).toEqual(["global", "release"]);
    });
});

describe("root scripts", () => {
    test("each script is its own node: a reference to one doesn't tie in the rest", () => {
        const files = { "services/origami/src/link.ts": 'import "../../../scripts/publish/publish";\n' };
        expect(targets(files, ["scripts/publish/publish.ts"])).toEqual(["global", "origami", "scripts"]);
        expect(targets(files, ["scripts/publish/smoke.ts"])).toEqual(["global", "scripts"]);
    });

    test("a script's test is private to it", () => {
        const files = { "services/origami/src/link.ts": 'import "../../../scripts/publish/publish";\n' };
        expect(targets(files, ["scripts/publish/publish.test.ts"])).toEqual(["global", "scripts"]);
    });
});

describe("what else a scope turns on", () => {
    test("a packed library reruns the consumer check", () => {
        expect(targets({}, ["packages/paperapi/test/api.test.ts"])).toContain("packages");
        expect(targets({}, ["services/origami/src/index.ts"])).not.toContain("packages");
    });

    test("the cross-platform suites run only when a target that has one is reached", () => {
        expect(scope({}, ["apps/paperboard/src/main/index.ts"]).platform).toBe(true);
        expect(scope({}, ["services/origami/src/index.ts"]).platform).toBe(false);
        expect(scope({}, ["README.md"]).platform).toBe(false);
    });
});

describe("jobsOf", () => {
    test("the long suites run alone, the libraries and the web apps share a job each", () => {
        expect(jobsOf(["arilink", "daemon", "global", "origami", "paperapi", "terminal"])).toEqual([
            { name: "web", targets: "arilink origami" },
            { name: "daemon", targets: "daemon" },
            { name: "libraries", targets: "global paperapi" },
            { name: "terminal", targets: "terminal" },
        ]);
        expect(jobsOf([])).toEqual([]);
    });
});

describe("this repository", () => {
    const here = workingRepo();
    const known = readFileSync(join(import.meta.dir, "gate.sh"), "utf8")
        .match(/^KNOWN_TARGETS="([^"]+)"/m)![1]!
        .split(" ")
        .filter((t) => !t.endsWith("-build") && t !== "platform");

    test("every gate target is one the scope can pick, and every pick is a gate target", () => {
        expect(allTargets(here)).toEqual([...known].sort());
    });

    test("every job a full run makes names only gate targets", () => {
        const jobs = jobsOf(allTargets(here));
        expect(jobs.flatMap((j) => j.targets.split(" ")).sort()).toEqual([...known].sort());
    });

    test("a panel's README, the root README and a release script stay small", () => {
        expect(scopeOf(here, ["panels/dev.paperboard.terminal/README.md"]).targets).toEqual(["global", "terminal"]);
        expect(scopeOf(here, ["README.md"])).toEqual({ targets: ["global"], platform: false });
        expect(scopeOf(here, ["scripts/publish/releaseSmoke.ts"]).targets).toEqual(["global", "scripts"]);
    });

    test("the daemon reaches every panel through the test harness", () => {
        const reached = scopeOf(here, ["apps/daemon/src/core/logger.ts"]);
        for (const t of ["agents", "blocks", "botcreator", "gameserver", "terminal", "testkit", "paperboard"]) expect(reached.targets).toContain(t);
        expect(reached.platform).toBe(true);
    });

    test("PaperAPI's source reaches every panel and the app", () => {
        const reached = scopeOf(here, ["packages/paperapi/src/index.ts"]).targets;
        for (const t of ["agents", "blocks", "botcreator", "gameserver", "terminal", "paperboard", "packages"]) expect(reached).toContain(t);
    });
});
