import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AccessEntry, AccessView, SudoEntry } from "../src/contract";
import { Access } from "../src/service/access";
import type { ToolResult } from "../src/service/computerMcp";
import { waitFor } from "testkit/wait";
import { ptyTerminals } from "./support/pty";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

const PASSWORD = "hunter2 is my password";

// sudo as far as these tests need it, the way it reads `sudo -S -k -p <prompt> -- <command>`: it asks on stderr,
// three times at most, reads each password as a line of stdin, and runs the command with the rest of stdin.
// It doesn't ask when the computer lets the user run it without a password. The real one is never run.
const fakeSudo = (nopasswd: string) => `#!/bin/bash
prompt="[sudo] password: "
while [ $# -gt 0 ]; do
  case "$1" in
    -p) prompt="$2"; shift 2 ;;
    -S|-k) shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [ ! -e "${nopasswd}" ]; then
  ok=0
  for i in 1 2 3; do
    printf '%s' "$prompt" >&2
    if ! IFS= read -r pw; then echo "sudo: no password was provided" >&2; exit 1; fi
    if [ "$pw" = "${PASSWORD}" ]; then ok=1; break; fi
    echo "Sorry, try again." >&2
  done
  if [ $ok = 0 ]; then echo "sudo: 3 incorrect password attempts" >&2; exit 1; fi
fi
exec "$@"
`;

/** a user's computer in a temp folder, with bash and the fake sudo, and the agent's access to it */
async function setup() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-shells-")));
    const home = path.join(root, "home");
    const project = path.join(home, "project");
    const bin = path.join(root, "bin");
    fs.mkdirSync(path.join(project, "src"), { recursive: true });
    fs.mkdirSync(bin);
    const sudoBinary = path.join(root, "sudo");
    fs.writeFileSync(sudoBinary, fakeSudo(path.join(root, "nopasswd")), { mode: 0o755 });
    const terminals = await ptyTerminals({ shell: "/bin/bash", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, LANG: "C.UTF-8" } });
    const posted: (AccessEntry | SudoEntry)[] = [];
    const notices: string[] = [];
    const views: AccessView[] = [];
    const results: ToolResult[] = [];
    const access = new Access({
        file: path.join(root, "access.json"),
        home,
        terminals,
        post: (e) => posted.push(structuredClone(e)),
        tell: (t) => notices.push(t),
        turning: () => false,
        onChange: (v) => views.push(v),
        platform: "linux",
        sudoBinary,
    });
    access.load();
    cleanups.push(async () => {
        await access.shutdown();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tools = access.toolset();
    const call = async (name: string, args: Record<string, unknown>, fromFlow = false) => {
        const r = await tools.call(name, args, { fromFlow });
        results.push(r);
        return r;
    };
    const allowShell = async () => {
        const r = await call("request_access", { reason: "Set up the project.", items: [{ kind: "shell" }] });
        expect(r.isError).toBeFalsy();
        access.answer(posted.at(-1)!.id, "once");
    };
    const sudoCard = () => posted.filter((e): e is SudoEntry => e.kind === "sudo").at(-1)!;
    const sudoSettled = () => waitFor("the sudo card to settle", () => sudoCard().status !== "running" && sudoCard());
    return { root, home, project, terminals, access, posted, notices, views, results, call, allowShell, sudoCard, sudoSettled };
}

describe("the agent's shells on the user's computer", () => {
    test("a shell needs the user's say-so, and keeps its folder and variables from one command to the next", async () => {
        const s = await setup();
        const refused = await s.call("user_shell_open", { task: "Build it", folder: s.project });
        expect(refused.isError).toBe(true);
        expect(refused.text).toContain("isn't allowed");

        await s.allowShell();
        const opened = await s.call("user_shell_open", { task: "Build it", folder: "~/project" });
        expect(opened.text).toContain("Shell 1 is open");
        expect(s.access.view().shells).toMatchObject([{ id: 1, task: "Build it", folder: s.project, running: null }]);

        expect((await s.call("user_shell_run", { shell: 1, command: "cd src && export ANSWER=42" })).text).toBe("`cd src && export ANSWER=42` exited with 0. (no output)");
        const both = await s.call("user_shell_run", { shell: 1, command: 'pwd; echo "answer $ANSWER"' });
        // the command's own output, without the prompt or the line typed
        expect(both.text).toBe(`\`pwd; echo "answer $ANSWER"\` exited with 0.\n\n${path.join(s.project, "src")}\nanswer 42`);

        // a command that would open a browser on the user's screen prints its link for the agent instead
        expect((await s.call("user_shell_run", { shell: 1, command: 'echo "browser: $BROWSER"' })).text).toEndWith("browser: true");

        const failed = await s.call("user_shell_run", { shell: 1, command: "ls nothing-here" });
        expect(failed.isError).toBe(true);
        expect(failed.text).toStartWith("`ls nothing-here` exited with 2.");
        expect(failed.text).toContain("No such file or directory");

        // the grant for this time lapses with the turn; the shell it opened stays for its task
        s.access.turnEnded();
        expect((await s.call("user_shell_run", { shell: 1, command: "echo still here" })).text).toContain("still here");
        expect((await s.call("user_shell_open", { task: "Another", folder: s.project })).text).toContain("isn't allowed");
    });

    test("a command that asks something shows the question while it waits, and takes the answer", async () => {
        const s = await setup();
        await s.allowShell();
        await s.call("user_shell_open", { task: "Sign in", folder: s.project });

        // a sign-in that prints a code and waits, as gh auth login does
        const waiting = await s.call("user_shell_run", { shell: 1, command: 'echo "Your one-time code: AB12-CD34"; read -p "Press Enter to continue " x; echo "signed in"' });
        expect(waiting.isError).toBeFalsy();
        expect(waiting.text).toContain("is still running");
        expect(waiting.text).toContain("Your one-time code: AB12-CD34");
        expect(waiting.text).toContain("Press Enter to continue");
        expect(s.access.view().shells[0]!.running).toContain("one-time code");
        // the shell is busy: a new command would be typed into the question
        expect((await s.call("user_shell_run", { shell: 1, command: "echo hi" })).text).toContain("still running");

        const done = await s.call("user_shell_send", { shell: 1, keys: ["enter"] });
        // only what's new since the last look
        expect(done.text).toBe("`echo \"Your one-time code: AB12-CD34\"; read -p \"Press Enter to continue \" x; echo \"signed in\"` exited with 0.\n\n[2 lines you've seen above]\nsigned in");

        // a progress line reads as its last state
        const progress = await s.call("user_shell_run", { shell: 1, command: "printf 'loading 10%%\\r'; sleep 0.2; printf 'loading 100%%\\n'" });
        expect(progress.text).toEndWith("\n\nloading 100%");

        // keys go to the program in front; at the prompt, only a command is run
        expect((await s.call("user_shell_send", { shell: 1, text: "ls" })).text).toContain("at its prompt");
        const stopped = await s.call("user_shell_run", { shell: 1, command: "sleep 30", wait_seconds: 1 });
        expect(stopped.text).toContain("still running");
        expect((await s.call("user_shell_send", { shell: 1, keys: ["ctrl-c"] })).text).toContain("`sleep 30` exited with 130.");
    }, 30_000);

    test("a command as administrator runs only as the card shows it, outside the agent's shells, and the password reaches only sudo", async () => {
        const s = await setup();
        const command = 'echo "as $(id -un) in $(pwd)"; cat';
        expect((await s.call("request_sudo", { command, folder: s.project, reason: "Install ripgrep." })).text).toContain("isn't allowed");
        await s.allowShell();
        // the agent's own shell has a sudo that would keep what it's given: the password never goes through a shell
        await s.call("user_shell_open", { task: "Install a package", folder: s.project });
        await s.call("user_shell_run", { shell: 1, command: `sudo() { cat > "${path.join(s.home, "caught")}"; }` });

        const asked = await s.call("request_sudo", { command, folder: "~/project", reason: "Install ripgrep." });
        expect(asked.isError).toBeFalsy();
        expect(s.sudoCard()).toMatchObject({ kind: "sudo", command, folder: s.project, reason: "Install ripgrep.", status: "waiting" });
        // one at a time: a new request replaces the one waiting
        await s.call("request_sudo", { command, folder: s.project, reason: "Install ripgrep." });
        expect(s.posted.filter((e) => e.kind === "sudo").map((e) => e.status)).toEqual(["waiting", "expired", "waiting"]);

        await s.access.sudo.answer(s.sudoCard().id, "not it");
        expect(await s.sudoSettled()).toMatchObject({ status: "waiting", error: "That password didn't work. Try again." });
        await s.access.sudo.answer(s.sudoCard().id, PASSWORD);
        expect(await s.sudoSettled()).toMatchObject({ status: "done", exitCode: 0 });
        // the command got no input: its cat read nothing, not the password
        expect(s.notices.at(-1)).toBe(`\`${command}\` ran as administrator in ${s.project} and exited with 0.\n\nas ${os.userInfo().username} in ${s.project}`);
        expect(s.access.sudo.answer(s.sudoCard().id, PASSWORD)).rejects.toThrow("isn't waiting anymore");

        // what sudo was told is nowhere the agent, the transcript or the agent's shell can read
        const seen = JSON.stringify([s.posted, s.notices, s.results, s.access.view()]);
        expect(seen).not.toContain(PASSWORD);
        expect(fs.existsSync(path.join(s.home, "caught"))).toBe(false);
    }, 30_000);

    test("a sudo request ends when the user says no, after three wrong passwords, and without a password where none is asked", async () => {
        const s = await setup();
        await s.allowShell();
        await s.call("request_sudo", { command: "chown -R me .", folder: s.project, reason: "Fix who owns the files." });
        s.access.sudo.decline(s.sudoCard().id);
        expect(s.sudoCard().status).toBe("declined");
        expect(s.notices.at(-1)).toContain("said no to running `chown -R me .`");

        await s.call("request_sudo", { command: "true", folder: s.project, reason: "Check sudo." });
        for (let i = 0; i < 3; i++) {
            await s.access.sudo.answer(s.sudoCard().id, `wrong ${i}`);
            await s.sudoSettled();
        }
        expect(s.sudoCard()).toMatchObject({ status: "failed", error: "sudo refused the password 3 times" });
        expect(s.notices.at(-1)).toContain("refused the user's password 3 times");

        // a computer that lets sudo run without a password: the password typed is never handed to the command
        fs.writeFileSync(path.join(s.root, "nopasswd"), "");
        await s.call("request_sudo", { command: "echo ran; cat", folder: s.project, reason: "Check sudo." });
        await s.access.sudo.answer(s.sudoCard().id, PASSWORD);
        expect(await s.sudoSettled()).toMatchObject({ status: "done", exitCode: 0 });
        expect(s.notices.at(-1)).toEndWith("exited with 0.\n\nran");
        expect(JSON.stringify(s.notices)).not.toContain(PASSWORD);
    }, 30_000);

    test("taking shells back closes them, and an automation drives shells only when they're allowed for good", async () => {
        const s = await setup();
        await s.allowShell();
        await s.call("user_shell_open", { task: "Build it", folder: s.project });
        // allowed for this time: the user's next turn keeps the shell, an automation can't use it
        s.access.turnEnded();
        expect((await s.call("user_shell_run", { shell: 1, command: "echo mine" })).text).toContain("mine");
        const flow = await s.call("user_shell_run", { shell: 1, command: "echo flow" }, true);
        expect(flow.isError).toBe(true);
        expect(flow.text).toContain("allowed for good");

        // allowed for good: the same shell is the automation's too
        await s.call("request_access", { reason: "Keep building.", items: [{ kind: "shell" }] });
        s.access.answer(s.posted.at(-1)!.id, "always");
        expect((await s.call("user_shell_run", { shell: 1, command: "echo flow" }, true)).text).toContain("flow");

        await s.access.revoke({ kind: "shell" });
        expect(s.access.view().shells).toEqual([]);
        expect(s.terminals.running()).toEqual([]);
        expect((await s.call("user_shell_run", { shell: 1, command: "echo hi" })).text).toContain("no shell is open");
    }, 30_000);

    test("shells close with the conversation, by the user, and when they exit", async () => {
        const s = await setup();
        await s.allowShell();
        await s.call("user_shell_open", { task: "One", folder: s.project });
        await s.call("user_shell_open", { task: "Two", folder: s.project });
        await s.call("user_shell_open", { task: "Three", folder: s.project });
        expect(s.terminals.running()).toHaveLength(3);

        // closed on the Access page: the agent isn't woken for it, its next turn lists the shells left
        const told = s.notices.length;
        const view = await s.access.closeShell(2);
        expect(view.shells.map((x) => x.task)).toEqual(["One", "Three"]);
        expect(s.notices).toHaveLength(told);
        // a shell that exits by itself is gone too
        expect((await s.call("user_shell_run", { shell: 3, command: "exit" })).text).toContain("Shell 3 ended");
        expect(s.access.view().shells.map((x) => x.id)).toEqual([1]);

        await s.access.shutdown();
        expect(s.terminals.running()).toEqual([]);
        expect(s.access.view().shells).toEqual([]);
    }, 30_000);

    test("a shell left by a service that stopped without closing it is closed when the next one starts", async () => {
        const s = await setup();
        await s.terminals.create("dev.paperboard.agents.shell-1", { cols: 80, rows: 24, cwd: s.project, env: {} });
        await s.access.shells.sweep();
        expect(s.terminals.running()).toEqual([]);
    });
});
