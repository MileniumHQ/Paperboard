// A browser suite leaves no Chrome and no temp files behind, however it
// ends: it closed its pages, it failed with a page still open, or it was
// stopped (a timeout's SIGTERM) mid-run; with a Chrome per page
// (openChrome), pages sharing one (launchChrome), or a whole suite sharing
// one (withChrome.ts, where both open their pages in the suite's Chrome).
// Each case is a real test process driving a real headless Chrome, with a
// TMPDIR of its own to inspect.
import { describe, expect, test } from "bun:test";
import { launchChrome, START_TURN } from "../src/chrome";
import { waitFor, within } from "../src/wait";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DRIVER = join(import.meta.dir, "..", "src", "chrome.ts");
const WITH_CHROME = join(import.meta.dir, "..", "src", "withChrome.ts");

type Ending = "closes" | "fails" | "is stopped";
type Driver = "openChrome" | "launchChrome" | "withChrome";

// each opens two pages, so a shared Chrome holds more than one
const OPEN: Record<Driver, string> = {
    openChrome: `
        import { openChrome } from ${JSON.stringify(DRIVER)};
        const pages = [await openChrome("data:text/html,<p>open</p>"), await openChrome("data:text/html,<p>open</p>")];
        const close = async () => { for (const page of pages) await page.close(); };
    `,
    launchChrome: `
        import { launchChrome } from ${JSON.stringify(DRIVER)};
        const chrome = await launchChrome();
        const pages = [await chrome.open("data:text/html,<p>open</p>"), await chrome.open("data:text/html,<p>open</p>")];
        const close = async () => { for (const page of pages) await page.close(); await chrome.close(); };
    `,
    // a suite under withChrome.ts: a file with a Chrome per page and one with a shared Chrome, all in the suite's one
    withChrome: `
        import { launchChrome, openChrome } from ${JSON.stringify(DRIVER)};
        const chrome = await launchChrome();
        const pages = [await openChrome("data:text/html,<p>open</p>"), await openChrome("data:text/html,<p>open</p>"), await chrome.open("data:text/html,<p>open</p>")];
        const close = async () => { for (const page of pages) await page.close(); await chrome.close(); };
    `,
};

// the command line of every process that names `dir`: a Chrome over a
// profile in it, or the reaper that cleans up after one
function processesIn(dir: string): Map<number, string> {
    const found = new Map<number, string>();
    for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        let cmdline: string;
        try {
            cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
        } catch (err) {
            // the process ended between the listing and the read
            if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ESRCH") continue;
            throw err;
        }
        if (cmdline.includes(`${dir}/`)) found.set(Number(entry), cmdline);
    }
    return found;
}

async function suiteThat(driver: Driver, ending: Ending): Promise<{ left: string[]; chromes: number[]; started: number; output: string }> {
    // short: Chrome's singleton socket path must fit in 108 bytes
    const dir = mkdtempSync(join(tmpdir(), "pbct-"));
    const script = `
        ${OPEN[driver]}
        console.log("open");
        if (${JSON.stringify(ending)} === "closes") await close();
        else if (${JSON.stringify(ending)} === "fails") throw new Error("the suite failed");
        else await new Promise(() => {});
    `;
    const child = Bun.spawn([process.execPath, ...(driver === "withChrome" ? [WITH_CHROME, process.execPath] : []), "-e", script], {
        env: { ...process.env, TMPDIR: dir },
        stdout: "pipe",
        stderr: "pipe",
    });
    let output = "";
    const reader = child.stdout.getReader();
    while (!output.includes("open")) {
        const { done, value } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
    }
    // the Chromes up while its pages are open: each is one browser process with a profile in the dir
    const started = [...processesIn(dir).values()].filter((cmdline) => cmdline.includes("--remote-debugging-port=0") && !cmdline.includes("--type=")).length;
    if (ending === "is stopped") child.kill("SIGTERM");
    await child.exited;
    output += await new Response(child.stderr).text();
    // a suite that ended without closing its page is cleaned up after it
    // ends: done once nothing that names the dir runs any more
    const deadline = Date.now() + 10_000;
    // quiet: the poll interval of a deadline-bound wait for the Chromes to end
    while (processesIn(dir).size && Date.now() < deadline) await Bun.sleep(50);
    const left = readdirSync(dir);
    const chromes = [...processesIn(dir).keys()];
    // whatever the driver left is this test's to stop, by PID
    for (const pid of chromes) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    return { left, chromes, started, output };
}

describe("a browser suite leaves no Chrome and no temp files behind", () => {
    for (const driver of ["openChrome", "launchChrome", "withChrome"] as Driver[]) {
        for (const ending of ["closes", "fails", "is stopped"] as Ending[]) {
            test(`with ${driver}, when it ${ending}`, async () => {
                const { left, chromes, started, output } = await suiteThat(driver, ending);
                expect(output).toContain("open");
                // a Chrome per page, or one for all of them: counted in the suite that stays open
                if (ending === "is stopped") expect(started).toBe(driver === "openChrome" ? 2 : 1);
                expect(left).toEqual([]);
                expect(chromes).toEqual([]);
            }, 30_000);
        }
    }
});

test("pages sharing a Chrome share no storage or cookies", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("<p>page</p>", { headers: { "Content-Type": "text/html" } }) });
    const chrome = await launchChrome();
    try {
        const url = `http://127.0.0.1:${server.port}/`;
        const first = await chrome.open(url);
        await first.evaluate(`localStorage.setItem("left", "behind"); document.cookie = "left=behind"`);
        const second = await chrome.open(url);
        expect(await second.evaluate(`[localStorage.getItem("left"), document.cookie]`)).toEqual([null, ""]);
        expect(await first.evaluate(`[localStorage.getItem("left"), document.cookie]`)).toEqual(["behind", "left=behind"]);
    } finally {
        await chrome.close();
        server.stop(true);
    }
}, 30_000);

// Chromes started at once on a busy machine share its CPU and each misses
// its deadline still starting (#39), so a start waits for the one before it,
// in any test process; and a process that dies mid-start doesn't leave the
// rest waiting on it.
test("a Chrome starts in its turn, and the turn of a process that died starting one passes on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pbct-"));
    // a Chrome that never opens its port, so its starter holds the turn; a
    // shell that loops, so its command line names the dir it is found by
    const stuck = join(dir, "stuck-chrome");
    writeFileSync(stuck, "#!/bin/sh\nwhile :; do sleep 1; done\n", { mode: 0o755 });
    mkdirSync(join(dir, "holder"));
    mkdirSync(join(dir, "next"));
    const starter = (env: Record<string, string>) =>
        Bun.spawn([process.execPath, "-e", `import { startChrome } from ${JSON.stringify(DRIVER)}; const chrome = await startChrome(); console.log("open"); await chrome.stop();`], {
            env: { ...process.env, ...env },
            stdout: "pipe",
            stderr: "inherit",
        });
    const holder = starter({ CHROME_PATH: stuck, TMPDIR: join(dir, "holder") });
    let next: ReturnType<typeof starter> | null = null;
    try {
        await waitFor("the stuck start to hold the turn", () => existsSync(START_TURN) && readFileSync(START_TURN, "utf8") === String(holder.pid));
        next = starter({ TMPDIR: join(dir, "next") });
        let opened = false;
        const output = new Response(next.stdout).text().then((text) => {
            opened = true;
            return text;
        });
        // quiet: the window in which the next Chrome must not start; unheld, it starts and stops in well under it
        await Bun.sleep(2_000);
        expect(opened).toBe(false);
        // it makes its profile only once it has the turn
        expect(readdirSync(join(dir, "next"))).toEqual([]);
        holder.kill("SIGKILL");
        expect(await within("the next Chrome to start", output)).toBe("open\n");
        expect(await next.exited).toBe(0);
    } finally {
        holder.kill("SIGKILL");
        next?.kill("SIGKILL");
        await Promise.all([holder.exited, next?.exited]);
        // the stuck Chrome goes with its starter's reaper
        await waitFor("the stuck Chrome to be reaped", () => processesIn(dir).size === 0);
        rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    }
}, 30_000);
