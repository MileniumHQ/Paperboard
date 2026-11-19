// The scoped gate decides what a pull request is allowed to skip, so a hole
// here lets a broken change merge green. Each case is a reference the graph
// must follow next to the near miss it must not.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { allTargets, baseRepo, changedSince, jobsOf, type Repo, routesOf, scopeOf, workingRepo } from "./scope";

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

    test("a deleted file still reaches the parts that used it, through the base the branch left", () => {
        // the release library's sign.ts is gone, and the daemon still imports it: a break only the daemon's checks see
        const before = { ...BASE, "packages/release/src/sign.ts": "export const sign = 1;\n", "apps/daemon/src/main.ts": 'import "../../../packages/release/src/sign";\n' };
        const after = { ...before };
        delete (after as Record<string, string>)["packages/release/src/sign.ts"];
        const changed = ["packages/release/src/sign.ts"];
        expect(scopeOf(repo(after), changed).targets).not.toContain("daemon");
        const reached = scopeOf(repo(after), changed, repo(before)).targets;
        for (const t of ["release", "daemon", "testkit", "terminal"]) expect(reached).toContain(t);
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

    test("a dependency no shipped file imports reruns the consumer but stops there", () => {
        // gameserver builds against the app; the app changing reruns gameserver, gameserver's consumers (none) aside
        expect(targets({}, ["apps/paperboard/src/main/index.ts"])).toEqual(["gameserver", "global", "paperboard"]);
        // the app consumes the daemon only to test with it: the daemon's change doesn't reach gameserver through it
        expect(targets({}, ["apps/daemon/src/main.ts"])).not.toContain("gameserver");
    });

    test("a devDependency the shipped code imports is shipped: its change goes on to the consumer's consumers", () => {
        // the app's main process bundles the daemon, whichever list in package.json names it
        const files = { "apps/paperboard/src/main/index.ts": 'import { start } from "daemon/src/main";\n' };
        expect(targets(files, ["apps/daemon/src/main.ts"])).toContain("gameserver");
        // and a runtime dependency only the tests import is a test dependency
        const testOnly = { "packages/testkit/src/crane.ts": "export {};\n", "packages/testkit/test/crane.test.ts": 'import "daemon";\n' };
        const reached = targets(testOnly, ["apps/daemon/src/main.ts"]);
        expect(reached).toContain("testkit");
        expect(reached).not.toContain("terminal");
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

describe("what a part ships", () => {
    test("its build config is public: a change to it reruns the part's consumers", () => {
        const files = { "packages/paperapi/vite.config.ts": "export default {};\n", "packages/paperapi/tsconfig.json": "{}" };
        for (const config of Object.keys(files)) expect(targets(files, [config])).toContain("daemon");
    });

    test("its tests, their configs and its tooling are not", () => {
        const files = {
            "packages/paperapi/vitest.config.ts": "export default {};\n",
            "packages/paperapi/test/setup.ts": "export {};\n",
            "packages/paperapi/scripts/bump.ts": "export {};\n",
        };
        for (const f of Object.keys(files)) expect(targets(files, [f])).toEqual(["global", "packages", "paperapi"]);
    });

    test("a script the part's build runs ships, wherever it sits", () => {
        const files = {
            "packages/paperapi/package.json": JSON.stringify({ name: "@mileniumhq/paperapi", scripts: { build: "tsc && bun scripts/bundle.ts", test: "bun scripts/check.ts" } }),
            "packages/paperapi/scripts/bundle.ts": "export {};\n",
            "packages/paperapi/scripts/check.ts": "export {};\n",
        };
        expect(targets(files, ["packages/paperapi/scripts/bundle.ts"])).toContain("daemon");
        expect(targets(files, ["packages/paperapi/scripts/check.ts"])).not.toContain("daemon");
    });

    test("an edge to a private file covers what that file uses, in its part or another", () => {
        // the publish script compiles in origami's tooling, which compiles in its helper and the release library
        const files = {
            "services/origami/scripts/lib/publish.ts": 'import "./wrangler";\n',
            "services/origami/scripts/lib/wrangler.ts": 'import "../../../../packages/release/src/index";\n',
            "scripts/publish/publish.ts": 'import "../../services/origami/scripts/lib/publish";\n',
        };
        expect(targets(files, ["services/origami/scripts/lib/wrangler.ts"])).toContain("scripts");
        expect(targets(files, ["packages/release/src/index.ts"])).toContain("scripts");
        // origami's other tooling stays out of it
        expect(targets({ ...files, "services/origami/scripts/other.ts": "export {};\n" }, ["services/origami/scripts/other.ts"])).toEqual(["global", "origami"]);
    });
});

describe("joins from the repo root", () => {
    const REPO_DIR = { "packages/testkit/src/root.ts": 'export const REPO_DIR = path.resolve(import.meta.dir, "../../..");\n' };

    test("follow the constants that name the root and the segments, here and imported", () => {
        const files = {
            ...REPO_DIR,
            "apps/daemon/test/terminal.test.ts": [
                'import { REPO_DIR } from "testkit/root";',
                'const PANEL = "dev.paperboard.terminal";',
                'const SOURCE = path.join(REPO_DIR, "panels", PANEL);',
                'build(path.join(SOURCE, "src", "App.tsx"));',
                'read(path.join(SOURCE, "package.json"));',
            ].join("\n"),
        };
        expect(targets(files, ["panels/dev.paperboard.terminal/src/App.tsx"])).toContain("daemon");
        expect(targets(files, ["panels/dev.paperboard.terminal/package.json"])).toContain("daemon");
        // the panel's own tests stay out of it
        expect(targets({ ...files, "panels/dev.paperboard.terminal/test/unit.test.ts": "export {};\n" }, ["panels/dev.paperboard.terminal/test/unit.test.ts"])).not.toContain("daemon");
    });

    test("one that goes on past a folder of parts with a variable reaches every part in it", () => {
        const files = {
            ...REPO_DIR,
            "apps/daemon/test/panels.test.ts": 'import { REPO_DIR } from "testkit/root";\nfor (const id of ids) build(path.join(REPO_DIR, "panels", id));\n',
        };
        expect(targets(files, ["panels/dev.paperboard.terminal/README.md"])).toContain("daemon");
        expect(targets(files, ["panels/dev.paperboard.gameserver/src/App.tsx"])).toContain("daemon");
        expect(targets(files, ["services/origami/src/index.ts"])).not.toContain("daemon");
    });

    test("one relative to the file reaches the folder it names", () => {
        const files = { "scripts/publish/panels.test.ts": 'const PANELS = join(import.meta.dir, "..", "..", "panels");\n' };
        expect(targets(files, ["panels/dev.paperboard.terminal/README.md"])).toContain("scripts");
    });

    test("one from a folder that isn't the repo is no reference", () => {
        // a data folder has a panels/ of its own
        const files = { "packages/testkit/src/fs.ts": 'export const panelDir = (dataDir, id) => path.join(dataDir, "panels", id);\n' };
        expect(targets(files, ["panels/dev.paperboard.terminal/src/App.tsx"])).toEqual(["global", "terminal"]);
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

    test("the cross-platform suites run only when a change reaches one", () => {
        const files = { "panels/dev.paperboard.terminal/test/platform/pty.test.ts": 'import "../../src/App";\n' };
        // a part's suite tests that part's code
        expect(scope(files, ["apps/paperboard/src/main/index.ts"]).platform).toBe(true);
        expect(scope(files, ["panels/dev.paperboard.terminal/src/App.tsx"]).platform).toBe(true);
        // its other tests aren't what the suite runs
        expect(scope({ ...files, "panels/dev.paperboard.terminal/test/unit.test.ts": "export {};\n" }, ["panels/dev.paperboard.terminal/test/unit.test.ts"])).toEqual({ targets: ["global", "terminal"], platform: false });
        // the suite itself reruns its part, where Linux runs it, and the runners
        expect(scope(files, ["panels/dev.paperboard.terminal/test/platform/pty.test.ts"])).toEqual({ targets: ["global", "terminal"], platform: true });
        expect(scope(files, ["services/origami/src/index.ts"]).platform).toBe(false);
        expect(scope(files, ["README.md"]).platform).toBe(false);
    });
});

describe("a branch in git", () => {
    test("deleting a file a part imports reaches that part, from git's own record of the branch", () => {
        const root = mkdtempSync(join(tmpdir(), "scope-"));
        try {
            const git = (...args: string[]) => {
                const out = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: root, stderr: "pipe" });
                if (out.exitCode !== 0) throw new Error(out.stderr.toString());
            };
            const files = { ...BASE, "packages/release/src/sign.ts": "export const sign = 1;\n", "apps/daemon/src/main.ts": 'import "../../../packages/release/src/sign";\n' };
            for (const [f, text] of Object.entries(files)) {
                mkdirSync(dirname(join(root, f)), { recursive: true });
                writeFileSync(join(root, f), text);
            }
            git("init", "-q", "-b", "main");
            git("add", "-A");
            git("commit", "-qm", "base");
            git("switch", "-qc", "drop-sign");
            git("rm", "-q", "packages/release/src/sign.ts");
            writeFileSync(join(root, "packages/release/src/index.ts"), "export const signed = 1;\n");
            git("commit", "-qam", "drop sign");

            const head = workingRepo(root);
            const changed = changedSince("main", root);
            expect(changed.sort()).toEqual(["packages/release/src/index.ts", "packages/release/src/sign.ts"]);
            const base = baseRepo(head, "main", root);
            // the base has the deleted file back, and the changed one as it was
            expect(base.files).toContain("packages/release/src/sign.ts");
            expect(base.read("packages/release/src/index.ts")).toBe("export const sign = 1;\n");
            expect(scopeOf(head, changed, base).targets).toContain("daemon");
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("routesOf", () => {
    test("each target carries the route that reached it, nearest part first", () => {
        const routes = routesOf(repo(BASE), ["packages/paperapi/src/index.ts"]);
        expect(routes.get("paperapi")).toEqual(["packages/paperapi/src/index.ts"]);
        expect(routes.get("terminal")).toEqual(["packages/paperapi/src/index.ts", "apps/daemon", "packages/testkit", "panels/dev.paperboard.terminal"]);
        expect(routes.get("packages")?.at(-1)).toContain("consumer check");
        expect(routes.get("global")?.at(-1)).toContain("repo-wide");
        expect(routesOf(repo(BASE), ["bun.lock"]).get("terminal")).toEqual(["bun.lock", "(a change here reruns every target)"]);
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

    test("the root README and a release script stay small", () => {
        expect(scopeOf(here, ["README.md"])).toEqual({ targets: ["global"], platform: false });
        expect(scopeOf(here, ["scripts/publish/releaseSmoke.ts"]).targets).toEqual(["global", "scripts"]);
    });

    test("a panel reruns the suites that read every panel: the app's, the boot test's runners, the store's", () => {
        // a README can be the store listing, so the store's checks read it too
        const readme = scopeOf(here, ["panels/dev.paperboard.terminal/README.md"]);
        for (const t of ["terminal", "paperboard", "scripts"]) expect(readme.targets).toContain(t);
        expect(readme.platform).toBe(true);
        expect(readme.targets).not.toContain("daemon");
    });

    test("Bot Creator's service reaches the daemon test that builds and runs it", () => {
        for (const change of ["panels/dev.paperboard.botcreator/src/service.ts", "panels/dev.paperboard.botcreator/manifest.json"]) {
            const reached = scopeOf(here, [change]);
            for (const t of ["botcreator", "daemon", "paperboard", "scripts"]) expect({ change, t, reached: reached.targets.includes(t) }).toEqual({ change, t, reached: true });
            expect(reached.platform).toBe(true);
        }
        // and another panel doesn't reach that test
        expect(scopeOf(here, ["panels/dev.paperboard.terminal/src/App.tsx"]).targets).not.toContain("daemon");
    });

    test("the daemon reaches every panel through the test harness", () => {
        const reached = scopeOf(here, ["apps/daemon/src/core/logger.ts"]);
        for (const t of ["agents", "blocks", "botcreator", "gameserver", "terminal", "testkit", "paperboard"]) expect(reached.targets).toContain(t);
        expect(reached.platform).toBe(true);
    });

    test("the services and the launcher don't reach the panels: the daemon's build reads only the target table", () => {
        for (const change of ["services/origami/src/index.ts", "packages/npx/src/cli.ts", "scripts/publish/publishLib.ts", "apps/paperboard/src/renderer/src/App.tsx"]) {
            const reached = scopeOf(here, [change]).targets;
            for (const t of ["agents", "blocks", "botcreator", "gameserver", "terminal", "testkit", "daemon"]) expect({ change, reached: reached.includes(t) }).toEqual({ change, reached: false });
        }
        expect(scopeOf(here, ["scripts/build/targets.ts"]).targets).toContain("terminal");
    });

    test("PaperAPI's source reaches every panel and the app", () => {
        const reached = scopeOf(here, ["packages/paperapi/src/index.ts"]).targets;
        for (const t of ["agents", "blocks", "botcreator", "gameserver", "terminal", "paperboard", "packages"]) expect(reached).toContain(t);
    });
});
