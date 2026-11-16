// The shell as a person uses it, for the tests of what only a real page
// shows (which DOM nodes survive an update, how many requests a dialog
// makes): the renderer built as a release builds it, served by the shell
// host (host.main.ts) in its own process, against a compiled test daemon
// over a throwaway data dir, with the dev fixture panels installed, and
// opened signed in in headless Chrome. One boot serves a whole test file.
//
// Under `bun test` solid-js resolves to its server build, which does not
// react, so a shell component can only be tested this way.
//
// The shell opens in its desktop layout. `bootShell({ phone: true })` opens
// it in the phone layout the way `paperboard --mobile` does: the host is
// started with --mobile, so the shell and every panel document it serves are
// told the phone layout, and the page is an iPhone 16 Pro's viewport with
// touch, as the mobile mock's window is. A phone lists only paired
// computers, so a phone boot opens on the welcome until a test pairs one
// (pairComputer). Check phone-width UI this way, not with resize(): a
// narrow desktop window is still the desktop layout.
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
import { IPHONE_16_PRO } from "../../../src/main/mobileMock";
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

/** An expression for page.waitFor: whether a failure toast shows whose text includes every one of `texts`. */
export function toastShown(...texts: string[]): string {
    return `[...document.querySelectorAll("[aria-label=Notifications] [role=alert]")].some((t) => ${JSON.stringify(texts)}.every((x) => t.innerText.includes(x)))`;
}

/**
 * An expression for page.waitFor: whether a failure stands in place, a
 * PaperError on screen titled `title` whose text includes every one of
 * `texts`, and no toast says it too.
 */
export function errorShown(title: string, ...texts: string[]): string {
    return `([...document.querySelectorAll("[data-paper-error]")].some((e) => e.getAttribute("aria-label") === ${JSON.stringify(title)} && e.offsetParent !== null && ${JSON.stringify(texts)}.every((x) => e.innerText.includes(x))) && !${toastShown(title)})`;
}

/** An expression for page.waitFor: whether no failure titled `title` stands anywhere, in place or as a toast. */
export function errorGone(title: string): string {
    return `(![...document.querySelectorAll("[data-paper-error]")].some((e) => e.getAttribute("aria-label") === ${JSON.stringify(title)}) && !${toastShown(title)})`;
}

/** the selector of the field fieldShown(label) found */
export function fieldOf(label: string): string {
    return `[data-field=${JSON.stringify(label)}]`;
}

/**
 * An expression for page.waitFor: whether a field labelled `label` is shown
 * (the newest dialog's, when several), which it marks for fieldOf(label).
 * A mark already right is left alone: a change would wake the wait again.
 */
export function fieldShown(label: string): string {
    return `(() => {
        const name = ${JSON.stringify(label)};
        const input = [...document.querySelectorAll("label")].filter((l) => l.textContent.trim() === name).pop()?.control;
        for (const el of document.querySelectorAll("[data-field]")) if (el.dataset.field === name && el !== input) delete el.dataset.field;
        if (!input) return false;
        if (input.dataset.field !== name) input.dataset.field = name;
        return true;
    })()`;
}

export interface Shell {
    page: Page;
    dataDir: string;
    daemon: Crane;
    /** a command for the shell host (host.main.ts); resolves to its answer */
    host<T = unknown>(command: Record<string, unknown>): Promise<T>;
    /** pairs a second daemon as `name` through the shell's computer-pair call, as Add Computer does;
     * returns its computer id, daemon, and the call's whole answer.
     * It listens on 127.0.0.2, so Paperboard dials it as another computer (TLS, pinned certificate),
     * not as this one; Linux routes all of 127/8 to loopback, which is where this suite runs.
     * `panels` are installed on it before it starts. */
    pairComputer(name: string, panels?: DevPanel[]): Promise<{ id: string; daemon: Crane; answer: Record<string, unknown> }>;
    /** a second daemon listening on `host`, with pairing opened by `papercrane pair` as a person opens it:
     * its code, and what pair printed (which says the address to type) */
    openPairing(host: string, panels?: DevPanel[]): Promise<Pairing>;
    close(): Promise<void>;
}

export interface Pairing {
    daemon: Crane;
    code: string;
    /** everything `papercrane pair` printed so far */
    said(): string;
    /** pair's exit code, once a computer paired (or pairing ended) */
    done: Promise<number | null>;
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
    /** the phone layout, as `paperboard --mobile` opens it (see the top of this file) */
    phone?: boolean;
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

        const child: ChildProcess = spawn(process.execPath, ["--preload", HOST_MDNS, HOST_MAIN, rendererDir, ...(options.phone ? ["--mobile"] : [])], {
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
        if (options.phone) {
            // the mobile mock's viewport and touch (mobileMock.ts emulatePhone);
            // page.click stays a mouse, so a test taps with touch events itself
            await page.send("Emulation.setDeviceMetricsOverride", { ...IPHONE_16_PRO, deviceScaleFactor: 1, mobile: true });
            await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
            // the shell is up once it shows the phone's welcome or its rail
            await page.waitFor(
                `document.documentElement.getAttribute("data-paper-mobile") === "true" && document.querySelector("#mobile-welcome-title, [aria-label='Add Computer']")`,
                "the shell to open in the phone layout",
            );
        } else {
            // the shell is up once its rail lists this computer
            await page.waitFor(`document.querySelector("[role=radio][aria-label$='(127.0.0.1)']")`, "the shell to list this computer");
        }

        let pairings = 0;
        const openPairing = async (listenOn: string, panels: DevPanel[] = []): Promise<Pairing> => {
            const otherDir = path.join(root, `computer-${++pairings}`);
            fs.mkdirSync(otherDir);
            await Promise.all(panels.map((panel) => installDevPanelInto(panel, otherDir)));
            const other = await startCrane(binary, otherDir, listenOn);
            reaper.track();
            stops.push(() => other.stop());
            // `papercrane pair` opens pairing and prints the code, then waits for the pairing
            const pairing = spawn(binary, ["pair", "--data-dir", otherDir], { env: hermeticEnv(otherDir), stdio: ["ignore", "pipe", "pipe"] });
            reaper.track();
            const done = new Promise<number | null>((resolve) => pairing.once("exit", resolve));
            stops.push(async () => {
                if (pairing.exitCode === null && pairing.signalCode === null) pairing.kill();
                await done;
            });
            let said = "";
            const code = await new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`papercrane pair printed no code:\n${said}`)), WAIT_MS);
                const read = (chunk: Buffer) => {
                    said += chunk.toString("utf8");
                    // the code, once all pair says about it is printed
                    const match = /Pairing code: (\w+) (\w+)[\s\S]*Waiting for a computer to pair/.exec(said);
                    if (match) {
                        clearTimeout(timer);
                        resolve(`${match[1]}${match[2]}`);
                    }
                };
                pairing.stdout!.on("data", read);
                pairing.stderr!.on("data", read);
            });
            return { daemon: other, code, said: () => said, done };
        };
        const pairComputer = async (name: string, panels: DevPanel[] = []) => {
            const { daemon: other, code, said, done } = await openPairing("127.0.0.2", panels);
            const args = JSON.stringify({ args: { host: "127.0.0.2", port: other.port, code, name } });
            const reply = await page.evaluate<{ ok: boolean; result?: Record<string, unknown>; error?: string }>(
                `fetch("/_shell/invoke/computer-pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: ${JSON.stringify(args)} }).then((r) => r.json())`,
            );
            if (!reply.ok || !reply.result) throw new Error(`Pairing ${name} failed: ${reply.error}`);
            const answer = reply.result;
            if (typeof answer.id !== "string") throw new Error(`Pairing ${name} answered no computer id: ${JSON.stringify(answer)}`);
            const id = answer.id;
            if ((await done) !== 0) throw new Error(`papercrane pair did not see the pairing:\n${said()}`);
            await page.waitFor(`document.querySelector("[role=radio][aria-label='${name} (127.0.0.2)']")`, `${name} in the rail`);
            return { id, daemon: other, answer };
        };

        return { page, dataDir, daemon, host, pairComputer, openPairing, close };
    } catch (err) {
        try {
            await close();
        } catch (closeErr) {
            throw new AggregateError([err, closeErr], "The shell boot failed, and so did closing it");
        }
        throw err;
    }
}
