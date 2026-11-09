import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { HomeFolder, moveHomeFolder } from "../../src/service/homeFolder";
import { shellToolset } from "../../src/service/shell";
import { tempDir } from "../support/host";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * A home folder with a link in it to a folder outside, holding the user's own file. The link is a directory
 * junction on Windows (no privilege needed) and a symlink elsewhere: the link each system makes without asking.
 */
function setup() {
    const root = tempDir("home");
    dirs.push(root);
    const home = new HomeFolder(path.join(root, "home"));
    home.ensure();
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "the user's own file");
    fs.symlinkSync(outside, path.join(home.root, "link"), process.platform === "win32" ? "junction" : "dir");
    fs.writeFileSync(path.join(home.root, "mine.txt"), "the agent's file");
    const untouched = () => {
        expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("the user's own file");
    };
    const shell = shellToolset(home);
    const run = (command: string) => shell.call("bash", { command }, { fromFlow: false });
    return { root, home, outside, untouched, run };
}

const inside = (root: string, p: string) => {
    const real = fs.realpathSync(root);
    return p === real || p.startsWith(real + path.sep);
};

// The home folder is a hard boundary.
describe("the home folder", () => {
    test("paths can't escape ~ by .., absolute paths or links", () => {
        const { home, outside, untouched } = setup();
        for (const p of ["../outside/secret.txt", "~/../outside/secret.txt", "/etc/passwd", "/home/user/../../outside", "~/Downloads/../../outside", "~\\..\\outside\\secret.txt", "~/link/secret.txt", "~/link", "~/link/new.txt", "", "a\0b"]) {
            expect(() => home.resolve(p)).toThrow();
        }
        // a drive or share path is either refused or a name inside ~
        for (const p of ["C:\\Windows\\System32", "C:/Windows", "\\\\server\\share\\x"]) {
            let resolved: string | null = null;
            try {
                resolved = home.resolve(p);
            } catch (e) {
                expect(String(e)).toMatch(/home folder|file's path/);
            }
            if (resolved !== null) expect(inside(home.root, resolved)).toBe(true);
        }
        expect(() => home.write("~/link/new.txt", Buffer.from("x"))).toThrow();
        expect(() => home.read("~/link/secret.txt")).toThrow();
        expect(home.read("~/mine.txt").data.toString()).toBe("the agent's file");
        expect(home.write("~/Downloads/new.txt", Buffer.from("ok"))).toBe("~/Downloads/new.txt");
        untouched();
        expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
    });

    test("in the shell, ln -s is refused, and reads, writes and rm -rf through links leave outside files alone", async () => {
        const { home, untouched, run } = setup();
        const ln = await run("ln -s /etc ~/etc-link && echo LINKED");
        expect(ln.text).not.toContain("LINKED");
        expect(fs.existsSync(path.join(home.root, "etc-link"))).toBe(false);
        const read = await run("cat ~/link/secret.txt");
        expect(read.text).not.toContain("the user's own file");
        await run("echo pwned > ~/link/secret.txt; echo pwned > ~/link/new.txt; cp ~/mine.txt ~/link/copy.txt; mv ~/mine.txt ~/link/moved.txt");
        await run("rm -rf ~/link/; rm -rf ~/link/*; rm -rf ~/link/secret.txt; rm -rf ~/link; rm -rf ~/*");
        untouched();
    });

    test("only the shell's own programs exist", async () => {
        const { run } = setup();
        // each would print HOST_RAN if a program of this computer's ran
        for (const program of [
            `node -e "console.log('HOST_' + 'RAN')"`,
            `python3 -c "print('HOST_' + 'RAN')"`,
            `npm exec -c "echo HOST_RAN"`,
            "git --version",
            `cmd /c "echo HOST_RAN"`,
            `powershell -c "echo HOST_RAN"`,
            `"${process.execPath.replace(/\\/g, "/")}" -e "console.log('HOST_' + 'RAN')"`,
        ]) {
            const r = await run(program);
            expect(r.text).toMatch(/\[exit code [1-9]\d*\]/);
            expect(r.text).not.toContain("HOST_RAN");
            expect(r.text).not.toMatch(/git version \d/);
        }
        expect((await run("echo $((6 * 7))")).text).toBe("42\n");
    });

    test("erasing the computer empties ~ and never follows its links", () => {
        const { home, untouched } = setup();
        home.erase();
        untouched();
        expect(fs.readdirSync(home.root)).toEqual(["Downloads"]);
    });

    test("the old browser/home is moved to home once, without overwriting anything", () => {
        const root = tempDir("move");
        dirs.push(root);
        const from = path.join(root, "browser", "home");
        const to = path.join(root, "home");
        fs.mkdirSync(from, { recursive: true });
        fs.writeFileSync(path.join(from, "old.txt"), "old");
        moveHomeFolder(from, to);
        expect(fs.existsSync(from)).toBe(false);
        expect(fs.readFileSync(path.join(to, "old.txt"), "utf8")).toBe("old");
        // run again with nothing to move: nothing changes
        moveHomeFolder(from, to);
        expect(fs.readdirSync(to)).toEqual(["old.txt"]);
        // both exist (an older version ran after the move): the old one goes inside, beside what's there
        fs.mkdirSync(from, { recursive: true });
        fs.writeFileSync(path.join(from, "old.txt"), "older still");
        moveHomeFolder(from, to);
        expect(fs.readFileSync(path.join(to, "old.txt"), "utf8")).toBe("old");
        expect(fs.readFileSync(path.join(to, "Earlier home folder", "old.txt"), "utf8")).toBe("older still");
        expect(fs.existsSync(from)).toBe(false);
    });
});
