import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AccessEntry, AccessView } from "../src/contract";
import { Access } from "../src/service/access";
import { findProgram } from "../src/service/which";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** a user's computer in a temp folder: a project, a secret beside it, and the panel's storage */
function setup(o: { turning?: boolean } = {}) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-access-")));
    dirs.push(root);
    const home = path.join(root, "home");
    const project = path.join(home, "project");
    fs.mkdirSync(path.join(project, "src"), { recursive: true });
    fs.writeFileSync(path.join(project, "src", "index.ts"), "export const answer = 42;\n");
    fs.writeFileSync(path.join(home, "secret.txt"), "the user's own\n");
    const storage = path.join(root, "storage");
    fs.mkdirSync(storage);
    const posted: AccessEntry[] = [];
    const notices: string[] = [];
    const views: AccessView[] = [];
    let turning = o.turning ?? false;
    const deps = {
        file: path.join(storage, "access.json"),
        home,
        findProgram: (command: string, args: readonly string[]) => findProgram(command, args),
        exec: async (command: string, args: string[], x: { cwd: string; timeoutMs: number }) => {
            const r = spawnSync(command, args, { cwd: x.cwd, timeout: x.timeoutMs, encoding: "utf8" });
            if (r.error) throw r.error;
            return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status ?? -1 };
        },
        post: (e: AccessEntry) => posted.push(structuredClone(e)),
        notice: (t: string) => notices.push(t),
        turning: () => turning,
        onChange: (v: AccessView) => views.push(v),
    };
    const access = new Access(deps);
    access.load();
    const tools = access.toolset();
    const call = (name: string, args: Record<string, unknown>) => tools.call(name, args, { fromFlow: false });
    const ask = async (items: unknown[], reason = "Fix the build in your project.") => {
        const r = await call("request_access", { reason, items });
        expect(r.isError).toBeFalsy();
        return posted.at(-1)!;
    };
    return { root, home, project, storage, access, deps, posted, notices, views, call, ask, setTurning: (t: boolean) => (turning = t) };
}

// the program the tests run: the one running them, everywhere CI does
const RUNTIME = process.execPath;

describe("the agent on the user's computer", () => {
    test("nothing is reachable before the user allows it", async () => {
        const s = setup();
        for (const [name, args] of [
            ["user_computer_list", { path: s.project }],
            ["user_computer_read", { path: path.join(s.project, "src", "index.ts") }],
            ["user_computer_search", { path: s.project, text: "answer" }],
            ["user_computer_write", { path: path.join(s.project, "new.txt"), content: "x" }],
            ["user_computer_run", { command: [RUNTIME, "--version"], folder: s.project }],
        ] as const) {
            const r = await s.call(name, args);
            expect(r.isError).toBe(true);
            expect(r.text).toContain("isn't in a folder the user allowed");
        }
        expect(fs.existsSync(path.join(s.project, "new.txt"))).toBe(false);
    });

    test("a read pages through multi-byte text by characters and refuses a file too big to load", async () => {
        const s = setup();
        const entry = await s.ask([{ kind: "folder", path: "~/project" }]);
        s.access.answer(entry.id, "once");
        const big = path.join(s.project, "big.txt");
        // 3-byte characters: a byte offset and a character offset would disagree
        fs.writeFileSync(big, "€".repeat(40_000));
        const first = await s.call("user_computer_read", { path: big });
        expect(first.text.startsWith("€".repeat(30_000))).toBe(true);
        expect(first.text).toContain("read on from offset 30000");
        const rest = await s.call("user_computer_read", { path: big, offset: 30_000 });
        expect(rest.text).toBe("€".repeat(10_000));

        // sparse, so the test doesn't write 9 MB: the size is what's checked, before anything is loaded
        const huge = path.join(s.project, "huge.log");
        fs.closeSync(fs.openSync(huge, "w"));
        fs.truncateSync(huge, 9 * 1024 * 1024);
        const refused = await s.call("user_computer_read", { path: huge });
        expect(refused.isError).toBe(true);
        expect(refused.text).toContain("too big to read whole");
        expect(refused.text).toContain("user_computer_search");
    });

    test("a folder allowed this time covers its files until the turn its answer started ends", async () => {
        const s = setup();
        const entry = await s.ask([{ kind: "folder", path: "~/project" }]);
        expect(entry.status).toBe("waiting");
        expect(entry.items).toEqual([{ kind: "folder", path: s.project }]);

        s.access.answer(entry.id, "once");
        expect(s.posted.at(-1)!.status).toBe("allowed");
        expect(s.notices.at(-1)).toContain("for this turn");

        const read = await s.call("user_computer_read", { path: "~/project/src/index.ts" });
        expect(read.text).toBe("export const answer = 42;\n");
        const wrote = await s.call("user_computer_write", { path: path.join(s.project, "src", "deep", "new.ts"), content: "hi" });
        expect(wrote.isError).toBeFalsy();
        expect(fs.readFileSync(path.join(s.project, "src", "deep", "new.ts"), "utf8")).toBe("hi");
        expect((await s.call("user_computer_search", { path: s.project, text: "ANSWER" })).text).toContain(`${path.join("src", "index.ts")}:1:`);

        // beside the folder, and out of it with .., stay out of reach
        expect((await s.call("user_computer_read", { path: path.join(s.home, "secret.txt") })).isError).toBe(true);
        expect((await s.call("user_computer_read", { path: `${s.project}/../secret.txt` })).isError).toBe(true);

        // never written to disk, and gone once the turn is over
        expect(fs.existsSync(s.deps.file)).toBe(false);
        s.access.turnEnded();
        expect((await s.call("user_computer_read", { path: path.join(s.project, "src", "index.ts") })).isError).toBe(true);
        expect(s.access.view().grants).toEqual([]);
    });

    test("an answer given while the asking turn is still running outlives that turn's end", async () => {
        const s = setup({ turning: true });
        const entry = await s.ask([{ kind: "folder", path: s.project }]);
        s.access.answer(entry.id, "once");
        s.access.turnEnded(); // the turn that asked
        expect((await s.call("user_computer_list", { path: s.project })).isError).toBeFalsy();
        s.access.turnEnded(); // the turn the answer started
        expect((await s.call("user_computer_list", { path: s.project })).isError).toBe(true);
    });

    test("a link inside an allowed folder doesn't lead outside it", async () => {
        const s = setup();
        fs.symlinkSync(path.join(s.home, "secret.txt"), path.join(s.project, "innocent.txt"));
        fs.symlinkSync(s.home, path.join(s.project, "up"));
        s.access.answer((await s.ask([{ kind: "folder", path: s.project }])).id, "always");
        expect((await s.call("user_computer_read", { path: path.join(s.project, "innocent.txt") })).isError).toBe(true);
        expect((await s.call("user_computer_write", { path: path.join(s.project, "up", "planted.txt"), content: "x" })).isError).toBe(true);
        expect(fs.existsSync(path.join(s.home, "planted.txt"))).toBe(false);
    });

    test("always allowed lasts across a restart, and taking it back ends it", async () => {
        const s = setup();
        s.access.answer((await s.ask([{ kind: "folder", path: s.project }])).id, "always");
        expect(s.posted.at(-1)!.status).toBe("always");
        s.access.turnEnded();

        const again = new Access(s.deps);
        again.load();
        expect(again.view().grants).toMatchObject([{ kind: "folder", path: s.project, once: false }]);
        const tools = again.toolset();
        expect((await tools.call("user_computer_list", { path: s.project }, { fromFlow: false })).isError).toBeFalsy();

        again.revoke({ kind: "folder", path: s.project });
        expect((await tools.call("user_computer_list", { path: s.project }, { fromFlow: false })).isError).toBe(true);
        const third = new Access(s.deps);
        third.load();
        expect(third.view().grants).toEqual([]);
        expect(() => third.revoke({ kind: "folder", path: s.project })).toThrow("nothing to take back");
    });

    test("a command runs exactly as allowed, in an allowed folder; more arguments only when it said so", async () => {
        const s = setup();
        const exact = [RUNTIME, "-e", "console.log(process.cwd())"];
        s.access.answer((await s.ask([{ kind: "folder", path: s.project }, { kind: "command", command: exact }])).id, "always");

        const ran = await s.call("user_computer_run", { command: exact, folder: path.join(s.project, "src") });
        expect(ran.isError).toBeFalsy();
        expect(ran.text).toContain(path.join(s.project, "src"));

        // a folder alone doesn't let it run anything else, nor more arguments on an exact command
        expect((await s.call("user_computer_run", { command: [RUNTIME, "-e", "1"], folder: s.project })).text).toContain("isn't allowed");
        expect((await s.call("user_computer_run", { command: [...exact, "more"], folder: s.project })).text).toContain("isn't allowed");
        // nor in a folder it wasn't given
        expect((await s.call("user_computer_run", { command: exact, folder: s.home })).text).toContain("isn't in a folder the user allowed");

        s.access.answer((await s.ask([{ kind: "command", command: [RUNTIME, "-e"], anyArguments: true }])).id, "once");
        const any = await s.call("user_computer_run", { command: [RUNTIME, "-e", "process.exit(3)"], folder: s.project });
        expect(any.isError).toBe(true);
        expect(any.text).toContain("exited with 3");
        // the prefix itself must match: a different program isn't covered
        expect((await s.call("user_computer_run", { command: ["sh", "-e", "x"], folder: s.project })).text).toContain("isn't allowed");
    });

    test("a declined request grants nothing and tells the agent not to ask again", async () => {
        const s = setup();
        const entry = await s.ask([{ kind: "folder", path: s.project }]);
        s.access.answer(entry.id, "decline");
        expect(s.posted.at(-1)!.status).toBe("declined");
        expect(s.notices.at(-1)).toContain("Don't ask again");
        expect(s.access.view().grants).toEqual([]);
        expect(() => s.access.answer(entry.id, "always")).toThrow("isn't waiting anymore");
    });

    test("a new request replaces the waiting one, which lapses and can't be answered", async () => {
        const s = setup();
        const first = await s.ask([{ kind: "folder", path: s.project }]);
        const second = await s.ask([{ kind: "folder", path: path.join(s.project, "src") }]);
        expect(s.posted.find((e) => e.id === first.id && e.status === "expired")).toBeTruthy();
        expect(() => s.access.answer(first.id, "always")).toThrow("isn't waiting anymore");
        s.access.answer(second.id, "always");
        expect(s.access.view().grants).toMatchObject([{ path: path.join(s.project, "src") }]);
    });

    test("a request is refused when it's too big, vague or names what isn't there", async () => {
        const s = setup();
        const many = Array.from({ length: 6 }, () => ({ kind: "folder", path: s.project }));
        expect((await s.call("request_access", { reason: "x", items: many })).isError).toBe(true);
        expect((await s.call("request_access", { reason: "  ", items: [{ kind: "folder", path: s.project }] })).isError).toBe(true);
        expect((await s.call("request_access", { reason: "x", items: [{ kind: "folder", path: "project" }] })).text).toContain("isn't a full path");
        expect((await s.call("request_access", { reason: "x", items: [{ kind: "folder", path: path.join(s.home, "nope") }] })).text).toContain("doesn't exist");
        expect((await s.call("request_access", { reason: "x", items: [{ kind: "command", command: ["rm -rf /"] }] })).text).toContain("just the program");
        expect(s.posted).toEqual([]);
    });

    test("an automation's turn can use what's allowed but can't ask for more", async () => {
        const s = setup();
        const tools = s.access.toolset();
        expect(tools.tools({ fromFlow: true }).map((t) => t.name)).not.toContain("request_access");
        expect(tools.tools({ fromFlow: false }).map((t) => t.name)).toContain("request_access");
    });

    test("an unreadable access.json allows nothing, says so, and is never written over", async () => {
        const s = setup();
        fs.writeFileSync(s.deps.file, "{ broken");
        const a = new Access(s.deps);
        a.load();
        expect(a.view().error).toContain("can't be read");
        expect((await a.toolset().call("request_access", { reason: "x", items: [{ kind: "folder", path: s.project }] }, { fromFlow: false })).isError).toBe(true);
        expect(fs.readFileSync(s.deps.file, "utf8")).toBe("{ broken");
    });
});
