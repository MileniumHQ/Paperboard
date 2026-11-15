// The shell as a person uses it, for the tests of what only a real page
// shows (which DOM nodes survive an update, how many requests a dialog
// makes): the renderer built as a release builds it, served by the shell
// host (host.main.ts) in its own process, against a compiled test daemon
// over a throwaway data dir, with the dev fixture panels installed, and
// opened signed in in headless Chrome. One boot serves a whole test file.
//
// Under `bun test` solid-js resolves to its server build, which does not
// react, so a shell component can only be tested this way.
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { setDefaultTimeout } from "bun:test";
import { build } from "vite";
import { openChrome, type Page } from "../../../../../scripts/testing/chrome";
import { buildCrane, startCrane, type Crane } from "../../../../../scripts/testing/crane";
import { installDevPanelInto, type DevPanel } from "../../../scripts/devPanel";
import viteConfig from "../../../electron.vite.config";
import { ANSWER } from "./protocol";
import { reapOnExit, type Reaper } from "./reaper";

export { API_DEMO, WIDGET_DEMO, type DevPanel } from "../../../scripts/devPanel";
export type { Page } from "../../../../../scripts/testing/chrome";

const APP = path.resolve(import.meta.dir, "../../..");
const HOST_MAIN = path.join(import.meta.dir, "host.main.ts");
const HOST_MDNS = path.join(import.meta.dir, "mdns.ts");
const WAIT_MS = 20_000;

// a boot builds the renderer and the daemon and starts three processes
setDefaultTimeout(60_000);

/** clicks, as a mouse would, the last `tag` element on the page whose text includes `text` (the newest dialog's, when several) */
export async function clickText(page: Page, tag: string, text: string): Promise<void> {
    const found = await page.evaluate<boolean>(`(() => {
        for (const el of document.querySelectorAll("[data-click-target]")) delete el.dataset.clickTarget;
        const el = [...document.querySelectorAll(${JSON.stringify(tag)})].filter((e) => e.textContent.includes(${JSON.stringify(text)})).pop();
        if (!el) return false;
        el.dataset.clickTarget = "";
        return true;
    })()`);
    if (!found) throw new Error(`No ${tag} reads "${text}"`);
    await page.click("[data-click-target]");
}

export interface Shell {
    page: Page;
    dataDir: string;
    daemon: Crane;
    /** a command for the shell host (host.main.ts); resolves to its answer */
    host<T = unknown>(command: Record<string, unknown>): Promise<T>;
    /** pairs a second daemon as `name`, the way Add Computer does; returns its computer id and daemon.
     * It listens on 127.0.0.2, so Paperboard dials it as another computer (TLS, pinned certificate),
     * not as this one; Linux routes all of 127/8 to loopback, which is where this suite runs. */
    pairComputer(name: string): Promise<{ id: string; daemon: Crane }>;
    close(): Promise<void>;
}

async function buildRenderer(outDir: string): Promise<void> {
    const renderer = (viteConfig as { renderer: Record<string, any> }).renderer;
    await build({
        ...renderer,
        configFile: false,
        root: path.join(APP, "src/renderer"),
        logLevel: "error",
        build: { ...renderer.build, outDir, emptyOutDir: true },
    });
}

/** what every process of a boot gets: the data dir, and no way off loopback */
function hermeticEnv(dataDir: string): NodeJS.ProcessEnv {
    const nowhere = "http://127.0.0.1:9";
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        PAPERBOARD_DIR: dataDir,
        HTTP_PROXY: nowhere,
        HTTPS_PROXY: nowhere,
        ALL_PROXY: nowhere,
        http_proxy: nowhere,
        https_proxy: nowhere,
        all_proxy: nowhere,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}

export interface BootOptions {
    panels?: DevPanel[];
    /** runs in every document the shell opens, before its own scripts (ChromeOptions.init) */
    init?: string;
    /** writes what the data dir holds before the daemon starts, as a computer that already has it */
    seed?: (dataDir: string) => void;
}

/** the shell over a fresh data dir; its temp root goes on close(), or with this process however it ends */
export async function bootShell(options: BootOptions = {}): Promise<Shell> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-shell-"));
    const dataDir = path.join(root, "data");
    const rendererDir = path.join(root, "renderer");
    fs.mkdirSync(path.join(dataDir, "local"), { recursive: true });
    let reaper: Reaper;
    try {
        reaper = await reapOnExit(root);
    } catch (err) {
        fs.rmSync(root, { recursive: true, force: true });
        throw err;
    }
    const stops: (() => Promise<void> | void)[] = [];
    // every stop runs, even after one fails, and the root goes last; a root
    // that could not be removed is left to the reaper
    const close = async () => {
        const failures: unknown[] = [];
        for (const stop of stops.splice(0).reverse()) {
            try {
                await stop();
            } catch (err) {
                failures.push(err);
            }
        }
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 });
        reaper.dismiss();
        if (failures.length > 0) throw new AggregateError(failures, "Closing the shell boot failed");
    };
    try {
        options.seed?.(dataDir);
        const binary = buildCrane(root);
        await Promise.all([buildRenderer(rendererDir), ...(options.panels ?? []).map((panel) => installDevPanelInto(panel, dataDir))]);
        const daemon = await startCrane(binary, dataDir);
        reaper.track();
        stops.push(() => daemon.stop());

        const child: ChildProcess = spawn(process.execPath, ["--preload", HOST_MDNS, HOST_MAIN, rendererDir], {
            cwd: APP,
            env: hermeticEnv(dataDir),
            stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        const answers = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
        createInterface({ input: child.stdout! }).on("line", (line) => {
            output += `${line}\n`;
            if (!line.startsWith(ANSWER)) return;
            const { seq, result, error } = JSON.parse(line.slice(ANSWER.length));
            const waiting = answers.get(seq);
            answers.delete(seq);
            if (error !== undefined) waiting?.reject(new Error(`The shell host refused: ${error}`));
            else waiting?.resolve(result);
        });
        void exited.then(() => {
            for (const waiting of answers.values()) waiting.reject(new Error(`The shell host exited:\n${output}`));
            answers.clear();
        });
        reaper.track();
        stops.push(async () => {
            child.stdin!.end();
            await exited;
        });
        let nextId = 1;
        const ask = <T>(seq: number, command: Record<string, unknown>) =>
            new Promise<T>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`The shell host did not answer ${JSON.stringify(command)}:\n${output}`)), WAIT_MS);
                answers.set(seq, {
                    resolve: (v) => (clearTimeout(timer), resolve(v)),
                    reject: (e) => (clearTimeout(timer), reject(e)),
                });
                if (seq !== 0) child.stdin!.write(`${JSON.stringify({ seq, command })}\n`);
            });
        await ask<string>(0, {});
        const host = <T>(command: Record<string, unknown>) => ask<T>(nextId++, command);

        const page = await openChrome(await host<string>({ cmd: "sign-in-url" }), { init: options.init });
        stops.push(() => page.close());
        // the shell is up once its rail lists this computer
        await page.waitFor(`document.querySelector("[role=radio][aria-label$='(127.0.0.1)']")`, "the shell to list this computer");

        const pairComputer = async (name: string) => {
            const otherDir = path.join(root, `computer-${nextId}`);
            fs.mkdirSync(otherDir);
            const other = await startCrane(binary, otherDir, "127.0.0.2");
            reaper.track();
            stops.push(() => other.stop());
            // `papercrane pair` opens pairing and prints the code, then waits for the pairing
            const pairing = spawn(binary, ["pair", "--data-dir", otherDir], { env: hermeticEnv(otherDir), stdio: ["ignore", "pipe", "pipe"] });
            reaper.track();
            const paired = new Promise<number | null>((resolve) => pairing.once("exit", resolve));
            let said = "";
            const code = await new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`papercrane pair printed no code:\n${said}`)), WAIT_MS);
                const read = (chunk: Buffer) => {
                    said += chunk.toString("utf8");
                    const match = /Pairing code: (\w+) (\w+)/.exec(said);
                    if (match) {
                        clearTimeout(timer);
                        resolve(`${match[1]}${match[2]}`);
                    }
                };
                pairing.stdout!.on("data", read);
                pairing.stderr!.on("data", read);
            });
            const id = await host<string>({ cmd: "pair", host: "127.0.0.2", port: other.port, code, name });
            if ((await paired) !== 0) throw new Error(`papercrane pair did not see the pairing:\n${said}`);
            await page.waitFor(`document.querySelector("[role=radio][aria-label='${name} (127.0.0.2)']")`, `${name} in the rail`);
            return { id, daemon: other };
        };

        return { page, dataDir, daemon, host, pairComputer, close };
    } catch (err) {
        try {
            await close();
        } catch (closeErr) {
            throw new AggregateError([err, closeErr], "The shell boot failed, and so did closing it");
        }
        throw err;
    }
}
