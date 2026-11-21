import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AccessEntry, AccessView, SudoEntry } from "../src/contract";
import { Access } from "../src/service/access";
import type { ToolResult } from "../src/service/computerMcp";
import { ptyTerminals } from "./support/pty";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

const PASSWORD = "hunter2 is my password";

// sudo as far as these tests need it: asks with the prompt it's given, without echo, three times at most,
// and remembers it was unlocked. The real one is never run.
const FAKE_SUDO = `#!/bin/bash
prompt="[sudo] password: "
while [ $# -gt 0 ]; do
  case "$1" in
    -p) prompt="$2"; shift 2 ;;
    -v) shift ;;
    *) break ;;
  esac
done
if [ ! -e "$HOME/.unlocked" ]; then
  ok=0
  for i in 1 2 3; do
    printf '%s' "$prompt"
    IFS= read -rs pw
    printf '\\n'
    if [ "$pw" = "${PASSWORD}" ]; then ok=1; break; fi
    echo "Sorry, try again."
  done
  if [ $ok = 0 ]; then echo "sudo: 3 incorrect password attempts"; exit 1; fi
  touch "$HOME/.unlocked"
fi
[ $# -gt 0 ] && exec "$@"
exit 0
`;

/** a user's computer in a temp folder, with bash and the fake sudo, and the agent's access to it */
async function setup() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-shells-")));
    const home = path.join(root, "home");
    const project = path.join(home, "project");
    const bin = path.join(root, "bin");
    fs.mkdirSync(path.join(project, "src"), { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "sudo"), FAKE_SUDO, { mode: 0o755 });
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
    });
    access.load();
    cleanups.push(async () => {
        await access.shutdown();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tools = access.toolset();
    const call = async (name: string, args: Record<string, unknown>) => {
        const r = await tools.call(name, args, { fromFlow: false });
        results.push(r);
        return r;
    };
    const allowShell = async () => {
        const r = await call("request_access", { reason: "Set up the project.", items: [{ kind: "shell" }] });
        expect(r.isError).toBeFalsy();
        access.answer(posted.at(-1)!.id, "once");
    };
    const sudoCard = () => posted.filter((e): e is SudoEntry => e.kind === "sudo").at(-1)!;
    return { root, home, project, terminals, access, posted, notices, views, results, call, allowShell, sudoCard };
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

    test("sudo is unlocked by the password the user types on a card, which goes only to sudo", async () => {
        const s = await setup();
        await s.allowShell();
        await s.call("user_shell_open", { task: "Install a package", folder: s.project });

        const asked = await s.call("request_sudo", { shell: 1, reason: "Install ripgrep with the system's package manager." });
        expect(asked.text).toContain("Asked the user for their password");
        expect(s.sudoCard()).toMatchObject({ kind: "sudo", shell: 1, task: "Install a package", status: "waiting" });
        // while sudo waits for the user, the agent can neither run anything nor type into it
        expect((await s.call("user_shell_run", { shell: 1, command: "echo hi" })).text).toContain("waiting for the user's sudo password");
        expect((await s.call("user_shell_send", { shell: 1, text: "guess\r" })).text).toContain("only the user types");

        await s.access.shells.answerSudo(s.sudoCard().id, "not it");
        expect(s.sudoCard()).toMatchObject({ status: "waiting", error: "That password didn't work. Try again." });
        await s.access.shells.answerSudo(s.sudoCard().id, PASSWORD);
        expect(s.sudoCard().status).toBe("allowed");
        expect(s.notices.at(-1)).toContain("unlocked sudo in shell 1");

        expect((await s.call("user_shell_run", { shell: 1, command: "sudo echo as admin" })).text).toBe("`sudo echo as admin` exited with 0.\n\nas admin");
        // what sudo was told is nowhere the agent or the transcript can read
        const seen = JSON.stringify([s.results, s.posted, s.notices]);
        expect(seen).not.toContain("hunter2");
        expect(seen).not.toContain("not it");
    }, 30_000);

    test("a sudo request the user turns down leaves the shell at its prompt", async () => {
        const s = await setup();
        await s.allowShell();
        await s.call("user_shell_open", { task: "Fix permissions", folder: s.project });
        await s.call("request_sudo", { shell: 1, reason: "Change who owns the project's files." });
        await s.access.shells.declineSudo(s.sudoCard().id);
        expect(s.sudoCard().status).toBe("declined");
        expect(s.notices.at(-1)).toContain("said no to sudo");
        expect((await s.call("user_shell_run", { shell: 1, command: "echo back" })).text).toContain("back");
        expect(s.access.shells.answerSudo(s.sudoCard().id, PASSWORD)).rejects.toThrow("isn't waiting anymore");
    }, 30_000);

    test("shells close with the conversation, by the user, and when they exit", async () => {
        const s = await setup();
        await s.allowShell();
        await s.call("user_shell_open", { task: "One", folder: s.project });
        await s.call("user_shell_open", { task: "Two", folder: s.project });
        await s.call("user_shell_open", { task: "Three", folder: s.project });
        expect(s.terminals.running()).toHaveLength(3);

        // closed on the Access page: the agent is told
        const view = await s.access.closeShell(2);
        expect(view.shells.map((x) => x.task)).toEqual(["One", "Three"]);
        expect(s.notices.at(-1)).toBe("The user closed shell 2.");
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
