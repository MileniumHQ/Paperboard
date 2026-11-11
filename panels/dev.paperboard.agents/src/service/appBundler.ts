// Builds an app's scripts for the browser, the way a dev server would: a
// script the page loads is bundled with everything it imports, each time
// it's loaded. esbuild does it, compiled to WebAssembly and run in the
// service, so no program on this computer runs. esbuild's browser build has
// no file system of its own: every import is resolved here, the Node way
// (node_modules, package.json exports, browser fields), and read only from
// inside the app's folder. Paths are named from the app's folder (/src/…),
// never the host's.

import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
// esbuild itself is loaded with the first build, so a service whose apps
// are never opened carries neither its script nor its WebAssembly
import type * as esbuild from "esbuild-wasm/esm/browser.js";
import wasmFile from "esbuild-wasm/esbuild.wasm" with { type: "file" };

/** what a page loads that is bundled rather than sent as it is */
export const SCRIPT = /\.(m?[jt]sx?|cts|cjs)$/;

const LOADERS: Record<string, esbuild.Loader> = {
    ".ts": "ts",
    ".mts": "ts",
    ".cts": "ts",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".js": "js",
    ".mjs": "js",
    ".cjs": "js",
    ".json": "json",
    ".css": "css",
    ".txt": "text",
    ".svg": "dataurl",
    ".png": "dataurl",
    ".jpg": "dataurl",
    ".jpeg": "dataurl",
    ".gif": "dataurl",
    ".webp": "dataurl",
    ".avif": "dataurl",
    ".ico": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
    ".ttf": "dataurl",
    ".otf": "dataurl",
};
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".css"];
const NODE = new Set(builtinModules);

type Esbuild = typeof esbuild;

let started: Promise<Esbuild> | null = null;
function start(): Promise<Esbuild> {
    started ??= (async () => {
        const esbuild = await import("esbuild-wasm/esm/browser.js");
        // esbuild's browser build reads its globals through `self`, which Bun
        // defines and Node doesn't: under Node it's the same global object
        const g = globalThis as { self?: unknown };
        if (g.self === undefined) g.self = globalThis;
        const wasm = await WebAssembly.compile(fs.readFileSync(new URL(wasmFile, import.meta.url)));
        await esbuild.initialize({ wasmModule: wasm, worker: false });
        return esbuild;
    })();
    return started;
}

export class BuildError extends Error {}

/** One app's folder, read the way the bundler may: lexically and, links followed, really inside it. What it finds is kept for one build. */
class AppFiles {
    readonly real: string;
    private kinds = new Map<string, "file" | "dir" | null>();
    private jsons = new Map<string, Record<string, unknown>>();
    constructor(root: string) {
        this.real = fs.realpathSync(root);
    }
    /** the host path for an app path (/src/main.tsx), or null when it would be outside */
    host(appPath: string): string | null {
        const full = path.resolve(this.real, `.${path.posix.normalize(`/${appPath}`)}`);
        return full === this.real || full.startsWith(this.real + path.sep) ? full : null;
    }
    /** the app path for a host path inside it */
    app(full: string): string {
        return `/${path.relative(this.real, full).split(path.sep).join("/")}`;
    }
    private inside(full: string): boolean {
        if (!fs.existsSync(full)) return false;
        const real = fs.realpathSync(full);
        return real === this.real || real.startsWith(this.real + path.sep);
    }
    private kind(full: string): "file" | "dir" | null {
        let k = this.kinds.get(full);
        if (k === undefined) {
            const st = this.inside(full) ? fs.statSync(full) : null;
            k = st?.isFile() ? "file" : st?.isDirectory() ? "dir" : null;
            this.kinds.set(full, k);
        }
        return k;
    }
    isFile(full: string) {
        return this.kind(full) === "file";
    }
    isDir(full: string) {
        return this.kind(full) === "dir";
    }
    read(full: string): Buffer {
        if (!this.inside(full)) throw new BuildError(`${this.app(full)} isn't in the app's folder`);
        return fs.readFileSync(full);
    }
    json(full: string): Record<string, unknown> {
        const known = this.jsons.get(full);
        if (known) return known;
        try {
            const v = JSON.parse(this.read(full).toString("utf8"));
            if (v && typeof v === "object" && !Array.isArray(v)) {
                this.jsons.set(full, v);
                return v;
            }
        } catch (e) {
            if (e instanceof BuildError) throw e;
        }
        throw new BuildError(`${this.app(full)} isn't valid JSON`);
    }
}

/** The file a path names, with an extension or an index file found the way Node and bundlers do. */
function asFile(files: AppFiles, base: string): string | null {
    if (files.isFile(base)) return base;
    for (const ext of EXTENSIONS) if (files.isFile(base + ext)) return base + ext;
    if (files.isDir(base)) for (const ext of EXTENSIONS) if (files.isFile(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
    return null;
}

type Target = string | null | Target[] | { [condition: string]: Target };

/** A package's `exports` for one subpath (".", "./client"), with the first condition that applies. */
export function fromExports(exports: Target, sub: string, conditions: string[]): string | null {
    const pick = (t: Target, star?: string): string | null => {
        if (typeof t === "string") return star === undefined ? t : t.replaceAll("*", star);
        if (Array.isArray(t)) {
            for (const x of t) {
                const r = pick(x, star);
                if (r) return r;
            }
            return null;
        }
        if (t && typeof t === "object") {
            for (const [k, v] of Object.entries(t)) {
                if (k !== "default" && !conditions.includes(k)) continue;
                const r = pick(v, star);
                if (r) return r;
            }
        }
        return null;
    };
    const keyed = exports && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some((k) => k.startsWith("."));
    if (!keyed) return sub === "." ? pick(exports) : null;
    const map = exports as Record<string, Target>;
    if (sub in map) return pick(map[sub]!);
    // "./*" patterns: the one with the longest part before the star
    let best: { key: string; star: string } | null = null;
    for (const key of Object.keys(map)) {
        const i = key.indexOf("*");
        if (i < 0) continue;
        const [before, after] = [key.slice(0, i), key.slice(i + 1)];
        if (sub.startsWith(before) && sub.endsWith(after) && sub.length >= key.length - 1 && (!best || before.length > best.key.indexOf("*"))) {
            best = { key, star: sub.slice(before.length, sub.length - after.length) };
        }
    }
    return best ? pick(map[best.key]!, best.star) : null;
}

const EMPTY = "empty";

// a script's last build, kept while none of the files that went into it change
interface Built {
    /** each file read, with its size and when it changed (-1: not there) */
    inputs: [string, number, number][];
    out: { js: string; css: string };
}
const builds = new Map<string, Built>();
const KEPT_BUILDS = 32;
const stamp = (file: string): [string, number, number] => {
    const st = fs.statSync(file, { throwIfNoEntry: false });
    return st ? [file, st.mtimeMs, st.size] : [file, -1, -1];
};

/** Forget an app's builds: its packages changed, so its scripts may resolve to other files. */
export function forgetBuilds(root: string) {
    const real = fs.realpathSync(root);
    for (const key of builds.keys()) if (key.startsWith(`${real}\0`)) builds.delete(key);
}

/** Bundles one of the app's scripts: its JavaScript, and the CSS it imports when it imports any. */
export async function bundle(root: string, entry: string): Promise<{ js: string; css: string }> {
    const esbuild = await start();
    const files = new AppFiles(root);
    const key = `${files.real}\0${entry}`;
    const kept = builds.get(key);
    if (kept?.inputs.every(([file, mtime, size]) => {
        const now = stamp(file);
        return now[1] === mtime && now[2] === size;
    })) {
        return kept.out;
    }
    const tsconfig = files.host("/tsconfig.json");
    const tsconfigRaw = tsconfig && files.isFile(tsconfig) ? (files.json(tsconfig) as esbuild.TsconfigRaw) : undefined;

    // the package a file is in: its folder and its package.json
    const packageOf = (file: string): { dir: string; json: Record<string, unknown> } | null => {
        for (let dir = path.dirname(file); dir.startsWith(files.real); dir = path.dirname(dir)) {
            const pj = path.join(dir, "package.json");
            if (files.isFile(pj)) return { dir, json: files.json(pj) };
            if (dir === files.real) break;
        }
        return null;
    };
    // a package's `browser` field swapping one of its files (or a module) for another, or for nothing
    const swapped = (pkg: { dir: string; json: Record<string, unknown> }, key: string): string | false | null => {
        const map = pkg.json.browser;
        if (!map || typeof map !== "object") return null;
        for (const k of [key, key.replace(/\.[^./]+$/, "")]) {
            const v = (map as Record<string, unknown>)[k];
            if (v === false) return false;
            if (typeof v === "string") return v;
        }
        return null;
    };
    const withBrowserField = (file: string): string | false => {
        const pkg = packageOf(file);
        if (!pkg) return file;
        const v = swapped(pkg, `./${path.relative(pkg.dir, file).split(path.sep).join("/")}`);
        if (v === false) return false;
        return v === null ? file : (asFile(files, path.join(pkg.dir, v)) ?? file);
    };

    const fromPackage = (spec: string, importer: string, kind: esbuild.ImportKind): string | false => {
        const parts = spec.split("/");
        const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
        const sub = `.${spec.slice(name.length)}`;
        // the importing package may swap a module for a browser one
        const importing = packageOf(importer);
        if (importing) {
            const v = importing.dir === files.real ? null : swapped(importing, spec);
            if (v === false) return false;
            if (v !== null) return resolve(v, importer, kind);
        }
        let dir: string | null = null;
        for (let at = path.dirname(importer); ; at = path.dirname(at)) {
            const candidate = path.join(at, "node_modules", name);
            if (files.isDir(candidate)) {
                dir = candidate;
                break;
            }
            if (at === files.real || !at.startsWith(files.real)) break;
        }
        if (!dir) {
            if (spec.startsWith("node:") || NODE.has(name)) {
                throw new BuildError(`"${spec}" is part of Node, not the browser: an app runs in the browser, so it can't use Node's modules`);
            }
            throw new BuildError(`"${name}" isn't installed: add it with add_package`);
        }
        const pjPath = path.join(dir, "package.json");
        const pj = files.isFile(pjPath) ? files.json(pjPath) : {};
        const conditions = ["browser", "development", kind === "require-call" ? "require" : "import", "module"];
        if (pj.exports !== undefined) {
            const target = fromExports(pj.exports as Target, sub, conditions);
            if (!target) throw new BuildError(`"${spec}" isn't something ${name} offers (its package.json exports don't include ${sub})`);
            const file = files.host(files.app(path.join(dir, target)));
            if (!file || !files.isFile(file)) throw new BuildError(`${name}'s package.json points ${sub} at ${target}, which isn't there`);
            return withBrowserField(file);
        }
        if (sub !== ".") {
            const file = asFile(files, path.join(dir, sub));
            if (!file) throw new BuildError(`"${spec}" isn't a file in ${name}`);
            return withBrowserField(file);
        }
        const main = [typeof pj.browser === "string" ? pj.browser : null, pj.module, pj.main, "index"].find((m): m is string => typeof m === "string");
        const file = asFile(files, path.join(dir, main!)) ?? asFile(files, path.join(dir, "index"));
        if (!file) throw new BuildError(`${name} has no file to start from (its package.json main is ${main})`);
        return withBrowserField(file);
    };

    function resolve(spec: string, importer: string, kind: esbuild.ImportKind): string | false {
        if (/^[a-z][a-z0-9+.-]*:/i.test(spec) && !spec.startsWith("node:")) {
            throw new BuildError(`"${spec}" is on the web: an app only loads its own files, so add the package with add_package instead`);
        }
        // "/src/x" is from the app's folder, as on its page
        if (spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
            const full = spec.startsWith("/") ? files.host(spec) : files.host(files.app(path.resolve(path.dirname(importer), spec)));
            if (!full) throw new BuildError(`"${spec}" is outside the app's folder`);
            const file = asFile(files, full);
            if (!file) throw new BuildError(`there's no file at ${files.app(full)}`);
            return withBrowserField(file);
        }
        return fromPackage(spec, importer, kind);
    }

    const plugin: esbuild.Plugin = {
        name: "app-files",
        setup(build) {
            build.onResolve({ filter: /.*/ }, (a) => {
                try {
                    if (a.kind === "entry-point") return { path: a.path, namespace: "app" };
                    // everything that imports is one of the app's files: the empty module imports nothing
                    const file = resolve(a.path, files.host(a.importer)!, a.kind);
                    if (file === false) return { path: a.path, namespace: EMPTY };
                    return { path: files.app(file), namespace: "app" };
                } catch (e) {
                    if (e instanceof BuildError) return { errors: [{ text: e.message }] };
                    throw e;
                }
            });
            build.onLoad({ filter: /.*/, namespace: EMPTY }, () => ({ contents: "", loader: "js" }));
            build.onLoad({ filter: /.*/, namespace: "app" }, (a) => {
                const full = files.host(a.path);
                const loader = LOADERS[path.extname(a.path).toLowerCase()];
                if (!full || !files.isFile(full)) return { errors: [{ text: `there's no file at ${a.path}` }] };
                if (!loader) return { errors: [{ text: `${a.path} isn't something a script can import (${Object.keys(LOADERS).join(" ")})` }] };
                return { contents: files.read(full), loader };
            });
        },
    };

    let result: esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] };
    try {
        result = await esbuild.build({
            entryPoints: [entry],
            bundle: true,
            write: false,
            outdir: "/out",
            format: "esm",
            platform: "browser",
            target: "es2022",
            jsx: "automatic",
            sourcemap: "inline",
            metafile: true,
            define: { "process.env.NODE_ENV": '"development"' },
            tsconfigRaw,
            logLevel: "silent",
            plugins: [plugin],
        });
    } catch (e) {
        const errors = (e as { errors?: esbuild.Message[] }).errors;
        if (!errors?.length) throw e;
        const text = await esbuild.formatMessages(errors, { kind: "error", color: false });
        throw new BuildError(text.join("").replaceAll("app:", "").replaceAll(` [plugin ${plugin.name}]`, "").trim());
    }
    const out = {
        js: result.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "",
        css: result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "",
    };
    const read = Object.keys(result.metafile!.inputs)
        .filter((input) => input.startsWith("app:"))
        .map((input) => files.host(input.slice("app:".length))!);
    builds.delete(key);
    builds.set(key, { inputs: [...read, tsconfig!].map(stamp), out });
    if (builds.size > KEPT_BUILDS) builds.delete(builds.keys().next().value!);
    return out;
}
