#!/usr/bin/env bun
// Which gate targets a change can reach, so a pull request runs those and no
// others: a typo in a panel's README runs that panel's gate, not the whole
// repository's.
//
// Usage: bun scripts/gate/scope.ts [--base <ref> | --all] [--github]
//   Compares HEAD with --base (default origin/main) and prints the targets,
//   one per line; --all picks every target. --github writes the CI job matrix
//   and the platform switch to $GITHUB_OUTPUT instead.
//
// Each target owns a folder (a panel's is found under panels/, so a new panel
// needs no entry here), and a target reaches another when its files point
// into it: a workspace dependency in package.json, a relative path, a repo
// path in a string ("apps/daemon/src/main.ts") or one built from segments
// ("apps", "daemon"). A path counts only when it exists, so URLs and ids that
// look like paths don't. A change reaches its owner and every target that
// reaches the owner, transitively. The gate's own tooling, the lockfile and
// the root package.json reach everything. A file no target owns (the root's
// markdown, branding/, the release workflow) reaches none.
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

/** the targets with no folder of their own, and what they check */
const PACKED = ["paperapi", "paperui", "create-panel"]; // `packages`: the packed libraries as a consumer gets them

const SCANNED = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|jsonc|toml|ya?ml|sh|html|css)$/;
const RELATIVE = /["'`](\.{1,2}\/[^"'`\s$]*)["'`]/g;
const REPO_PATH = /["'`]((?:apps|packages|panels|services|scripts)\/[^"'`\s$]+)["'`]/g;
const SEGMENTED = /["'`](?:apps|packages|panels|services|scripts)["'`](?:\s*,\s*["'`][\w.@-]+["'`])+/g;

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

/** a node of the graph: a target's folder, or one root script */
export interface Node {
    dir: string;
    target: string;
}

export function nodesOf(repo: Repo): Node[] {
    const nodes: Node[] = Object.entries(TARGET_DIRS).map(([target, dir]) => ({ dir, target }));
    for (const f of repo.files) if (isScriptFile(f)) nodes.push({ dir: f, target: "scripts" });
    const panels = new Set(repo.files.filter((f) => /^panels\/[^/]+\/package\.json$/.test(f)).map((f) => f.split("/")[1]!));
    for (const panel of panels) nodes.push({ dir: `panels/${panel}`, target: panel.replace(/^dev\.paperboard\./, "") });
    // the longest folder wins, so services/library is not services/
    return nodes.sort((a, b) => b.dir.length - a.dir.length);
}

const under = (path: string, dir: string) => path === dir || path.startsWith(dir + "/");

/** the node a path belongs to, if any target owns it */
function ownerOf(nodes: Node[], path: string): Node | undefined {
    return nodes.find((n) => under(path, n.dir));
}

/**
 * A file is private to its part when only that part's own checks run it: its
 * tests and fixtures, its configs, its scripts, its docs. The rest is what
 * other parts consume. A private reference reruns the part that makes it; a
 * public one also reruns every part that consumes that part's code.
 */
export function isPrivate(node: Node, file: string): boolean {
    if (isScriptFile(node.dir)) return /\.test\.[a-z]+$/.test(file);
    const inside = file.slice(node.dir.length + 1);
    if (!inside.includes("/")) return !/^(index|main)\.[a-z]+$/.test(inside) && inside !== "package.json";
    return /(^|\/)(tests?|__tests__|fixtures|scripts|dev)\//.test(inside) || /\.(test|spec)\.[a-z]+$/.test(inside);
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
    const resolve = (p: string) => (tracked.has(p) || dirs.has(p) ? p : [".ts", ".tsx", ".js", ".mjs", "/index.ts"].map((e) => p + e).find((q) => tracked.has(q)));

    const incoming = new Map<Node, Edge[]>(nodes.map((n) => [n, []]));
    const seen = new Set<string>();
    const add = (from: Node, fromPublic: boolean, to: Node, toPublic: boolean, at?: string) => {
        const key = `${from.dir}|${fromPublic}|${to.dir}|${toPublic ? "" : at}`;
        if (from === to || seen.has(key)) return;
        seen.add(key);
        incoming.get(to)!.push(toPublic ? { from, fromPublic, toPublic } : { from, fromPublic, toPublic, at });
    };
    const point = (from: Node, fromPublic: boolean, path: string) => {
        const found = resolve(path);
        if (found === undefined || isGateTooling(found)) return;
        const to = ownerOf(nodes, found);
        // a part's own folder named whole is a place (a cwd, an output folder), not its code
        if (!to || (found === to.dir && dirs.has(found))) return;
        add(from, fromPublic, to, dirs.has(found) && !tracked.has(found) ? !isPrivate(to, found + "/x") : !isPrivate(to, found), found);
    };

    // workspace dependencies, by package name: what a part runs with is public, what it builds and tests with is not
    const byName = new Map<string, Node>();
    for (const n of nodes) {
        const manifest = `${n.dir}/package.json`;
        if (tracked.has(manifest)) byName.set(JSON.parse(repo.read(manifest)).name, n);
    }
    for (const n of nodes) {
        const manifest = `${n.dir}/package.json`;
        if (!tracked.has(manifest)) continue;
        const pkg = JSON.parse(repo.read(manifest));
        for (const [deps, fromPublic] of [[pkg.dependencies, true], [pkg.peerDependencies, true], [pkg.devDependencies, false]] as const) {
            for (const name of Object.keys(deps ?? {})) {
                const to = byName.get(name);
                if (to) add(n, fromPublic, to, true);
            }
        }
    }

    for (const file of repo.files) {
        const from = ownerOf(nodes, file);
        if (!from || !SCANNED.test(file) || isGateTooling(file)) continue;
        const fromPublic = !isPrivate(from, file);
        const text = repo.read(file);
        const dir = posix.dirname(file);
        for (const m of text.matchAll(RELATIVE)) point(from, fromPublic, posix.normalize(posix.join(dir, m[1]!)).replace(/\/$/, ""));
        for (const m of text.matchAll(REPO_PATH)) point(from, fromPublic, m[1]!.replace(/\/$/, ""));
        for (const m of text.matchAll(SEGMENTED)) point(from, fromPublic, [...m[0].matchAll(/["'`]([\w.@-]+)["'`]/g)].map((q) => q[1]).join("/"));
    }
    return incoming;
}

/** the targets a change to `file` reruns: its own, and every part whose checks can reach it */
function reachedBy(incoming: Map<Node, Edge[]>, owner: Node, file: string): Set<string> {
    const targets = new Set([owner.target]);
    // parts whose public side the change reaches: their consumers rerun too
    const reached = new Set<Node>();
    const queue: Node[] = [];
    const reach = (n: Node) => {
        targets.add(n.target);
        if (!reached.has(n)) {
            reached.add(n);
            queue.push(n);
        }
    };
    if (!isPrivate(owner, file)) reach(owner);
    else for (const e of incoming.get(owner)!) if (!e.toPublic && e.at && under(file, e.at)) e.fromPublic ? reach(e.from) : targets.add(e.from.target);
    while (queue.length) {
        for (const e of incoming.get(queue.shift()!)!) e.fromPublic ? reach(e.from) : targets.add(e.from.target);
    }
    return targets;
}

/** every gate target, for a full run */
export function allTargets(repo: Repo): string[] {
    return [...new Set([...nodesOf(repo).map((n) => n.target), "packages", "global"])].sort();
}

/** the targets with a cross-platform suite (a test/platform or tests/platform folder) */
function platformTargets(repo: Repo, nodes: Node[]): Set<string> {
    const found = new Set<string>();
    for (const f of repo.files) {
        if (!/(^|\/)tests?\/platform\//.test(f)) continue;
        const owner = ownerOf(nodes, f);
        if (owner) found.add(owner.target);
    }
    return found;
}

export function scopeOf(repo: Repo, changed: string[]): Scope {
    const nodes = nodesOf(repo);
    const platforms = platformTargets(repo, nodes);
    if (changed.some(isGateTooling)) {
        return { targets: allTargets(repo), platform: true };
    }
    const incoming = incomingEdges(repo, nodes);
    const targets = new Set<string>();
    for (const path of changed) {
        const owner = ownerOf(nodes, path);
        if (owner) for (const t of reachedBy(incoming, owner, path)) targets.add(t);
    }
    if (PACKED.some((t) => targets.has(t))) targets.add("packages");
    // the repo-wide checks are cheap, and a deleted CHANGELOG or a TODO falls due anywhere
    if (changed.length > 0) targets.add("global");
    return { targets: [...targets].sort(), platform: [...targets].some((t) => platforms.has(t)) };
}

/** this checkout as a Repo: tracked files that are on disk (a deletion leaves none) */
export function workingRepo(root = ROOT): Repo {
    const out = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`git ls-files failed: ${out.stderr.toString().trim()}`);
    const files = out.stdout.toString().split("\0").filter((f) => f && existsSync(join(root, f)) && !statSync(join(root, f)).isDirectory());
    return { files, read: (f) => readFileSync(join(root, f), "utf8") };
}

/** the files a branch changed since it left `base` (deletions and both sides of a rename included) */
export function changedSince(base: string, root = ROOT): string[] {
    const out = Bun.spawnSync(["git", "diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`git diff against ${base} failed: ${out.stderr.toString().trim()}`);
    return out.stdout.toString().split("\0").filter(Boolean);
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
    const at = args.indexOf("--base");
    const base = at >= 0 ? args[at + 1] : "origin/main";
    const all = args.includes("--all");
    const usage = !base || (all && at >= 0) || args.some((a, i) => a !== "--base" && a !== "--github" && a !== "--all" && args[i - 1] !== "--base");
    if (usage) {
        console.error("usage: bun scripts/gate/scope.ts [--base <ref> | --all] [--github]");
        process.exit(2);
    }
    const repo = workingRepo();
    const scope: Scope = all ? { targets: allTargets(repo), platform: true } : scopeOf(repo, changedSince(base));
    if (args.includes("--github")) {
        const output = process.env.GITHUB_OUTPUT;
        if (!output) throw new Error("--github writes to $GITHUB_OUTPUT, which is not set");
        appendFileSync(output, `jobs=${JSON.stringify(jobsOf(scope.targets))}\nplatform=${scope.platform}\n`);
        console.log(`targets: ${scope.targets.join(" ") || "(none)"}; platform: ${scope.platform}`);
    } else {
        for (const t of scope.targets) console.log(t);
    }
}
