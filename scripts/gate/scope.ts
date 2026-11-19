#!/usr/bin/env bun
// Which gate targets a change can reach, so a pull request runs those and no
// others: a typo in a panel's README runs that panel's gate, not the whole
// repository's.
//
// Usage: bun scripts/gate/scope.ts [--base <ref> | --all] [--github | --why <target>]
//   Compares HEAD with --base (default origin/main) and prints the targets,
//   one per line; --all picks every target. --github writes the CI job matrix
//   and the platform switch to $GITHUB_OUTPUT instead; --why prints the route
//   that made a target run. How it decides: README.md beside this file.
//
// Each target owns a folder (a panel's is found under panels/, so a new panel
// needs no entry here), and a target reaches another when its files point
// into it: a workspace package they import, a relative path, a repo path in a
// string ("apps/daemon/src/main.ts"), one built from segments ("apps",
// "daemon"), or a join() from the repo root through the constants that name
// it. A path counts only when it exists, so URLs and ids that look like paths
// don't. A join that goes on past what it can resolve (a loop over panel ids)
// reaches every part under the folder it got to. A change reaches its owner
// and every target that reaches the owner, transitively. The gate's own
// tooling, the lockfile and the root package.json reach everything. A file no
// target owns (the root's markdown, branding/, the release workflow) reaches
// none. Each part's test/platform folder is a node of its own: the
// cross-platform runners start only when a change reaches one.
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** the folder each target with code owns; panels are added from panels/ */
const TARGET_DIRS: Record<string, string> = {
    daemon: "apps/daemon",
    paperboard: "apps/paperboard",
    paperdocs: "apps/paperdocs",
    origami: "services/origami",
    library: "services/library",
    arilink: "services/arilink",
    panelapis: "services/panelapis",
    paperapi: "packages/paperapi",
    paperui: "packages/paperui",
    "create-panel": "packages/create-panel",
    release: "packages/release",
    testkit: "packages/testkit",
    npx: "packages/npx",
    scripts: "scripts",
};

/**
 * The root scripts are a toolbox, not one program: each file is a node of the
 * scripts target of its own, so the release smoke test reaching into the
 * app's suites doesn't tie the app to everything that builds a supervisor.
 */
const isScriptFile = (f: string) => f.startsWith("scripts/") && !f.startsWith("scripts/gate/");

/** a change here reruns every target: what decides how the gate runs */
const FULL_GATE = [
    "bun.lock",
    "package.json",
    "scripts/gate/",
    ".github/workflows/gate.yml",
    "apps/paperboard/scripts/check-no-silent-catches.sh",
];
/**
 * Whether a change to `path` reruns everything. The gate's tooling names every
 * part (that is how it runs them), so it is no consumer of any; and a part
 * using it is rerun by any change to it anyway: the graph leaves it out.
 */
const isGateTooling = (path: string) => FULL_GATE.some((f) => (f.endsWith("/") ? path.startsWith(f) : path === f));

/** the route key of the cross-platform suites, which run on every release target but linux-x64 */
const PLATFORM = "platform";

/** the targets with no folder of their own, and what they check */
const PACKED = ["paperapi", "paperui", "create-panel"]; // `packages`: the packed libraries as a consumer gets them

const SCANNED = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|jsonc|toml|ya?ml|sh|html|css)$/;
const RELATIVE = /["'`](\.{1,2}\/[^"'`\s$]*)["'`]/g;
const REPO_PATH = /["'`]((?:apps|packages|panels|services|scripts)\/[^"'`\s$]+)["'`]/g;
const SEGMENTED = /["'`](?:apps|packages|panels|services|scripts)["'`](?:\s*,\s*["'`][\w.@-]+["'`])+/g;
/** an imported package's name (`@scope/name` or `name`, before any subpath): `from "x"`, `import "x"`, `import("x")`, `require("x")` */
const PACKAGE = /(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*["'`]((?:@[\w.-]+\/)?[\w.-]+)(?:\/[^"'`\s]*)?["'`]/g;

export interface Scope {
    /** gate targets, sorted; empty when nothing a target owns changed */
    targets: string[];
    /** whether the cross-platform suites can be reached */
    platform: boolean;
}

export interface Repo {
    /** every tracked file, repo-relative with forward slashes */
    files: string[];
    read: (file: string) => string;
}

/** a node of the graph: a target's folder, one root script, or a part's cross-platform suite */
export interface Node {
    dir: string;
    target: string;
    /** a test/platform folder: reaching it also starts the cross-platform runners */
    platform?: true;
    /** the files the part's own build runs (package.json's build, prepare, prepack), which ship wherever they sit */
    builds?: Set<string>;
}

const BUILD_SCRIPTS = ["build", "prepare", "prepack", "prepublishOnly"];

/** the files a part's package.json has its build run: `bun scripts/x.ts`, `node ./y.mjs`, `bash z.sh` */
function buildsOf(repo: Repo, dir: string): Set<string> | undefined {
    const manifest = `${dir}/package.json`;
    if (!repo.files.includes(manifest)) return undefined;
    const { scripts = {} } = JSON.parse(repo.read(manifest)) as { scripts?: Record<string, string> };
    const run = new Set<string>();
    for (const name of BUILD_SCRIPTS) {
        for (const m of String(scripts[name] ?? "").matchAll(/(?:^|\s)(?:\.\/)?([\w./-]+\.(?:ts|mts|js|mjs|cjs|sh))(?=\s|$)/g)) run.add(posix.join(dir, m[1]!));
    }
    return run;
}

export function nodesOf(repo: Repo): Node[] {
    const nodes: Node[] = Object.entries(TARGET_DIRS).map(([target, dir]) => ({ dir, target, builds: buildsOf(repo, dir) }));
    for (const f of repo.files) if (isScriptFile(f)) nodes.push({ dir: f, target: "scripts" });
    const panels = new Set(repo.files.filter((f) => /^panels\/[^/]+\/package\.json$/.test(f)).map((f) => f.split("/")[1]!));
    for (const panel of panels) nodes.push({ dir: `panels/${panel}`, target: panel.replace(/^dev\.paperboard\./, ""), builds: buildsOf(repo, `panels/${panel}`) });
    // the longest folder wins, so services/library is not services/
    nodes.sort((a, b) => b.dir.length - a.dir.length);
    const suites = new Set(repo.files.map((f) => f.match(/^(.+?\/tests?\/platform)\//)?.[1]).filter((d): d is string => d !== undefined));
    for (const dir of suites) {
        const owner = ownerOf(nodes, dir);
        if (owner) nodes.push({ dir, target: owner.target, platform: true });
    }
    return nodes.sort((a, b) => b.dir.length - a.dir.length);
}

const under = (path: string, dir: string) => path === dir || path.startsWith(dir + "/");

/** the node a path belongs to, if any target owns it */
function ownerOf(nodes: Node[], path: string): Node | undefined {
    return nodes.find((n) => under(path, n.dir));
}

/**
 * A file is private to its part when only that part's own checks and tools
 * use it: its tests, their fixtures and configs, its scripts/ and dev/
 * tooling (but a script its build runs). Everything else can shape what
 * other parts get (a build config, a README that is a store listing or ships
 * in the package), so it is public unless it is surely not: a wrong
 * private skips a target a change can break, a wrong public only runs one
 * more. A private reference reruns the part that makes it; a public one also
 * reruns every part that consumes that part's code.
 */
export function isPrivate(node: Node, file: string): boolean {
    if (node.platform) return true;
    if (node.builds?.has(file)) return false;
    const inside = file.slice(node.dir.length + 1) || posix.basename(file);
    return (
        /(^|\/)(tests?|__tests__|fixtures|scripts|dev)\//.test(inside) ||
        /\.(test|spec)\.[a-z]+$/.test(inside) ||
        /(^|\/)(vitest|playwright)\.config\.[a-z]+$/.test(inside)
    );
}

/** a value a join can be built from: a repo path ("" is the root), a literal segment, or nothing known */
type Value = { path: string } | { literal: string } | undefined;

const STRING = /^(["'`])([^"'`$]*)\1$/;
const HERE = /^(import\.meta\.dirname|import\.meta\.dir|__dirname|(?:path\.)?dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\))$/;
const JOIN = /\b(?:path\.)?(?:join|resolve)\(/g;
const CONST = /\bconst\s+(\w+)\s*(?::[^=]+)?=\s*/g;

/** the arguments of the call whose "(" ends at `open`, split at its own commas, and where the call ends */
function argsAt(text: string, open: number): { args: string[]; end: number } | undefined {
    const args: string[] = [];
    let depth = 0;
    let start = open;
    let quote = "";
    for (let i = open; i < text.length; i++) {
        const c = text[i]!;
        if (quote) {
            if (c === quote && text[i - 1] !== "\\") quote = "";
        } else if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
            if (--depth === 0) {
                args.push(text.slice(start + 1, i).trim());
                return { args: args.filter(Boolean), end: i + 1 };
            }
        } else if (c === "," && depth === 1) {
            args.push(text.slice(start + 1, i).trim());
            start = i;
        }
    }
    return undefined;
}

/**
 * Joins `args` from a known repo path, as path.join and path.resolve do:
 * `path` is how far it resolved, and `rest` whether an argument it can't
 * resolve (a variable, a call) comes after. Undefined when the first argument
 * isn't a repo path (a data folder, a temp folder) or the path leaves the repo.
 */
function joined(args: string[], value: (expr: string) => Value): { path: string; rest: boolean } | undefined {
    const first = value(args[0] ?? "");
    if (!first || !("path" in first)) return undefined;
    let at = first.path;
    for (const arg of args.slice(1)) {
        const v = value(arg);
        if (!v || !("literal" in v)) return { path: at, rest: true };
        at = posix.join(at, v.literal);
        if (at === ".." || at.startsWith("../")) return undefined;
    }
    return { path: at === "." ? "" : at, rest: false };
}

/** the value of an expression in `file`, through the constants it and the repo's modules declare */
function valueOf(expr: string, file: string, local: Map<string, Value>, exported: Map<string, Value>): Value {
    const literal = expr.match(STRING);
    if (literal) return { literal: literal[2]! };
    if (HERE.test(expr)) return { path: posix.dirname(file) };
    if (/^\w+$/.test(expr)) return local.has(expr) ? local.get(expr) : exported.get(expr);
    const call = expr.match(/^(?:path\.)?(?:join|resolve)\(/);
    if (call) {
        const found = argsAt(expr, call[0].length - 1);
        const j = found && found.end === expr.length ? joined(found.args, (e) => valueOf(e, file, local, exported)) : undefined;
        return j && !j.rest ? { path: j.path } : undefined;
    }
    return undefined;
}

/** a file's constants, in order: each may use the ones before it and the repo's exported ones */
function constantsOf(file: string, text: string, exported: Map<string, Value>): Map<string, Value> {
    const local = new Map<string, Value>();
    for (const m of text.matchAll(CONST)) {
        const start = m.index! + m[0].length;
        const call = text.slice(start).match(/^(?:path\.)?(?:join|resolve)\(/);
        let expr: string;
        if (call) {
            const found = argsAt(text, start + call[0].length - 1);
            if (!found) continue;
            expr = text.slice(start, found.end);
        } else {
            expr = text.slice(start).match(/^[^;\n]*/)![0].trim();
        }
        local.set(m[1]!, valueOf(expr, file, local, exported));
    }
    return local;
}

/** every path a file joins from the repo root, and whether the join goes on past it */
function joinsIn(file: string, text: string, exported: Map<string, Value>): Array<{ path: string; rest: boolean }> {
    const local = constantsOf(file, text, exported);
    const found: Array<{ path: string; rest: boolean }> = [];
    for (const m of text.matchAll(JOIN)) {
        const call = argsAt(text, m.index! + m[0].length - 1);
        const j = call && joined(call.args, (e) => valueOf(e, file, local, exported));
        if (j && j.path !== "") found.push(j);
    }
    return found;
}

/** one part pointing into another, and from which side of each */
interface Edge {
    from: Node;
    fromPublic: boolean;
    toPublic: boolean;
    /** the file or folder pointed at, kept for a private one: only a change there reaches it */
    at?: string;
}

/** for each part, the edges pointing into it */
export function incomingEdges(repo: Repo, nodes: Node[]): Map<Node, Edge[]> {
    const tracked = new Set(repo.files);
    const dirs = new Set<string>();
    for (const f of repo.files) for (let d = posix.dirname(f); d !== "."; d = posix.dirname(d)) dirs.add(d);
    const texts = new Map<string, string>();
    for (const f of repo.files) if (SCANNED.test(f) && !isGateTooling(f) && ownerOf(nodes, f)) texts.set(f, repo.read(f));
    const resolve = (p: string) => (tracked.has(p) || dirs.has(p) ? p : [".ts", ".tsx", ".js", ".mjs", "/index.ts"].map((e) => p + e).find((q) => tracked.has(q)));

    const incoming = new Map<Node, Edge[]>(nodes.map((n) => [n, []]));
    const seen = new Set<string>();
    const add = (from: Node, fromPublic: boolean, to: Node, toPublic: boolean, at?: string) => {
        const key = `${from.dir}|${fromPublic}|${to.dir}|${toPublic ? "" : at}`;
        if (from === to || seen.has(key)) return;
        seen.add(key);
        incoming.get(to)!.push(toPublic ? { from, fromPublic, toPublic } : { from, fromPublic, toPublic, at });
    };
    /** a folder that holds parts without being one (panels/, apps/): every part in it, any file */
    const intoFolder = (from: Node, fromPublic: boolean, dir: string) => {
        for (const n of nodes) if (!n.platform && under(n.dir, dir)) add(from, fromPublic, n, false, dir);
    };
    /** each file's references to other files, for what an edge to a file covers */
    const refs = new Map<string, Set<string>>();
    let scanning = "";
    const point = (from: Node, fromPublic: boolean, path: string) => {
        const found = resolve(path);
        if (found === undefined || isGateTooling(found)) return;
        if (tracked.has(found)) refs.set(scanning, (refs.get(scanning) ?? new Set()).add(found));
        const to = ownerOf(nodes, found);
        if (!to) return dirs.has(found) ? intoFolder(from, fromPublic, found) : undefined;
        // a part's own folder named whole is a place (a cwd, an output folder), not its code
        if (found === to.dir && dirs.has(found)) return;
        add(from, fromPublic, to, dirs.has(found) && !tracked.has(found) ? !isPrivate(to, found + "/x") : !isPrivate(to, found), found);
    };
    /** a join that goes on past `dir` with something unknown: whatever it reaches under `dir` */
    const pointUnder = (from: Node, fromPublic: boolean, dir: string) => {
        if (!dirs.has(dir) || isGateTooling(dir + "/")) return;
        const to = ownerOf(nodes, dir);
        if (to) add(from, fromPublic, to, false, dir);
        else intoFolder(from, fromPublic, dir);
    };

    // workspace packages, by name. A part uses one from the side of the files
    // that import it, as with paths: the app's main process importing the
    // daemon ships it, whichever list in package.json names it. A dependency
    // no file names (a CLI, a plugin) is one the part builds and tests with.
    const byName = new Map<string, Node>();
    for (const n of nodes) {
        const manifest = `${n.dir}/package.json`;
        if (tracked.has(manifest)) byName.set(JSON.parse(repo.read(manifest)).name, n);
    }
    const imported = new Map<string, Set<string>>();
    for (const [file, text] of texts) {
        if (file.endsWith("package.json")) continue;
        const names = new Set<string>();
        for (const m of text.matchAll(PACKAGE)) if (byName.has(m[1]!)) names.add(m[1]!);
        if (names.size > 0) imported.set(file, names);
    }
    for (const n of nodes) {
        const manifest = `${n.dir}/package.json`;
        if (!tracked.has(manifest)) continue;
        const pkg = JSON.parse(repo.read(manifest));
        for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies })) {
            const to = byName.get(name);
            if (!to) continue;
            let named = false;
            for (const [file, names] of imported) {
                if (!under(file, n.dir) || !names.has(name)) continue;
                const from = ownerOf(nodes, file)!;
                add(from, !isPrivate(from, file), to, true);
                named = true;
            }
            if (!named) add(n, false, to, true);
        }
    }

    // the repo's exported constants that name a path or a segment, for the joins that import them
    const exported = new Map<string, Value>();
    const clashed = new Set<string>();
    for (const [file, text] of texts) {
        if (!/\bexport\s+const\b/.test(text)) continue;
        for (const [name, value] of constantsOf(file, text, new Map())) {
            if (!value || !new RegExp(`\\bexport\\s+const\\s+${name}\\b`).test(text)) continue;
            if (exported.has(name) && JSON.stringify(exported.get(name)) !== JSON.stringify(value)) clashed.add(name);
            exported.set(name, value);
        }
    }
    for (const name of clashed) exported.delete(name);

    // a part's cross-platform suite tests that part
    for (const n of nodes) if (n.platform) add(n, false, nodes.find((o) => o !== n && under(n.dir, o.dir))!, true);

    for (const [file, text] of texts) {
        const from = ownerOf(nodes, file)!;
        const fromPublic = !isPrivate(from, file);
        const dir = posix.dirname(file);
        scanning = file;
        for (const j of joinsIn(file, text, exported)) (j.rest ? pointUnder : point)(from, fromPublic, j.path);
        for (const m of text.matchAll(RELATIVE)) point(from, fromPublic, posix.normalize(posix.join(dir, m[1]!)).replace(/\/$/, ""));
        for (const m of text.matchAll(REPO_PATH)) point(from, fromPublic, m[1]!.replace(/\/$/, ""));
        for (const m of text.matchAll(SEGMENTED)) point(from, fromPublic, [...m[0].matchAll(/["'`]([\w.@-]+)["'`]/g)].map((q) => q[1]).join("/"));
    }

    // An edge to one private file covers what that file uses, transitively:
    // a consumer that compiles a part's test helper compiles its imports too,
    // in that part or another, by path or by package.
    for (const edges of [...incoming.values()]) {
        for (const e of [...edges]) {
            if (e.toPublic || !e.at || !tracked.has(e.at)) continue;
            const seen = new Set([e.at]);
            const queue = [e.at];
            while (queue.length) {
                const f = queue.shift()!;
                for (const name of imported.get(f) ?? []) add(e.from, e.fromPublic, byName.get(name)!, true);
                for (const g of refs.get(f) ?? []) {
                    if (seen.has(g)) continue;
                    seen.add(g);
                    queue.push(g);
                    const owner = ownerOf(nodes, g);
                    if (owner) add(e.from, e.fromPublic, owner, !isPrivate(owner, g), g);
                }
            }
        }
    }
    return incoming;
}

/**
 * The targets a change to `file` reruns: its own, and every part whose checks
 * can reach it, each with the route that reached it (the parts, nearest first).
 */
function reachedBy(incoming: Map<Node, Edge[]>, owner: Node, file: string): Map<string, string[]> {
    const routes = new Map<string, string[]>();
    // a part's cross-platform suite reruns its target and the cross-platform runners
    const note = (n: Node, route: string[]) => {
        for (const t of n.platform ? [n.target, PLATFORM] : [n.target]) if (!routes.has(t)) routes.set(t, route);
    };
    note(owner, [file]);
    // parts whose public side the change reaches: their consumers rerun too
    const reached = new Map<Node, string[]>();
    const queue: Node[] = [];
    const reach = (n: Node, route: string[]) => {
        note(n, route);
        if (!reached.has(n)) {
            reached.set(n, route);
            queue.push(n);
        }
    };
    const follow = (e: Edge, route: string[]) => (e.fromPublic ? reach(e.from, [...route, e.from.dir]) : note(e.from, [...route, e.from.dir]));
    if (!isPrivate(owner, file)) reach(owner, [file]);
    else for (const e of incoming.get(owner)!) if (!e.toPublic && e.at && under(file, e.at)) follow(e, [file]);
    while (queue.length) {
        const n = queue.shift()!;
        for (const e of incoming.get(n)!) follow(e, reached.get(n)!);
    }
    return routes;
}

/** every gate target, for a full run */
export function allTargets(repo: Repo): string[] {
    return [...new Set([...nodesOf(repo).map((n) => n.target), "packages", "global"])].sort();
}

/**
 * Each target a change reruns, and why: the route of files and parts that
 * reached it. The graph is walked in the head and in the `base` the branch
 * left: a deleted or moved file has no importer left in the head, but the
 * ones in the base still reach the parts that used it.
 */
export function routesOf(repo: Repo, changed: string[], base: Repo = repo): Map<string, string[]> {
    const trees = base === repo ? [repo] : [repo, base];
    const gate = changed.find(isGateTooling);
    if (gate) return new Map([...new Set(trees.flatMap(allTargets)), PLATFORM].sort().map((t) => [t, [gate, "(a change here reruns every target)"]]));
    const routes = new Map<string, string[]>();
    for (const tree of trees) {
        const nodes = nodesOf(tree);
        const incoming = incomingEdges(tree, nodes);
        for (const path of changed) {
            const owner = ownerOf(nodes, path);
            if (!owner) continue;
            for (const [t, route] of reachedBy(incoming, owner, path)) if (!routes.has(t)) routes.set(t, route);
        }
    }
    const packed = PACKED.find((t) => routes.has(t));
    if (packed && !routes.has("packages")) routes.set("packages", [...routes.get(packed)!, "(a packed library: the consumer check)"]);
    // the repo-wide checks are cheap, and a deleted CHANGELOG or a TODO falls due anywhere
    if (changed.length > 0 && !routes.has("global")) routes.set("global", ["(any change runs the repo-wide checks)"]);
    return routes;
}

export function scopeOf(repo: Repo, changed: string[], base: Repo = repo): Scope {
    return scopeOfRoutes(routesOf(repo, changed, base));
}

/** the scope that routes make: their targets, and whether one reaches a cross-platform suite */
function scopeOfRoutes(routes: Map<string, string[]>): Scope {
    return { targets: [...routes.keys()].filter((t) => t !== PLATFORM).sort(), platform: routes.has(PLATFORM) };
}

function git(args: string[], root: string): string {
    const out = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${out.stderr.toString().trim()}`);
    return out.stdout.toString();
}

/** this checkout as a Repo: tracked files that are on disk (a deletion leaves none) */
export function workingRepo(root = ROOT): Repo {
    const files = git(["ls-files", "-z"], root)
        .split("\0")
        .filter((f) => f && existsSync(join(root, f)) && !statSync(join(root, f)).isDirectory());
    return { files, read: (f) => readFileSync(join(root, f), "utf8") };
}

/** what the branch did to each file since it left `base`: A, M, D or T, by path */
function statusSince(base: string, root: string): Map<string, string> {
    const fields = git(["diff", "--name-status", "--no-renames", "-z", `${base}...HEAD`], root).split("\0").filter(Boolean);
    const status = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) status.set(fields[i + 1]!, fields[i]!);
    return status;
}

/** the files a branch changed since it left `base` (deletions and both sides of a rename included) */
export function changedSince(base: string, root = ROOT): string[] {
    return [...statusSince(base, root).keys()];
}

/**
 * The tree the branch left `base` at, made from `head`: the files the branch
 * added are gone, and the ones it changed or deleted read as they were. Every
 * other file is the same in both.
 */
export function baseRepo(head: Repo, base: string, root = ROOT): Repo {
    const fork = git(["merge-base", base, "HEAD"], root).trim();
    const status = statusSince(base, root);
    const before = (f: string) => status.has(f) && status.get(f) !== "A";
    const files = [...new Set([...head.files.filter((f) => status.get(f) !== "A"), ...[...status.keys()].filter(before)])];
    return { files, read: (f) => (before(f) ? git(["show", `${fork}:${f}`], root) : head.read(f)) };
}

/**
 * The CI jobs for a scope: each panel, the daemon and the app run alone (they
 * are the long suites), the libraries and the web apps share a job each.
 */
export function jobsOf(targets: string[]): Array<{ name: string; targets: string }> {
    const GROUPS: Record<string, string> = {
        packages: "libraries", paperapi: "libraries", paperui: "libraries", "create-panel": "libraries", release: "libraries",
        testkit: "libraries", npx: "libraries", scripts: "libraries", global: "libraries",
        paperdocs: "web", origami: "web", library: "web", arilink: "web", panelapis: "web",
    };
    const jobs = new Map<string, string[]>();
    for (const t of targets) {
        const name = GROUPS[t] ?? t;
        jobs.set(name, [...(jobs.get(name) ?? []), t]);
    }
    return [...jobs].map(([name, ts]) => ({ name, targets: ts.join(" ") }));
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
    const base = value("--base") ?? "origin/main";
    const why = value("--why");
    const all = args.includes("--all");
    const known = (a: string, i: number) => ["--github", "--all"].includes(a) || ["--base", "--why"].includes(a) || ["--base", "--why"].includes(args[i - 1]!);
    if ((args.includes("--base") && !value("--base")) || (args.includes("--why") && !why) || (all && (args.includes("--base") || why)) || !args.every(known)) {
        console.error("usage: bun scripts/gate/scope.ts [--base <ref> | --all] [--github | --why <target>]");
        process.exit(2);
    }
    const repo = workingRepo();
    const routes = all ? undefined : routesOf(repo, changedSince(base), baseRepo(repo, base));
    const scope: Scope = routes ? scopeOfRoutes(routes) : { targets: allTargets(repo), platform: true };
    if (why) {
        const route = routes!.get(why);
        if (!route) {
            console.log(`Nothing changed since ${base} reaches ${why}.`);
        } else {
            console.log(`${why} runs because:`);
            for (const [i, step] of route.entries()) console.log(step.startsWith("(") ? `  ${step}` : i === 0 ? `  ${step} changed` : `  which ${step} uses`);
        }
    } else if (args.includes("--github")) {
        const output = process.env.GITHUB_OUTPUT;
        if (!output) throw new Error("--github writes to $GITHUB_OUTPUT, which is not set");
        appendFileSync(output, `jobs=${JSON.stringify(jobsOf(scope.targets))}\nplatform=${scope.platform}\n`);
        console.log(`targets: ${scope.targets.join(" ") || "(none)"}; platform: ${scope.platform}`);
    } else {
        for (const t of scope.targets) console.log(t);
    }
}
