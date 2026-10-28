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
// server through and nothing else on this computer.

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { BuildError, bundle, forgetBuilds, SCRIPT } from "./appBundler";
import { installPackages, REGISTRY } from "./appPackages";
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
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join("; "),
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
};

export const APPS_INSTRUCTIONS = `How to make an app: when the user would be helped by something they can look at or use (a planner for their assignments, a tracker, a page of results), make them an app, a web page of your own in ${APPS}/<name>.
- \`start_app\` makes its folder with a package.json and gives the URL it's served at. Open that URL in your browser to try it, and reload after each change.
- ${APPS}/<name>/index.html is the page. Make the app as simple as the need: five lines of HTML is a fine app, and so is a React app. Write its files with bash.
- A page's scripts (\`<script type="module" src="/src/main.tsx">\`) can be TypeScript, JSX or plain JavaScript, and import its other files, its CSS and its packages. They're bundled each time they load: there's no build step, no dev server and no Node to run.
- \`add_package\` adds packages from npm (react, react-dom, date-fns…). Everything runs in the browser, so only browser packages are any use: nothing for Node (express, fs, servers, database drivers) is needed or works.
- An app has no network: it loads only its own files. Gather what it shows with your own tools (the browser, bash, js-exec) and save it in its folder, e.g. as data.json it fetches. It can keep what the user does in it in localStorage.
- If a script doesn't build, the page says why.`;

export const APPS_TOOLS: ToolSpec[] = [
    {
        name: "start_app",
        description: `Make an app's folder, ${APPS}/<name>, with a package.json, and get the URL it's served at (again any time, for one that's made).`,
        inputSchema: {
            type: "object",
            properties: { name: { type: "string", description: `The app's name and folder: ${NAME_RULE}.` } },
            required: ["name"],
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

export class Apps {
    private server: http.Server | null = null;
    private starting: Promise<number> | null = null;
    private installing = new Map<string, Promise<unknown>>();
    port: number | null = null;

    constructor(private o: { home: HomeFolder; portFile: string; registry?: string }) {}

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
            tools: () => APPS_TOOLS,
            instructions: () => APPS_INSTRUCTIONS,
            call: async (name, args): Promise<ToolResult> => {
                try {
                    if (name === "start_app") return { text: await this.startApp(args.name) };
                    if (name === "add_package") return { text: await this.addPackage(args.app, args.packages) };
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

    private async startApp(n: unknown): Promise<string> {
        const { name, dir } = this.folder(n);
        this.o.home.ensure();
        fs.mkdirSync(dir, { recursive: true });
        this.o.home.resolve(`${APPS}/${name}`); // the folders just made are still inside
        const pj = path.join(dir, "package.json");
        if (!fs.existsSync(pj)) fs.writeFileSync(pj, `${JSON.stringify({ name, private: true, dependencies: {} }, null, 2)}\n`);
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
                // that port is someone else's now: the apps move, and their saved data stays at the old origin
                if (!saved || (e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
                console.error(`[ai] the apps' port ${saved} is taken; they move to a new one`);
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
        // another site's page asking for an app's files (a script tag, a form) is refused; the app's own pages and a typed address aren't
        const site = req.headers["sec-fetch-site"];
        if (site && site !== "same-origin" && site !== "none") return text(403, "An app's files are only for its own pages.");
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

    async close() {
        const server = this.server;
        this.server = null;
        if (!server) return;
        server.closeAllConnections();
        await new Promise<void>((ok) => server.close(() => ok()));
    }
}
