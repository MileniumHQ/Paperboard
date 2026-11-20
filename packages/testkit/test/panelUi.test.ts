// A panel's suite under withPanelUi.ts builds the panel's UI once, before any
// test starts, and every test process serves that one build: none builds its
// own inside a test's time limit. The build is gone once the suite ends,
// however it ends, and the exit code is the suite's. Each case is a real
// runner building a real panel (the Terminal panel), with a TMPDIR of its
// own to inspect.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PANEL_UI = join(import.meta.dir, "..", "src", "panelUi.ts");
const WITH_PANEL_UI = join(import.meta.dir, "..", "src", "withPanelUi.ts");
const PANEL = join(import.meta.dir, "..", "..", "..", "panels", "dev.paperboard.terminal");

// a test process: says which build it serves and whether it is there; with no
// PAPERBOARD_DIR, one that tried to build its own would fail instead
const FILE = `
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    import { panelUi } from ${JSON.stringify(PANEL_UI)};
    const dir = panelUi(${JSON.stringify(PANEL)});
    console.log(JSON.stringify({ dir, built: existsSync(join(dir, "index.html")) }));
`;

async function suite(ending: "exits 3" | "is stopped") {
    const dir = mkdtempSync(join(tmpdir(), "pbpu-"));
    const env: Record<string, string | undefined> = { ...process.env, TMPDIR: dir };
    delete env.PAPERBOARD_DIR;
    // two test files, each in a process of its own, as bun test --parallel runs them
    const files = `"${process.execPath}" -e '${FILE}' && "${process.execPath}" -e '${FILE}'`;
    const command = ending === "exits 3" ? `${files}; exit 3` : `${files} && echo open && exec sleep 30`;
    const child = Bun.spawn([process.execPath, WITH_PANEL_UI, "/bin/sh", "-c", command], { cwd: PANEL, env, stdout: "pipe", stderr: "pipe" });
    let output = "";
    let stopped = false;
    const reader = child.stdout.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
        if (ending === "is stopped" && !stopped && output.includes("open")) {
            stopped = true;
            child.kill("SIGTERM");
        }
    }
    const code = await child.exited;
    const stderr = await new Response(child.stderr).text();
    // the module compile cache vite turns on stays in TMPDIR; the build is what must go
    const left = readdirSync(dir).filter((entry) => entry !== "node-compile-cache");
    rmSync(dir, { recursive: true, force: true });
    const served = output.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as { dir: string; built: boolean });
    return { code, served, left, stderr, dir };
}

describe("a panel's suite under withPanelUi.ts", () => {
    test("serves one build to every test process, and removes it when the suite ends", async () => {
        const { code, served, left, stderr, dir } = await suite("exits 3");
        expect(stderr).toBe("");
        expect(served).toHaveLength(2);
        expect(served[0]!.built).toBe(true);
        expect(served[0]!.dir.startsWith(dir)).toBe(true);
        expect(served[1]).toEqual(served[0]!);
        expect(code).toBe(3);
        expect(left).toEqual([]);
    }, 60_000);

    test("removes the build when the suite is stopped", async () => {
        const { code, served, left } = await suite("is stopped");
        expect(served).toHaveLength(2);
        expect(code).not.toBe(0);
        expect(left).toEqual([]);
    }, 60_000);
});
