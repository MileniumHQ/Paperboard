import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Pages } from "../src/service/pages";
import { HomeFolder } from "../src/service/homeFolder";
import { tempDir } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

function get(port: number, target: string, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((ok, fail) => {
        const req = http.request({ host: "127.0.0.1", port, path: target, method: "GET", headers }, (res) => {
            let body = "";
            res.setEncoding("utf8").on("data", (d) => (body += d));
            res.on("end", () => ok({ status: res.statusCode!, headers: res.headers, body }));
        });
        req.on("error", fail);
        req.end();
    });
}

async function setup() {
    const root = tempDir("pages");
    const home = new HomeFolder(path.join(root, "home"));
    home.ensure();
    const pages = new Pages({
        home,
        portFile: path.join(root, "apps.json"),
        infoFile: path.join(root, "app-info.json"),
        picturesDir: path.join(root, "pictures"),
        exportsDir: path.join(root, "page-exports"),
        picture: async () => "",
        pdf: async () => Buffer.from("%PDF-1.7"),
        post: () => {},
        onChange: () => {},
    });
    cleanups.push(async () => {
        await pages.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tools = pages.toolset();
    for (const name of ["planner", "other"]) {
        const r = await tools.call("start_page", { name, kind: "app", title: name, description: `the ${name}` }, { fromFlow: false });
        expect(r.isError).toBeFalsy();
        fs.writeFileSync(path.join(home.root, "Pages", name, "index.html"), `<h1>${name}</h1>`);
    }
    fs.writeFileSync(path.join(home.root, "Pages", "other", "private.json"), '{"other":"data"}');
    fs.writeFileSync(path.join(home.root, "diary.txt"), "the rest of home");
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "off the computer's home");
    fs.symlinkSync(outside, path.join(home.root, "Pages", "planner", "out.txt"));
    fs.symlinkSync(path.join(home.root, "Pages", "other"), path.join(home.root, "Pages", "planner", "sibling"));
    return { pages, home, root, port: pages.port! };
}

// The pages' server is isolated.
describe("the pages' server", () => {
    test("a page is served only at <name>.localhost:<port>, with a 'self' CSP and same-origin CORP", async () => {
        const { port } = await setup();
        const ok = await get(port, "/", { host: `planner.localhost:${port}` });
        expect(ok.status).toBe(200);
        expect(ok.body).toContain("<h1>planner</h1>");
        expect(ok.headers["content-security-policy"]).toContain("default-src 'self'");
        expect(ok.headers["content-security-policy"]).toContain("connect-src 'self'");
        expect(ok.headers["cross-origin-resource-policy"]).toBe("same-origin");
        // DNS rebinding: any other name pointed at the port
        for (const host of ["evil.com", `evil.com:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `planner.localhost:${port + 1}`, `planner.localhost.evil.com:${port}`]) {
            const r = await get(port, "/", { host });
            expect(r.status).toBe(421);
            expect(r.body).not.toContain("planner</h1>");
        }
    });

    test("cross-site fetches get 403; the page's own files and a typed address don't", async () => {
        const { port } = await setup();
        const host = `planner.localhost:${port}`;
        expect((await get(port, "/", { host, "sec-fetch-site": "cross-site", "sec-fetch-dest": "script", "sec-fetch-mode": "no-cors" })).status).toBe(403);
        expect((await get(port, "/", { host, "sec-fetch-site": "same-site", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" })).status).toBe(403);
        expect((await get(port, "/", { host, "sec-fetch-site": "same-origin" })).status).toBe(200);
        expect((await get(port, "/", { host, "sec-fetch-site": "none" })).status).toBe(200);
    });

    test("encoded .., links out, other pages' files and the rest of home get 404", async () => {
        const { port } = await setup();
        const host = `planner.localhost:${port}`;
        for (const target of ["/%2e%2e/other/private.json", "/..%2fother%2fprivate.json", "/%2e%2e/%2e%2e/diary.txt", "/../../diary.txt", "/out.txt", "/sibling/private.json", "/%2e%2e%2f%2e%2e%2f%2e%2e%2foutside.txt", "/index.html%00.png"]) {
            const r = await get(port, target, { host });
            expect(r.status).toBe(404);
            expect(r.body).not.toContain("data");
            expect(r.body).not.toContain("the rest of home");
            expect(r.body).not.toContain("off the computer");
        }
        // the other page's file is served to that page, at its own origin
        expect((await get(port, "/private.json", { host: `other.localhost:${port}` })).body).toBe('{"other":"data"}');
    });
});

/** The next event on a page's change stream, or null when none comes within `ms`. */
function nextChange(port: number, name: string, ms: number, opened: () => void): Promise<string | null> {
    return new Promise((ok, fail) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/__paperboard/changes", headers: { host: `${name}.localhost:${port}` } }, (res) => {
            let body = "";
            let said = false;
            res.setEncoding("utf8").on("data", (d) => {
                body += d;
                if (!said && body.includes("following")) {
                    said = true;
                    opened();
                }
                const event = body.match(/^data: (.+)$/m);
                if (event) {
                    clearTimeout(timer);
                    req.destroy();
                    ok(event[1]!);
                }
            });
        });
        const timer = setTimeout(() => {
            req.destroy();
            ok(null);
        }, ms);
        req.on("error", (e) => (e.message.includes("socket hang up") ? undefined : fail(e)));
        req.end();
    });
}

describe("pages", () => {
    test("every HTML file is sent with the script that reloads it, and a change to its files says so", async () => {
        const { port, home } = await setup();
        const page = await get(port, "/", { host: `planner.localhost:${port}` });
        expect(page.body.startsWith("<script>")).toBe(true);
        expect(page.body).toContain('new EventSource("/__paperboard/changes")');
        const dir = path.join(home.root, "Pages", "planner");
        // an install's files are no change of the page's
        fs.mkdirSync(path.join(dir, "node_modules", "left-pad"), { recursive: true });
        const quiet = nextChange(port, "planner", 600, () => setTimeout(() => fs.writeFileSync(path.join(dir, "node_modules", "left-pad", "index.js"), "x"), 50));
        expect(await quiet).toBeNull();
        const changed = nextChange(port, "planner", 3000, () => setTimeout(() => fs.writeFileSync(path.join(dir, "index.html"), "<h1>v2</h1>"), 50));
        expect(await changed).toBe("changed");
    });

    test("~/Apps from before becomes ~/Pages, and a page already there by the same name is never written over", async () => {
        const { pages, home } = await setup();
        const old = path.join(home.root, "Apps");
        fs.mkdirSync(path.join(old, "planner"), { recursive: true });
        fs.writeFileSync(path.join(old, "planner", "index.html"), "the old planner");
        fs.mkdirSync(path.join(old, "card"), { recursive: true });
        fs.writeFileSync(path.join(old, "card", "index.html"), "a card");
        pages.watch();
        expect(fs.readFileSync(path.join(home.root, "Pages", "card", "index.html"), "utf8")).toBe("a card");
        // both kept: the one in ~/Pages, and the old one where it was
        expect(fs.readFileSync(path.join(home.root, "Pages", "planner", "index.html"), "utf8")).toBe("<h1>planner</h1>");
        expect(fs.readFileSync(path.join(old, "planner", "index.html"), "utf8")).toBe("the old planner");
        expect(pages.list().map((p) => p.name).sort()).toEqual(["card", "other", "planner"]);
    });

    test("a document's PDF is saved for the view, and only such a file can be discarded", async () => {
        const { pages, root } = await setup();
        await pages.toolset().call("start_page", { name: "planner", kind: "document" }, { fromFlow: false });
        expect(pages.list().find((p) => p.name === "planner")!.kind).toBe("document");
        const pdf = await pages.pdf("planner");
        expect(pdf.name).toBe("planner.pdf");
        expect(fs.readFileSync(path.join(root, pdf.file), "utf8")).toBe("%PDF-1.7");
        fs.writeFileSync(path.join(root, "app-info.json.keep"), "kept");
        for (const file of ["../app-info.json.keep", "page-exports/../app-info.json.keep", "page-exports/x.pdf", "elsewhere/planner-0123abcd.pdf"]) {
            expect(() => pages.discardPdf(file)).toThrow("that isn't a page's PDF");
        }
        expect(fs.existsSync(path.join(root, "app-info.json.keep"))).toBe(true);
        pages.discardPdf(pdf.file);
        expect(fs.existsSync(path.join(root, pdf.file))).toBe(false);
    });
});
