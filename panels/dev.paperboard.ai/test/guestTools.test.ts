// The guest's own tools (agent.py), run with python3: the shell for real,
// the window tools against stand-ins for the display (agent.py as a whole
// needs X, so the definitions under test are lifted out of it).

import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HARNESS = `
import ast, json, os, select, signal, subprocess, sys, threading, time
src = open(sys.argv[1]).read()
home = sys.argv[2]
names = {"ToolError", "Capped", "t_shell", "t_scroll", "t_place", "t_look"}
want = [n for n in ast.parse(src).body
        if (isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in names)
        or (isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") in ("SHELL_TIMEOUT_MAX", "OUTPUT_MAX", "SHELL_DRAIN_SECONDS", "SCROLL_MAX", "SIZE_MAX", "MAX_MARKS"))]
ns = {"os": os, "select": select, "signal": signal, "subprocess": subprocess, "threading": threading, "time": time, "HOME": home}
exec(compile(ast.Module(want, []), "agent.py", "exec"), ns)
Err = ns["ToolError"]
out = {}

def timed(args):
    t = time.monotonic()
    r = ns["t_shell"](args)["text"]
    return {"text": r, "seconds": time.monotonic() - t}

out["plain"] = timed({"command": "echo hi; echo oops >&2; exit 3"})
# a background job holding the output: the call returns when bash does, and the job keeps running
out["background"] = timed({"command": "sleep 30 & echo $! > bg.pid; echo started", "timeout": 10})
bg = int(open(os.path.join(home, "bg.pid")).read())
out["background_alive"] = os.path.exists(f"/proc/{bg}")
os.kill(bg, signal.SIGKILL)
# a background job with its output redirected doesn't hold the call either, and isn't flagged
out["detached"] = timed({"command": "sleep 30 > /dev/null 2>&1 & echo $! > det.pid; echo ok"})
os.kill(int(open(os.path.join(home, "det.pid")).read()), signal.SIGKILL)
# on timeout the whole group stops, background jobs too
out["timeout"] = timed({"command": "sleep 30 & echo $! > t.pid; sleep 30", "timeout": 1})
time.sleep(0.2)
tp = int(open(os.path.join(home, "t.pid")).read())
out["timeout_job_alive"] = os.path.exists(f"/proc/{tp}") and open(f"/proc/{tp}/stat").read().split()[2] != "Z"
# a flood is kept to its start and end
out["flood"] = timed({"command": "head -c 5000000 /dev/zero | tr '\\\\0' a; echo END"})
out["flood_len"] = len(out["flood"]["text"])

# window tools, against stand-ins
win = {"id": 7, "title": "w", "x": 0, "y": 0, "width": 800, "height": 600}
ns.update(find_window=lambda wid: win, raise_window=lambda wid: None, target_point=lambda w, a: (1, 1), xdo=lambda *a: None)
def err(fn, args):
    try:
        ns[fn](args)
        return None
    except Err as e:
        return str(e)
out["scroll_huge"] = err("t_scroll", {"window": 7, "amount": 100000})
out["scroll_zero"] = err("t_scroll", {"window": 7, "amount": 0})
out["scroll_ok"] = err("t_scroll", {"window": 7, "amount": -5})
out["place_negative"] = err("t_place", {"window": 7, "width": -10})
out["place_huge"] = err("t_place", {"window": 7, "x": 10 ** 9})

# looking forgets the marks of windows that have closed
ns.update(lock=threading.Lock(), marks_by_window={1: [{}], 7: []}, docs_by_window={1: None},
          window_ids=lambda: {7}, view_rect=lambda w: (0, 0, 800, 600), capture=lambda r: "img",
          atspi_marks=lambda w, r: ([{"kind": "link", "name": "a", "x": 1, "y": 1, "w": 5, "h": 5}], None, ""),
          is_browser=lambda w: False, draw_marks=lambda img, m: img, png_b64=lambda img: "PNG")
ns["time"] = type("T", (), {"sleep": staticmethod(lambda s: None), "monotonic": staticmethod(time.monotonic)})
ns["t_look"]({"window": 7})
out["marks_kept"] = sorted(ns["marks_by_window"])
out["docs_kept"] = sorted(ns["docs_by_window"])
print(json.dumps(out))
`;

const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-guest-tools-"));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
const r = Bun.spawnSync(["python3", "-I", "-c", HARNESS, path.join(import.meta.dir, "../computer/guest/agent.py"), home]);
const o = r.exitCode === 0 ? JSON.parse(r.stdout.toString()) : null;

describe("the guest's shell", () => {
    test("the harness ran", () => {
        expect(r.stderr.toString()).toBe("");
        expect(o).not.toBeNull();
    });

    test("it reports the exit code, output and errors", () => {
        expect(o.plain.text).toBe("exit 3\nhi\n\n[stderr]\noops\n");
    });

    test("a background job doesn't hold the call or turn it into a timeout; it keeps running", () => {
        expect(o.background.text).toStartWith("exit 0\nstarted\n");
        expect(o.background.text).toContain("background job still held the output");
        expect(o.background.seconds).toBeLessThan(3);
        expect(o.background_alive).toBe(true);
        expect(o.detached.text).toBe("exit 0\nok\n");
        expect(o.detached.seconds).toBeLessThan(2);
    });

    test("a timeout stops the command's whole group", () => {
        expect(o.timeout.text).toStartWith("Timed out after 1s; it was stopped.");
        expect(o.timeout.seconds).toBeLessThan(3);
        expect(o.timeout_job_alive).toBe(false);
    });

    test("a flood of output is kept to its start and end", () => {
        expect(o.flood_len).toBeLessThan(20_000);
        expect(o.flood.text).toContain("bytes cut");
        expect(o.flood.text.trimEnd()).toEndWith("END");
    });
});

describe("the guest's window tools", () => {
    test("scroll and place refuse amounts that would run away", () => {
        expect(o.scroll_huge).toContain("1 to 50 steps");
        expect(o.scroll_zero).toContain("1 to 50 steps");
        expect(o.scroll_ok).toBeNull();
        expect(o.place_negative).toContain("sizes are 1 to");
        expect(o.place_huge).toContain("sizes are 1 to");
    });

    test("a look forgets the marks of windows that have closed", () => {
        expect(o.marks_kept).toEqual([7]);
        expect(o.docs_kept).toEqual([7]);
    });
});
