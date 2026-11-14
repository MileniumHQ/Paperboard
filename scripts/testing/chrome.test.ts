// A browser suite leaves no Chrome and no temp files behind, however it
// ends: it closed its page, it failed with the page still open, or it was
// stopped (a timeout's SIGTERM) mid-run. Each case is a real test process
// driving a real headless Chrome, with a TMPDIR of its own to inspect.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DRIVER = join(import.meta.dir, "chrome.ts");

type Ending = "closes" | "fails" | "is stopped";

// every process whose command line names `dir`: a Chrome over a profile in
// it, or the reaper that cleans up after one
function processesIn(dir: string): number[] {
    const found: number[] = [];
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
        if (cmdline.includes(`${dir}/`)) found.push(Number(entry));
    }
    return found;
}

async function suiteThat(ending: Ending): Promise<{ left: string[]; chromes: number[]; output: string }> {
    // short: Chrome's singleton socket path must fit in 108 bytes
    const dir = mkdtempSync(join(tmpdir(), "pbct-"));
    const script = `
        import { openChrome } from ${JSON.stringify(DRIVER)};
        const page = await openChrome("data:text/html,<p>open</p>");
        console.log("open");
        if (${JSON.stringify(ending)} === "closes") await page.close();
        else if (${JSON.stringify(ending)} === "fails") throw new Error("the suite failed");
        else await new Promise(() => {});
    `;
    const child = Bun.spawn([process.execPath, "-e", script], {
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
    if (ending === "is stopped") child.kill("SIGTERM");
    await child.exited;
    output += await new Response(child.stderr).text();
    // a suite that ended without closing its page is cleaned up after it
    // ends: done once nothing that names the dir runs any more
    const deadline = Date.now() + 10_000;
    while (processesIn(dir).length && Date.now() < deadline) await Bun.sleep(50);
    const left = readdirSync(dir);
    const chromes = processesIn(dir);
    // whatever the driver left is this test's to stop, by PID
    for (const pid of chromes) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    return { left, chromes, output };
}

describe("a browser suite leaves no Chrome and no temp files behind", () => {
    for (const ending of ["closes", "fails", "is stopped"] as Ending[]) {
        test(`when it ${ending}`, async () => {
            const { left, chromes, output } = await suiteThat(ending);
            expect(output).toContain("open");
            expect(left).toEqual([]);
            expect(chromes).toEqual([]);
        }, 30_000);
    }
});
