// The agent's apps: web pages it makes for the user, each a folder in
// ~/Apps, served the way a dev server would serve them. Every app has its own
// origin, http://<name>.localhost:<port>/, so one can't read another's saved
// data, and the server keeps the same port from one start to the next so
// that data stays. A page's scripts are bundled as they're loaded
// (appBundler.ts), so there is no build step and no Node.
//
// An app reaches nothing but its own files: its pages are sent with a
// Content-Security-Policy that allows only its own origin, and the server
// answers only a request for <name>.localhost:<port> (no other name can be
// pointed at it, DNS rebinding included) from the app's own pages or typed
// in. The agent's browser opens apps through its proxy, which lets this one
// server through and nothing else on this computer. The user opens an app in
// the panel, in a frame; only the panel's own pages may frame one.
//
// The agent names each app and says what it's for. It shows the user an app
// with show_app: a card in the chat with a picture of it, taken in its
// browser. It never opens one on the user's screen itself.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { BuildError, bundle, forgetBuilds, SCRIPT } from "./appBundler";
import { installPackages, REGISTRY } from "./appPackages";
import { LIMITS, type AppEntry, type AppInfo } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { HomeFolder } from "./homeFolder";
import type { Toolset } from "./toolsets";

const APPS = "~/Apps";
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const NAME_RULE = "lowercase letters, digits and dashes, up to 40, e.g. assignment-planner";
const HOST = /^([a-z0-9-]+)\.localhost:(\d+)$/;

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
    ".wasm": "application/wasm",
};

const HEADERS = {
    "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' data: blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-src 'none'",
        // the user's view of it, in the panel and the shell around it: Electron's paperboard: and panel: pages,
        // its development shell on localhost, or browser mode's. Not another app: those are <name>.localhost
        "frame-ancestors paperboard: panel: http://localhost:*",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join("; "),
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
};

export const APPS_INSTRUCTIONS = `**Apps:** when something to look at or use would help (a planner, a tracker, a page of results), make an app: a web page of your own in ${APPS}/<name>.
- **Start:** \`start_app\` makes its folder and gives its URL. Give it a title the user will know it by and one line on what it's for. Open the URL to try it; reload after each change.
- **Build:** write ${APPS}/<name>/index.html and its files with bash, as simply as the need allows. Scripts can be TypeScript, JSX or JavaScript and import files, CSS and packages; they're bundled as they load, with no build step or server.
- **Packages:** \`add_package\` adds browser packages from npm (react, date-fns...). Nothing for Node works.
- **No network:** an app loads only its own files. Save what it shows in its folder (like data.json); it can keep the user's changes in localStorage.
- **Errors:** a script that doesn't build says why on the page.
- **Show it:** \`show_app\` puts a card in the chat that opens it. Show it again after a change worth seeing. Never write its address.
- **Delete:** \`delete_app\`, when the user asks or it's been replaced.`;

const SHOW_APP_LINE = APPS_INSTRUCTIONS.split("\n").find((l) => l.includes("`show_app`"))!;
export const APPS_FLOW_INSTRUCTIONS = APPS_INSTRUCTIONS.replace(`\n${SHOW_APP_LINE}`, "");

export const APPS_TOOLS: ToolSpec[] = [
    {
        name: "start_app",
        description: `Make an app's folder, ${APPS}/<name>, with a package.json, and get the URL it's served at (again any time, for one that's made).`,
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: `The app's name and folder: ${NAME_RULE}.` },
                title: { type: "string", description: `What the user knows it by, like "Assignment planner", up to ${LIMITS.apps.titleChars} characters. Needed for a new app.` },
                description: { type: "string", description: `One line on what it's for, up to ${LIMITS.apps.descriptionChars} characters. Needed for a new app.` },
            },
            required: ["name"],
        },
    },
    {
        name: "show_app",
        description: "Show the user one of your apps: a card in the chat with a picture of it (taken in your browser) and its title and description, which opens it beside the chat. Returns once it's posted.",
        inputSchema: {
            type: "object",
            properties: { app: { type: "string", description: "The app's name." } },
            required: ["app"],
        },
    },
    {
        name: "delete_app",
        description: `Delete an app for good: its folder in ${APPS} and its picture. Cards that showed it can't open it anymore.`,
        inputSchema: {
            type: "object",
            properties: { app: { type: "string", description: "The app's name." } },
            required: ["app"],
        },
    },
    {
        name: "add_package",
        description: "Add packages from npm to an app, for its scripts to import by name. Browser packages only. With none given, installs what its package.json lists.",
        inputSchema: {
            type: "object",
            properties: {
                app: { type: "string", description: "The app's name." },
                packages: { type: "array", items: { type: "string" }, description: "e.g. react, react-dom@19 or @tanstack/react-query." },
            },
            required: ["app"],
        },
    },
];

/** The page a script that didn't build is replaced with: the error in the console and over the page. */
function failedScript(message: string): string {
    return `const message = ${JSON.stringify(message)};
console.error("This app's script didn't build:\\n\\n" + message);
const show = () => {
    const pre = document.createElement("pre");
    pre.textContent = "This app's script didn't build:\\n\\n" + message;
    pre.style.cssText = "position:fixed;inset:0;margin:0;padding:2em;overflow:auto;white-space:pre-wrap;background:#1b1b1b;color:#ff9b9b;font:14px/1.5 ui-monospace,monospace;z-index:2147483647";
    document.documentElement.append(pre);
};
document.readyState === "loading" ? addEventListener("DOMContentLoaded", show) : show();
`;
}

export interface AppsOptions {
    home: HomeFolder;
    portFile: string;
    /** each app's title and description, kept by the service rather than in the agent's files */
    infoFile: string;
    /** each app's picture, <name>.jpg */
    picturesDir: string;
    registry?: string;
    /** a JPEG of a page, from the agent's browser */
    picture(url: string): Promise<string>;
    /** add a card to the conversation */
    post(entry: AppEntry): void;
    /** an app was made, shown, changed or deleted: open lists read again */
    onChange(): void;
}

interface Info {
    title: string;
    description: string;
}

export class Apps {
    private server: http.Server | null = null;
    private starting: Promise<number> | null = null;
    private installing = new Map<string, Promise<unknown>>();
    private watchers: { home: fs.FSWatcher | null; apps: fs.FSWatcher | null } = { home: null, apps: null };
    private seen = "";
    private looking: ReturnType<typeof setTimeout> | null = null;
    port: number | null = null;

    constructor(private o: AppsOptions) {}

    /** Whether a host and port the browser asks for is one of the apps. */
    serves(host: string, port: number): boolean {
        return port === this.port && HOST.test(`${host}:${port}`);
    }

    url(name: string): string {
        return `http://${name}.localhost:${this.port}/`;
    }

    toolset(): Toolset {
        return {
            id: "apps",
            // a flow can't open a card
            tools: (mode) => (mode.fromFlow ? APPS_TOOLS.filter((t) => t.name !== "show_app") : APPS_TOOLS),
            instructions: (mode) => (mode.fromFlow ? APPS_FLOW_INSTRUCTIONS : APPS_INSTRUCTIONS),
            call: async (name, args): Promise<ToolResult> => {
                try {
                    if (name === "start_app") return { text: await this.startApp(args.name, args.title, args.description) };
                    if (name === "add_package") return { text: await this.addPackage(args.app, args.packages) };
                    if (name === "show_app") return { text: await this.show(args.app) };
                    if (name === "delete_app") {
                        const { name: app } = this.remove(args.app);
                        return { text: `${APPS}/${app} is deleted. A checkpoint from before now still has it.` };
                    }
                    return { text: `unknown tool ${name}`, isError: true };
                } catch (e) {
                    return { text: e instanceof Error ? e.message : String(e), isError: true };
                }
            },
        };
    }

    private folder(name: unknown): { name: string; dir: string } {
        if (typeof name !== "string" || !NAME.test(name)) throw new Error(`an app's name is ${NAME_RULE}`);
        return { name, dir: this.o.home.resolve(`${APPS}/${name}`) };
    }

    private async startApp(n: unknown, title: unknown, description: unknown): Promise<string> {
        const { name, dir } = this.folder(n);
        const infos = this.readInfo();
        const was = infos[name];
        const given = (v: unknown, what: string, max: number) => {
            if (v === undefined) return undefined;
            if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new Error(`an app's ${what} is up to ${max} characters`);
            return v.trim().replace(/\s+/g, " ");
        };
        const t = given(title, "title", LIMITS.apps.titleChars) ?? was?.title;
        const d = given(description, "description", LIMITS.apps.descriptionChars) ?? was?.description;
        if (!t || !d) throw new Error("give a new app a title and a description: they're how the user knows it");
        this.o.home.ensure();
        fs.mkdirSync(dir, { recursive: true });
        this.o.home.resolve(`${APPS}/${name}`); // the folders just made are still inside
        const pj = path.join(dir, "package.json");
        if (!fs.existsSync(pj)) fs.writeFileSync(pj, `${JSON.stringify({ name, private: true, dependencies: {} }, null, 2)}\n`);
        if (was?.title !== t || was?.description !== d) {
            this.writeInfo({ ...infos, [name]: { title: t, description: d } });
            this.o.onChange();
        }
        await this.start();
        const page = fs.existsSync(path.join(dir, "index.html")) ? "" : ` It shows ${APPS}/${name}/index.html once there is one.`;
        return `${APPS}/${name} is served at ${this.url(name)}${page}`;
    }

    private async addPackage(n: unknown, packages: unknown): Promise<string> {
        const { name, dir } = this.folder(n);
        if (!fs.existsSync(path.join(dir, "package.json"))) throw new Error(`there's no app called ${name}: make it with start_app first`);
        if (packages !== undefined && (!Array.isArray(packages) || packages.some((p) => typeof p !== "string"))) throw new Error("packages is a list of package names");
        // one install at a time for an app: each replaces its node_modules
        // (the one before's failure was its caller's to report)
        const install = () => installPackages(dir, (packages as string[] | undefined) ?? [], this.o.registry ?? REGISTRY);
        const before = this.installing.get(name) ?? Promise.resolve();
        const run = before.then(install, install);
        this.installing.set(name, run);
        const done = await run.finally(() => forgetBuilds(dir));
        const list = done.direct.map((d) => `${d.name}@${d.version}`).join(", ");
        return done.direct.length
            ? `${APPS}/${name} has ${list} (${done.count} package${done.count === 1 ? "" : "s"} in all). Its scripts import them by name.`
            : `${APPS}/${name}'s package.json lists no packages.`;
    }

    private async show(n: unknown): Promise<string> {
        const { name, dir } = this.existing(n);
        const info = this.readInfo()[name];
        if (!info) throw new Error(`give ${name} a title and a description first, with start_app`);
        if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`${APPS}/${name} has no index.html to show yet`);
        await this.start();
        let image: string;
        try {
            image = await this.o.picture(this.url(name));
        } catch (e) {
            throw new Error(`${name} wasn't shown: its picture couldn't be taken (${e instanceof Error ? e.message : String(e)})`);
        }
        fs.mkdirSync(this.o.picturesDir, { recursive: true });
        fs.writeFileSync(path.join(this.o.picturesDir, `${name}.jpg`), Buffer.from(image, "base64"));
        this.o.post({ id: crypto.randomBytes(6).toString("hex"), at: Date.now(), kind: "app", app: name, title: info.title, description: info.description });
        this.o.onChange();
        return `Showed ${info.title} to the user as a card in the chat. They open it from there, beside the chat.`;
    }

    /** The apps in ~/Apps, newest first. A folder made some other way than start_app goes by its name. */
    list(): AppInfo[] {
        let names: string[];
        try {
            names = fs.readdirSync(this.o.home.resolve(APPS), { withFileTypes: true }).filter((e) => e.isDirectory() && NAME.test(e.name)).map((e) => e.name);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw e;
        }
        const infos = this.readInfo();
        const made = (name: string) => {
            const st = fs.statSync(this.folder(name).dir);
            return st.birthtimeMs || st.mtimeMs;
        };
        return names
            .sort((a, b) => made(b) - made(a))
            .map((name) => ({
                name,
                title: infos[name]?.title ?? name,
                description: infos[name]?.description ?? "",
                picture: fs.existsSync(path.join(this.o.picturesDir, `${name}.jpg`)),
            }));
    }

    /** Where the user's view opens an app: its address, with the server started for it. */
    async open(n: unknown): Promise<{ url: string; title: string }> {
        const { name } = this.existing(n);
        await this.start();
        return { url: this.url(name), title: this.readInfo()[name]?.title ?? name };
    }

    pictureOf(n: unknown): { image: string } {
        const { name } = this.existing(n);
        const file = path.join(this.o.picturesDir, `${name}.jpg`);
        if (!fs.existsSync(file)) throw new Error(`there's no picture of ${name} yet`);
        return { image: fs.readFileSync(file).toString("base64") };
    }

    /** Delete an app for good: its folder, its title and description, and its picture. */
    remove(n: unknown): { name: string } {
        const { name, dir } = this.existing(n);
        forgetBuilds(dir);
        fs.rmSync(dir, { recursive: true, force: true });
        const infos = this.readInfo();
        if (infos[name]) {
            delete infos[name];
            this.writeInfo(infos);
        }
        fs.rmSync(path.join(this.o.picturesDir, `${name}.jpg`), { force: true });
        this.o.onChange();
        return { name };
    }

    private existing(n: unknown): { name: string; dir: string } {
        const f = this.folder(n);
        if (!fs.statSync(f.dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`there's no app called ${f.name}`);
        return f;
    }

    private readInfo(): Record<string, Info> {
        let raw: string;
        try {
            raw = fs.readFileSync(this.o.infoFile, "utf8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
            throw e;
        }
        try {
            return JSON.parse(raw).apps ?? {};
        } catch (e) {
            // never replaced by an empty list: every app's title would go
            throw new Error(`the apps' titles can't be read (${this.o.infoFile}): ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private writeInfo(apps: Record<string, Info>) {
        fs.writeFileSync(`${this.o.infoFile}.tmp`, JSON.stringify({ apps }));
        fs.renameSync(`${this.o.infoFile}.tmp`, this.o.infoFile);
    }

    /** The server, started once; on the port it had before when that's free. */
    private start(): Promise<number> {
        this.starting ??= (async () => {
            let saved = 0;
            try {
                saved = Number(JSON.parse(fs.readFileSync(this.o.portFile, "utf8")).port) || 0;
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("[ai] the apps' saved port couldn't be read:", String(e));
            }
            const server = http.createServer((req, res) => {
                this.handle(req, res).catch((e) => {
                    console.error("[ai] an app's request failed:", e);
                    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
                    res.end(`The app server failed: ${e instanceof Error ? e.message : String(e)}`);
                });
            });
            const listen = (port: number) =>
                new Promise<void>((ok, fail) => {
                    server.once("error", fail);
                    server.listen(port, "127.0.0.1", () => {
                        server.off("error", fail);
                        ok();
                    });
                });
            try {
                await listen(saved);
            } catch (e) {
                // that port is someone else's now, or the system keeps it (Windows reserves ranges of
                // ports anew at each boot): the apps move, and their saved data stays at the old origin
                const code = (e as NodeJS.ErrnoException).code;
                if (!saved || (code !== "EADDRINUSE" && code !== "EACCES")) throw e;
                console.error(`[ai] the apps' port ${saved} can't be opened (${code}); they move to a new one`);
                await listen(0);
            }
            this.server = server;
            this.port = (server.address() as AddressInfo).port;
            fs.writeFileSync(this.o.portFile, JSON.stringify({ port: this.port }));
            return this.port;
        })();
        this.starting.catch(() => (this.starting = null));
        return this.starting;
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
        const text = (status: number, body: string) => res.writeHead(status, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end(body);
        const m = (req.headers.host ?? "").match(HOST);
        if (!m || Number(m[2]) !== this.port || !NAME.test(m[1]!)) return text(421, "This server only serves the agent's apps, at <name>.localhost.");
        // another site's page asking for an app's files (a script tag, a form) is refused; the app's own pages, a typed
        // address and opening it in a frame aren't (who may frame it is the page's frame-ancestors: only the panel)
        const site = req.headers["sec-fetch-site"];
        const framed = req.headers["sec-fetch-dest"] === "iframe" && req.headers["sec-fetch-mode"] === "navigate";
        if (site && site !== "same-origin" && site !== "none" && !framed) return text(403, "An app's files are only for its own pages.");
        if (req.method !== "GET" && req.method !== "HEAD") return text(405, "An app's server only sends its files.");
        const name = m[1]!;
        const { dir } = this.folder(name);
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return text(404, `There's no app called ${name}. The agent makes one with start_app.`);

        let rel: string;
        try {
            rel = decodeURIComponent(new URL(req.url ?? "/", "http://app").pathname);
        } catch {
            res.writeHead(400, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" });
            return res.end("That address isn't a file's.");
        }
        const root = fs.realpathSync(dir);
        let full = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
        // only what's in this app's folder, links followed: not another app's, not the rest of ~
        const inside = (p: string) => {
            if (!fs.existsSync(p)) return false;
            const real = fs.realpathSync(p);
            return real === root || real.startsWith(root + path.sep);
        };
        if (inside(full) && fs.statSync(full).isDirectory()) full = path.join(full, "index.html");
        const shown = `${APPS}/${name}/${path.relative(root, full).split(path.sep).join("/")}`;
        if (rel.includes("\0") || !inside(full) || !fs.statSync(full).isFile()) return text(404, `There's no file at ${shown}.`);

        const appPath = `/${path.relative(root, full).split(path.sep).join("/")}`;
        if (SCRIPT.test(full)) {
            let js: string;
            try {
                const out = await bundle(root, appPath);
                js = out.css ? `{ const style = document.createElement("style"); style.textContent = ${JSON.stringify(out.css)}; document.head.append(style); }\n${out.js}` : out.js;
            } catch (e) {
                if (!(e instanceof BuildError)) throw e;
                js = failedScript(e.message);
            }
            res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[".js"]! });
            return res.end(req.method === "HEAD" ? undefined : js);
        }
        const data = fs.readFileSync(full);
        res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream", "Content-Length": data.length });
        res.end(req.method === "HEAD" ? undefined : data);
    }

    /**
     * Follow ~/Apps for folders made or removed some other way than the tools,
     * like the agent's shell or the user: the list changes for them too.
     */
    watch() {
        this.seen = this.names();
        const home = this.o.home.resolve("~");
        this.watchers.home = fs.watch(home, () => this.look());
        this.watchers.home.on("error", (e) => console.error("[ai] the home folder can't be followed for apps:", String(e)));
        this.followApps();
    }

    private followApps() {
        if (this.watchers.apps) return;
        const dir = this.o.home.resolve(APPS);
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
        const watcher = fs.watch(dir, () => this.look());
        watcher.on("error", (e) => {
            // ~/Apps itself was removed: it's followed again once it's back
            watcher.close();
            if (this.watchers.apps === watcher) this.watchers.apps = null;
            if ((e as NodeJS.ErrnoException).code !== "ENOENT" && (e as NodeJS.ErrnoException).code !== "EPERM") console.error("[ai] ~/Apps can't be followed:", String(e));
            this.look();
        });
        this.watchers.apps = watcher;
    }

    /** A burst of changes is read once, and only a different list is a change. */
    private look() {
        if (this.looking) return;
        this.looking = setTimeout(() => {
            this.looking = null;
            try {
                if (this.watchers.apps && !fs.existsSync(this.o.home.resolve(APPS))) {
                    this.watchers.apps.close();
                    this.watchers.apps = null;
                }
                this.followApps();
                const now = this.names();
                if (now === this.seen) return;
                this.seen = now;
                this.o.onChange();
            } catch (e) {
                console.error("[ai] the apps couldn't be listed after a change:", String(e));
            }
        }, 100);
    }

    private names(): string {
        return JSON.stringify(this.list().map((a) => a.name).sort());
    }

    async close() {
        if (this.looking) clearTimeout(this.looking);
        this.looking = null;
        this.watchers.home?.close();
        this.watchers.apps?.close();
        this.watchers = { home: null, apps: null };
        const server = this.server;
        this.server = null;
        if (!server) return;
        server.closeAllConnections();
        await new Promise<void>((ok) => server.close(() => ok()));
    }
}
