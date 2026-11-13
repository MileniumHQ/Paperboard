// The agent's pages: web pages it makes for the user, each a folder in
// ~/Pages, served the way a dev server would serve them. A page is an app,
// something to use, or a document, something to read, print or keep, whose
// view has Print and Save as PDF. Every page has its own origin,
// http://<name>.localhost:<port>/, so one can't read another's saved data,
// and the server keeps the same port from one start to the next so that data
// stays. A page's scripts are bundled as they're loaded (appBundler.ts), so
// there is no build step and no Node. Pages were called apps; ~/Apps is
// moved to ~/Pages, and the service's own files keep their old names.
//
// A page reaches nothing but its own files: its pages are sent with a
// Content-Security-Policy that allows only its own origin, and the server
// answers only a request for <name>.localhost:<port> (no other name can be
// pointed at it, DNS rebinding included) from the page's own pages or typed
// in. The agent's browser opens pages through its proxy, which lets this one
// server through and nothing else on this computer. The user opens a page in
// the panel, in a frame; only the panel's own pages may frame one.
//
// Every HTML file is sent with a small script of the server's (LIVE): it
// reloads the page when a file in its folder changes, wherever it's open, and
// prints it when the panel's view asks (a frame from another origin can't be
// printed from outside).
//
// The agent names each page and says what it's for. It shows the user a page
// with show_page: a card in the chat with a picture of it, taken in its
// browser. It never opens one on the user's screen itself.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { BuildError, bundle, forgetBuilds, SCRIPT } from "./appBundler";
import { installPackages, REGISTRY } from "./appPackages";
import { LIMITS, PAGE_KINDS, type PageEntry, type PageInfo, type PageKind } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { HomeFolder } from "./homeFolder";
import type { Toolset } from "./toolsets";

const PAGES = "~/Pages";
/** where pages were before they were called pages */
const OLD_PAGES = "~/Apps";
/** the server's own addresses on every page's origin; a page's files can't be there */
const OWN = "/__paperboard/";
const CHANGES = `${OWN}changes`;
// a page is reloaded once a burst of writes is over, not for each
const SETTLE_MS = 150;
// a quiet stream is kept open with a comment: the agent's browser reaches pages through its proxy
const PING_MS = 20_000;
// a page's folders followed for changes, at most: node_modules is never one of them
const MAX_FOLLOWED_DIRS = 256;

/** The script every HTML file is sent with: reload on a change, print when the panel's view asks. */
const LIVE = `<script>(() => {
    new EventSource(${JSON.stringify(CHANGES)}).onmessage = () => location.reload();
    addEventListener("message", (e) => {
        if (e.source === parent && e.data && e.data.type === "paperboard:print") print();
    });
})();</script>`;
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
        // its development shell on localhost, or browser mode's. Not another page: those are <name>.localhost
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

const PAGES_WHEN = `**Pages:** when the user would rather look at, use or keep something than read it in a text, make a page: an \`app\` to use (a planner, a tracker, a page of results) or a \`document\` to read, print or keep (a birthday card, a letter, a flyer, a report). \`start_page\`, write its files with \`bash\`, and open it in your browser to check it looks right.`;
export const PAGES_INSTRUCTIONS = `${PAGES_WHEN} Then \`show_page\`, and again after a change worth seeing. Never write a page's address. \`delete_page\` only when the user asks or it's been replaced.`;
export const PAGES_FLOW_INSTRUCTIONS = `${PAGES_WHEN} Name it by its title in your reply; the user opens it from their pages. \`delete_page\` only when the user asks or it's been replaced.`;

const PAGE_ARG = { page: { type: "string", description: "The page's name." } };

export const PAGE_TOOLS: ToolSpec[] = [
    {
        name: "start_page",
        description:
            `Make a page's folder, ${PAGES}/<name>, with a package.json, and get the URL it's served at (again any time, for one that's made, or to change its title, description or kind). ` +
            `Then write ${PAGES}/<name>/index.html and its files with bash, as simply as the need allows. Scripts can be TypeScript, JSX or JavaScript and import files, CSS and packages: they're bundled as they load, with no build step or server. ` +
            "A page loads only its own files, never the network: save what it shows in its folder (like data.json); an app can keep the user's changes in localStorage. " +
            "Wherever it's open, a page reloads by itself when one of its files changes. A script that doesn't build says why on the page. " +
            "A document is printed and saved as a PDF from its view: give it print CSS (@page size and margins, no buttons of its own for that) so it prints on whole pages.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: `The page's name and folder: ${NAME_RULE}.` },
                kind: { type: "string", enum: [...PAGE_KINDS], description: "app: something to use. document: something to read, print or keep; its view has Print and Save as PDF. Needed for a new page." },
                title: { type: "string", description: `What the user knows it by, like "Assignment planner", up to ${LIMITS.pages.titleChars} characters. Needed for a new page.` },
                description: { type: "string", description: `One line on what it's for, up to ${LIMITS.pages.descriptionChars} characters. Needed for a new page.` },
            },
            required: ["name"],
        },
    },
    {
        name: "show_page",
        description: "Show the user one of your pages: a card in the chat with a picture of it (taken in your browser) and its title and description, which opens it beside the chat. Returns once it's posted.",
        inputSchema: { type: "object", properties: PAGE_ARG, required: ["page"] },
    },
    {
        name: "delete_page",
        description: `Delete a page for good: its folder in ${PAGES} and its picture. Cards that showed it can't open it anymore.`,
        inputSchema: { type: "object", properties: PAGE_ARG, required: ["page"] },
    },
    {
        name: "add_package",
        description: "Add packages from npm to a page, for its scripts to import by name. Browser packages only: nothing for Node works. With none given, installs what its package.json lists (after a restore, say).",
        inputSchema: {
            type: "object",
            properties: {
                ...PAGE_ARG,
                packages: { type: "array", items: { type: "string" }, description: "e.g. react, react-dom@19 or @tanstack/react-query." },
            },
            required: ["page"],
        },
    },
];

/** The page a script that didn't build is replaced with: the error in the console and over the page. */
function failedScript(message: string): string {
    return `const message = ${JSON.stringify(message)};
console.error("This page's script didn't build:\\n\\n" + message);
const show = () => {
    const pre = document.createElement("pre");
    pre.textContent = "This page's script didn't build:\\n\\n" + message;
    pre.style.cssText = "position:fixed;inset:0;margin:0;padding:2em;overflow:auto;white-space:pre-wrap;background:#1b1b1b;color:#ff9b9b;font:14px/1.5 ui-monospace,monospace;z-index:2147483647";
    document.documentElement.append(pre);
};
document.readyState === "loading" ? addEventListener("DOMContentLoaded", show) : show();
`;
}

export interface PagesOptions {
    home: HomeFolder;
    portFile: string;
    /** each page's title, description and kind, kept by the service rather than in the agent's files */
    infoFile: string;
    /** each page's picture, <name>.jpg */
    picturesDir: string;
    /** where a page saved as a PDF waits for the user to save it somewhere */
    exportsDir: string;
    registry?: string;
    /** a JPEG of a page, from the agent's browser */
    picture(url: string): Promise<string>;
    /** a page printed to a PDF, from the agent's browser */
    pdf(url: string): Promise<Buffer>;
    /** add a card to the conversation */
    post(entry: PageEntry): void;
    /** a page was made, shown, changed or deleted: open lists read again */
    onChange(): void;
}

interface Info {
    title: string;
    description: string;
    /** pages made before there were kinds are apps */
    kind?: PageKind;
}

/** Everyone with a page open, told when one of its files changes. */
interface Followers {
    watcher: FolderWatch;
    streams: Set<http.ServerResponse>;
    settle: ReturnType<typeof setTimeout> | null;
}

export class Pages {
    private server: http.Server | null = null;
    private starting: Promise<number> | null = null;
    private installing = new Map<string, Promise<unknown>>();
    private watchers: { home: fs.FSWatcher | null; pages: fs.FSWatcher | null } = { home: null, pages: null };
    private following = new Map<string, Followers>();
    private pinging: ReturnType<typeof setInterval> | null = null;
    private seen = "";
    private looking: ReturnType<typeof setTimeout> | null = null;
    port: number | null = null;

    constructor(private o: PagesOptions) {}

    /** Whether a host and port the browser asks for is one of the pages. */
    serves(host: string, port: number): boolean {
        return port === this.port && HOST.test(`${host}:${port}`);
    }

    url(name: string): string {
        return `http://${name}.localhost:${this.port}/`;
    }

    toolset(): Toolset {
        return {
            id: "pages",
            // a flow can't open a card
            tools: (mode) => (mode.fromFlow ? PAGE_TOOLS.filter((t) => t.name !== "show_page") : PAGE_TOOLS),
            instructions: (mode) => (mode.fromFlow ? PAGES_FLOW_INSTRUCTIONS : PAGES_INSTRUCTIONS),
            call: async (name, args): Promise<ToolResult> => {
                try {
                    if (name === "start_page") return { text: await this.startPage(args.name, args.kind, args.title, args.description) };
                    if (name === "add_package") return { text: await this.addPackage(args.page, args.packages) };
                    if (name === "show_page") return { text: await this.show(args.page) };
                    if (name === "delete_page") {
                        const { name: page } = this.remove(args.page);
                        return { text: `${PAGES}/${page} is deleted. A checkpoint from before now still has it.` };
                    }
                    return { text: `unknown tool ${name}`, isError: true };
                } catch (e) {
                    return { text: e instanceof Error ? e.message : String(e), isError: true };
                }
            },
        };
    }

    private folder(name: unknown): { name: string; dir: string } {
        if (typeof name !== "string" || !NAME.test(name)) throw new Error(`a page's name is ${NAME_RULE}`);
        return { name, dir: this.o.home.resolve(`${PAGES}/${name}`) };
    }

    private async startPage(n: unknown, kind: unknown, title: unknown, description: unknown): Promise<string> {
        const { name, dir } = this.folder(n);
        const infos = this.readInfo();
        const was = infos[name];
        const given = (v: unknown, what: string, max: number) => {
            if (v === undefined) return undefined;
            if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new Error(`a page's ${what} is up to ${max} characters`);
            return v.trim().replace(/\s+/g, " ");
        };
        if (kind !== undefined && !PAGE_KINDS.includes(kind as PageKind)) throw new Error(`a page's kind is ${PAGE_KINDS.join(" or ")}`);
        const t = given(title, "title", LIMITS.pages.titleChars) ?? was?.title;
        const d = given(description, "description", LIMITS.pages.descriptionChars) ?? was?.description;
        const k = (kind as PageKind | undefined) ?? (was ? (was.kind ?? "app") : undefined);
        if (!t || !d || !k) throw new Error("give a new page a kind, a title and a description: they're how the user knows it");
        this.o.home.ensure();
        this.moveOldPages();
        fs.mkdirSync(dir, { recursive: true });
        this.o.home.resolve(`${PAGES}/${name}`); // the folders just made are still inside
        const pj = path.join(dir, "package.json");
        if (!fs.existsSync(pj)) fs.writeFileSync(pj, `${JSON.stringify({ name, private: true, dependencies: {} }, null, 2)}\n`);
        if (was?.title !== t || was?.description !== d || (was.kind ?? "app") !== k) {
            this.writeInfo({ ...infos, [name]: { title: t, description: d, kind: k } });
            this.o.onChange();
        }
        await this.start();
        const page = fs.existsSync(path.join(dir, "index.html")) ? "" : ` It shows ${PAGES}/${name}/index.html once there is one.`;
        return `${PAGES}/${name} (${k === "document" ? "a document" : "an app"}) is served at ${this.url(name)}${page}`;
    }

    private async addPackage(n: unknown, packages: unknown): Promise<string> {
        const { name, dir } = this.folder(n);
        if (!fs.existsSync(path.join(dir, "package.json"))) throw new Error(`there's no page called ${name}: make it with start_page first`);
        if (packages !== undefined && (!Array.isArray(packages) || packages.some((p) => typeof p !== "string"))) throw new Error("packages is a list of package names");
        // one install at a time for a page: each replaces its node_modules
        // (the one before's failure was its caller's to report)
        const install = () => installPackages(dir, (packages as string[] | undefined) ?? [], this.o.registry ?? REGISTRY);
        const before = this.installing.get(name) ?? Promise.resolve();
        const run = before.then(install, install);
        this.installing.set(name, run);
        const done = await run.finally(() => forgetBuilds(dir));
        const list = done.direct.map((d) => `${d.name}@${d.version}`).join(", ");
        return done.direct.length
            ? `${PAGES}/${name} has ${list} (${done.count} package${done.count === 1 ? "" : "s"} in all). Its scripts import them by name.`
            : `${PAGES}/${name}'s package.json lists no packages.`;
    }

    private async show(n: unknown): Promise<string> {
        const { name, dir } = this.existing(n);
        const info = this.readInfo()[name];
        if (!info) throw new Error(`give ${name} a kind, a title and a description first, with start_page`);
        if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`${PAGES}/${name} has no index.html to show yet`);
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

    /** The pages in ~/Pages, newest first. A folder made some other way than start_page goes by its name. */
    list(): PageInfo[] {
        let names: string[];
        try {
            names = fs.readdirSync(this.o.home.resolve(PAGES), { withFileTypes: true }).filter((e) => e.isDirectory() && NAME.test(e.name)).map((e) => e.name);
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
                kind: infos[name]?.kind ?? "app",
                picture: fs.existsSync(path.join(this.o.picturesDir, `${name}.jpg`)),
            }));
    }

    /** Where the user's view opens a page: its address and kind, with the server started for it. */
    async open(n: unknown): Promise<{ url: string; title: string; kind: PageKind }> {
        const { name } = this.existing(n);
        await this.start();
        const info = this.readInfo()[name];
        return { url: this.url(name), title: info?.title ?? name, kind: info?.kind ?? "app" };
    }

    pictureOf(n: unknown): { image: string } {
        const { name } = this.existing(n);
        const file = path.join(this.o.picturesDir, `${name}.jpg`);
        if (!fs.existsSync(file)) throw new Error(`there's no picture of ${name} yet`);
        return { image: fs.readFileSync(file).toString("base64") };
    }

    /**
     * A page printed to a PDF in the agent's browser, written where the panel's view can save it from: `file` is
     * its path in the panel's storage. The view discards it once the user has chosen (discardPdf).
     */
    async pdf(n: unknown): Promise<{ file: string; name: string }> {
        const { name, dir } = this.existing(n);
        if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`${name} has no index.html to save yet`);
        await this.start();
        const data = await this.o.pdf(this.url(name));
        fs.mkdirSync(this.o.exportsDir, { recursive: true });
        const file = `${name}-${crypto.randomBytes(4).toString("hex")}.pdf`;
        fs.writeFileSync(path.join(this.o.exportsDir, file), data);
        const title = this.readInfo()[name]?.title ?? name;
        return { file: `${path.basename(this.o.exportsDir)}/${file}`, name: `${title.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "").trim() || name}.pdf` };
    }

    /** A PDF the view has saved (or the user didn't want): it goes. */
    discardPdf(file: unknown) {
        const base = `${path.basename(this.o.exportsDir)}/`;
        if (typeof file !== "string" || !file.startsWith(base) || !/^[a-z0-9-]+-[0-9a-f]{8}\.pdf$/.test(file.slice(base.length))) throw new Error("that isn't a page's PDF");
        fs.rmSync(path.join(this.o.exportsDir, file.slice(base.length)), { force: true });
    }

    /** Delete a page for good: its folder, its title and description, and its picture. */
    remove(n: unknown): { name: string } {
        const { name, dir } = this.existing(n);
        this.unfollow(name);
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
        if (!fs.statSync(f.dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`there's no page called ${f.name}`);
        return f;
    }

    // the file is still app-info.json with an "apps" list: it's the service's own, and moving it gains nothing
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
            // never replaced by an empty list: every page's title would go
            throw new Error(`the pages' titles can't be read (${this.o.infoFile}): ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private writeInfo(pages: Record<string, Info>) {
        fs.writeFileSync(`${this.o.infoFile}.tmp`, JSON.stringify({ apps: pages }));
        fs.renameSync(`${this.o.infoFile}.tmp`, this.o.infoFile);
    }

    /**
     * ~/Apps, from before pages were called pages (or back from an old checkpoint), becomes ~/Pages. A page
     * already in ~/Pages under the same name stays where it was, and nothing is ever written over.
     */
    private moveOldPages() {
        const old = this.o.home.resolve(OLD_PAGES);
        if (!fs.statSync(old, { throwIfNoEntry: false })?.isDirectory()) return;
        const now = this.o.home.resolve(PAGES);
        if (!fs.existsSync(now)) {
            fs.renameSync(old, now);
            console.log(`[ai] ${OLD_PAGES} is now ${PAGES}`);
            return;
        }
        const left: string[] = [];
        for (const e of fs.readdirSync(old)) {
            const to = path.join(now, e);
            if (fs.existsSync(to)) left.push(e);
            else fs.renameSync(path.join(old, e), to);
        }
        if (!left.length) fs.rmdirSync(old);
        else console.error(`[ai] ${left.join(", ")} stay in ${OLD_PAGES}: ${PAGES} has ones by the same name already`);
    }

    /** The server, started once; on the port it had before when that's free. */
    private start(): Promise<number> {
        this.starting ??= (async () => {
            let saved = 0;
            try {
                saved = Number(JSON.parse(fs.readFileSync(this.o.portFile, "utf8")).port) || 0;
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("[ai] the pages' saved port couldn't be read:", String(e));
            }
            const server = http.createServer((req, res) => {
                this.handle(req, res).catch((e) => {
                    console.error("[ai] a page's request failed:", e);
                    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
                    res.end(`The pages' server failed: ${e instanceof Error ? e.message : String(e)}`);
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
                // ports anew at each boot): the pages move, and their saved data stays at the old origin
                const code = (e as NodeJS.ErrnoException).code;
                if (!saved || (code !== "EADDRINUSE" && code !== "EACCES")) throw e;
                console.error(`[ai] the pages' port ${saved} can't be opened (${code}); they move to a new one`);
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
        if (!m || Number(m[2]) !== this.port || !NAME.test(m[1]!)) return text(421, "This server only serves the agent's pages, at <name>.localhost.");
        // another site's page asking for a page's files (a script tag, a form) is refused; the page's own files, a typed
        // address and opening it in a frame aren't (who may frame it is the page's frame-ancestors: only the panel)
        const site = req.headers["sec-fetch-site"];
        const framed = req.headers["sec-fetch-dest"] === "iframe" && req.headers["sec-fetch-mode"] === "navigate";
        if (site && site !== "same-origin" && site !== "none" && !framed) return text(403, "A page's files are only for its own pages.");
        if (req.method !== "GET" && req.method !== "HEAD") return text(405, "A page's server only sends its files.");
        const name = m[1]!;
        const { dir } = this.folder(name);
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return text(404, `There's no page called ${name}. The agent makes one with start_page.`);

        let rel: string;
        try {
            rel = decodeURIComponent(new URL(req.url ?? "/", "http://page").pathname);
        } catch {
            res.writeHead(400, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" });
            return res.end("That address isn't a file's.");
        }
        if (rel === CHANGES) return this.follow(name, dir, res);
        if (rel.startsWith(OWN)) return text(404, `${OWN} is the pages' server's own; a page's files can't be there.`);
        const root = fs.realpathSync(dir);
        let full = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
        // only what's in this page's folder, links followed: not another page's, not the rest of ~
        const inside = (p: string) => {
            if (!fs.existsSync(p)) return false;
            const real = fs.realpathSync(p);
            return real === root || real.startsWith(root + path.sep);
        };
        if (inside(full) && fs.statSync(full).isDirectory()) full = path.join(full, "index.html");
        const shown = `${PAGES}/${name}/${path.relative(root, full).split(path.sep).join("/")}`;
        if (rel.includes("\0") || !inside(full) || !fs.statSync(full).isFile()) return text(404, `There's no file at ${shown}.`);

        const pagePath = `/${path.relative(root, full).split(path.sep).join("/")}`;
        if (SCRIPT.test(full)) {
            let js: string;
            try {
                const out = await bundle(root, pagePath);
                js = out.css ? `{ const style = document.createElement("style"); style.textContent = ${JSON.stringify(out.css)}; document.head.append(style); }\n${out.js}` : out.js;
            } catch (e) {
                if (!(e instanceof BuildError)) throw e;
                js = failedScript(e.message);
            }
            res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[".js"]! });
            return res.end(req.method === "HEAD" ? undefined : js);
        }
        const ext = path.extname(full).toLowerCase();
        const data = ext === ".html" || ext === ".htm" ? withLive(fs.readFileSync(full, "utf8")) : fs.readFileSync(full);
        res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[ext] ?? "application/octet-stream", "Content-Length": data.length });
        res.end(req.method === "HEAD" ? undefined : data);
    }

    /** A page open somewhere follows its folder: one event each time its files have changed (node_modules aside). */
    private follow(name: string, dir: string, res: http.ServerResponse) {
        let f = this.following.get(name);
        if (!f) {
            const watcher = watchFolder(dir, () => {
                const now = this.following.get(name);
                if (!now || now.settle) return;
                now.settle = setTimeout(() => {
                    now.settle = null;
                    for (const r of now.streams) r.write("data: changed\n\n");
                }, SETTLE_MS);
            }, () => this.unfollow(name));
            f = { watcher, streams: new Set(), settle: null };
            this.following.set(name, f);
        }
        const followers = f;
        followers.streams.add(res);
        res.writeHead(200, { ...HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
        res.write(": following\n\n");
        res.on("close", () => {
            followers.streams.delete(res);
            if (!followers.streams.size && this.following.get(name) === followers) this.unfollow(name);
        });
        this.pinging ??= setInterval(() => {
            for (const g of this.following.values()) for (const r of g.streams) r.write(": ping\n\n");
        }, PING_MS);
    }

    private unfollow(name: string) {
        const f = this.following.get(name);
        if (!f) return;
        this.following.delete(name);
        if (f.settle) clearTimeout(f.settle);
        f.watcher.close();
        for (const r of f.streams) r.end();
        if (!this.following.size && this.pinging) {
            clearInterval(this.pinging);
            this.pinging = null;
        }
    }

    /**
     * Follow ~/Pages for folders made or removed some other way than the tools,
     * like the agent's shell or the user: the list changes for them too.
     */
    watch() {
        this.moveOldPages();
        this.seen = this.names();
        const home = this.o.home.resolve("~");
        this.watchers.home = fs.watch(home, () => this.look());
        this.watchers.home.on("error", (e) => console.error("[ai] the home folder can't be followed for pages:", String(e)));
        this.followPages();
    }

    private followPages() {
        if (this.watchers.pages) return;
        const dir = this.o.home.resolve(PAGES);
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
        const watcher = fs.watch(dir, () => this.look());
        watcher.on("error", (e) => {
            // ~/Pages itself was removed: it's followed again once it's back
            watcher.close();
            if (this.watchers.pages === watcher) this.watchers.pages = null;
            if ((e as NodeJS.ErrnoException).code !== "ENOENT" && (e as NodeJS.ErrnoException).code !== "EPERM") console.error("[ai] ~/Pages can't be followed:", String(e));
            this.look();
        });
        this.watchers.pages = watcher;
    }

    /** A burst of changes is read once, and only a different list is a change. */
    private look() {
        if (this.looking) return;
        this.looking = setTimeout(() => {
            this.looking = null;
            try {
                // an old checkpoint restored brings back ~/Apps: its pages join the others
                this.moveOldPages();
                if (this.watchers.pages && !fs.existsSync(this.o.home.resolve(PAGES))) {
                    this.watchers.pages.close();
                    this.watchers.pages = null;
                }
                this.followPages();
                const now = this.names();
                if (now === this.seen) return;
                this.seen = now;
                this.o.onChange();
            } catch (e) {
                console.error("[ai] the pages couldn't be listed after a change:", String(e));
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
        this.watchers.pages?.close();
        this.watchers = { home: null, pages: null };
        for (const name of [...this.following.keys()]) this.unfollow(name);
        const server = this.server;
        this.server = null;
        if (!server) return;
        server.closeAllConnections();
        await new Promise<void>((ok) => server.close(() => ok()));
    }
}

/** An HTML file with the server's script in its head (or at its start, when it has none). */
function withLive(html: string): Buffer {
    const head = html.match(/<head(\s[^>]*)?>/i);
    const out = head ? html.slice(0, head.index! + head[0].length) + LIVE + html.slice(head.index! + head[0].length) : LIVE + html;
    return Buffer.from(out, "utf8");
}

interface FolderWatch {
    close(): void;
}

/**
 * A page's folder and the folders in it, followed for changes, but never node_modules: a recursive watch on Linux
 * follows every folder below, and one package install would take thousands. A new folder is followed as it
 * appears. `gone` is called when the page's folder itself can't be followed anymore.
 */
function watchFolder(root: string, changed: () => void, gone: () => void): FolderWatch {
    const watchers = new Map<string, fs.FSWatcher>();
    let closed = false;
    const add = (dir: string) => {
        if (closed || watchers.has(dir) || watchers.size >= MAX_FOLLOWED_DIRS) return;
        let w: fs.FSWatcher;
        try {
            w = fs.watch(dir, (_event, file) => {
                if (file && String(file) === "node_modules") return;
                changed();
                if (file) {
                    const sub = path.join(dir, String(file));
                    if (fs.statSync(sub, { throwIfNoEntry: false })?.isDirectory()) walk(sub);
                }
            });
        } catch (e) {
            if (dir === root) throw e;
            return; // a folder gone between being listed and followed
        }
        w.on("error", () => {
            w.close();
            watchers.delete(dir);
            if (dir === root) gone();
        });
        watchers.set(dir, w);
    };
    const walk = (dir: string) => {
        add(dir);
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) if (e.isDirectory() && e.name !== "node_modules") walk(path.join(dir, e.name));
    };
    walk(root);
    return {
        close() {
            closed = true;
            for (const w of watchers.values()) w.close();
            watchers.clear();
        },
    };
}
