import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HomeFolder, moveHomeFolder } from "../src/service/homeFolder";
import { OUTPUT_CHARS, shellToolset } from "../src/service/shell";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tempDir() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ai-shell-"));
    dirs.push(d);
    return d;
}

function setup() {
    const storage = tempDir();
    const home = new HomeFolder(path.join(storage, "home"));
    home.ensure();
    const shell = shellToolset(home);
    const run = async (command: string) => (await shell.call("bash", { command })).text;
    return { storage, home, shell, run };
}

describe("the agent's shell", () => {
    test("its ~ is the home folder: what it writes, the other file tools read, and the other way round", async () => {
        const { home, run } = setup();
        expect(await run("mkdir -p ~/notes && echo 'buy milk' > ~/notes/list.txt && pwd")).toBe("/home/user\n");
        expect(home.read("~/notes/list.txt").data.toString()).toBe("buy milk\n");
        // the shell's absolute paths name the same files
        expect(home.read("/home/user/notes/list.txt").data.toString()).toBe("buy milk\n");
        home.write("~/Downloads/report.csv", Buffer.from("city,temp\nOslo,4\n"));
        expect(await run("xan count ~/Downloads/report.csv && grep -c Oslo /home/user/Downloads/report.csv")).toBe("1\n1\n");
    });

    test("each call starts in ~ with a fresh shell: files carry over, cd, variables and /tmp don't", async () => {
        const { run } = setup();
        await run("cd /tmp && export TRIP=oslo && echo scratch > /tmp/t && echo kept > ~/kept.txt");
        expect(await run('pwd; echo "[$TRIP]"; cat ~/kept.txt; cat /tmp/t')).toBe(
            "/home/user\n[]\nkept\ncat: /tmp/t: No such file or directory\n[exit code 1]",
        );
    });

    test("nothing outside the home folder is read or written, links and climbing out included", async () => {
        const { storage, home, run } = setup();
        const outside = path.join(storage, "outside");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
        fs.symlinkSync(outside, path.join(home.root, "linked"));
        fs.symlinkSync(path.join(outside, "secret.txt"), path.join(home.root, "secret.txt"));

        const reads = await run("cat ~/linked/secret.txt; cat ~/secret.txt; cat ~/../outside/secret.txt; cat /etc/passwd; ls ~/linked");
        expect(reads).not.toContain("secret\n");
        expect(reads).not.toMatch(/root:/);
        await run("echo changed > ~/linked/secret.txt; echo changed > ~/secret.txt; rm -rf ~/linked/; rm -f ~/linked/secret.txt");
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
        // it can't make a link of its own to climb out with
        const link = await run("ln -s / ~/root; cat ~/root/etc/passwd");
        expect(link).toContain("Operation not permitted");
        expect(fs.existsSync(path.join(home.root, "root"))).toBe(false);
    });

    test("there's no program beyond the shell's own", async () => {
        const { run } = setup();
        for (const c of ["python3 -c 1", "git status", "sqlite3 :memory: 'select 1'", "npm -v"]) {
            expect(await run(c)).toMatch(/\[exit code 127\]$/);
        }
        // node is a pointer to js-exec, not node
        expect(await run("node -v")).toStartWith("node: this sandbox uses js-exec instead of node");
    });

    test("js-exec runs JavaScript on the home folder, importing its other files by path", async () => {
        const { home, run } = setup();
        home.write("~/lib.mjs", Buffer.from("export const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);"));
        home.write("~/due.mjs", Buffer.from("import { days } from './lib.mjs'; import fs from 'fs'; fs.writeFileSync('left.txt', String(days('2026-10-27', '2026-11-03')));"));
        expect(await run("js-exec due.mjs && cat left.txt")).toBe("7");
        expect(home.read("~/left.txt").data.toString()).toBe("7");
    });

    test("fetch and curl never reach this computer or its local network, by number or by name", async () => {
        const { run } = setup();
        const local = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("this computer's secret") });
        try {
            const at = `127.0.0.1:${local.port}`;
            const out = [
                await run(`curl -s http://${at}/`),
                // a public name that resolves to loopback is refused as well
                await run(`curl -s http://localtest.me:${local.port}/`),
                await run(`curl -s http://192.168.1.1/`),
                await run(`js-exec -c "try { console.log(await (await fetch('http://${at}/')).text()) } catch (e) { console.log(e.message) }"`),
            ];
            expect(out.join("\n")).not.toContain("secret");
            expect(out[3]).toContain("private/loopback IP address blocked");
        } finally {
            local.stop(true);
        }
    });

    test("a failing command says how, and a long one is cut with what to do about it", async () => {
        const { home, run } = setup();
        expect(await run("ls ~/nowhere")).toMatch(/nowhere.*No such file or directory\n\[exit code 2\]$/s);
        expect(await run("true")).toBe("(no output)");
        home.write("~/big.txt", Buffer.from(Array.from({ length: 20_000 }, (_, i) => `line ${i + 1}`).join("\n")));
        const long = await run("cat ~/big.txt");
        expect(long.length).toBeLessThan(OUTPUT_CHARS + 200);
        expect(long).toStartWith("line 1\nline 2\n");
        expect(long).toMatch(/\[… \d+ more characters cut: narrow it down with head, tail or grep\]$/);
    });

    test("a runaway command stops at its limit instead of holding the turn", async () => {
        const { run } = setup();
        const started = Date.now();
        const out = await run("while true; do :; done");
        expect(Date.now() - started).toBeLessThan(10_000);
        expect(out).toMatch(/limit|exceeded/i);
    });

    test("the service carries on while a command runs: its timers, JSON and process still work", async () => {
        const { run } = setup();
        const running = run("sleep 0.4 && echo done");
        const ticked = await new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100));
        expect(ticked).toBe(true);
        expect(JSON.parse('{"a":1}')).toEqual({ a: 1 });
        expect(typeof process.pid).toBe("number");
        expect(await running).toBe("done\n");
    });

    test("a command that isn't one is refused with what to give", async () => {
        const { shell } = setup();
        expect(await shell.call("bash", {})).toEqual({ text: "give the command to run", isError: true });
        expect(await shell.call("bash", { command: "   " })).toEqual({ text: "give the command to run", isError: true });
    });
});

describe("moving the home folder out of the browser's", () => {
    test("an old home folder is moved whole, once", () => {
        const storage = tempDir();
        const from = path.join(storage, "browser", "home");
        const to = path.join(storage, "home");
        fs.mkdirSync(path.join(from, "Downloads"), { recursive: true });
        fs.writeFileSync(path.join(from, "Downloads", "ticket.pdf"), "pdf");
        moveHomeFolder(from, to);
        expect(fs.existsSync(from)).toBe(false);
        expect(fs.readFileSync(path.join(to, "Downloads", "ticket.pdf"), "utf8")).toBe("pdf");
        moveHomeFolder(from, to);
        expect(fs.readdirSync(to)).toEqual(["Downloads"]);
    });

    test("when both exist, the old one goes inside the new one and nothing is overwritten", () => {
        const storage = tempDir();
        const from = path.join(storage, "browser", "home");
        const to = path.join(storage, "home");
        fs.mkdirSync(from, { recursive: true });
        fs.mkdirSync(to);
        fs.writeFileSync(path.join(from, "notes.txt"), "old");
        fs.writeFileSync(path.join(to, "notes.txt"), "new");
        fs.mkdirSync(path.join(to, "Earlier home folder"));
        moveHomeFolder(from, to);
        expect(fs.existsSync(from)).toBe(false);
        expect(fs.readFileSync(path.join(to, "notes.txt"), "utf8")).toBe("new");
        expect(fs.readFileSync(path.join(to, "Earlier home folder (1)", "notes.txt"), "utf8")).toBe("old");
    });
});
