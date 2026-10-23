// The guest's half of a sign-in (agent.py), run for real with python3. The
// screen, xdotool and the browser's DevTools are stand-ins: agent.py as a
// whole needs an X display, so only the sign-in definitions are lifted out
// of it, as guestMcp.test.ts does for the tool-server relay.

import { describe, expect, test } from "bun:test";
import path from "node:path";

const HARNESS = `
import ast, json, re, sys, time, urllib.parse
src = open(sys.argv[1]).read()
want = []
for n in ast.parse(src).body:
    if isinstance(n, ast.ClassDef) and n.name == "ToolError":
        want.append(n)
    elif isinstance(n, ast.FunctionDef) and (n.name in ("site_of", "sign_in_page") or "sign_in" in n.name):
        want.append(n)
    elif isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "").startswith(("SIGN_IN", "EDITABLE_JS", "sign_in")):
        want.append(n)
ns = {"json": json, "re": re, "time": time, "urllib": urllib}
exec(compile(ast.Module(want, []), "agent.py", "exec"), ns)
Err = ns["ToolError"]

# a browser window showing a sign-in page, as the latest look saw it
WIN = {"id": 7, "app": "helium", "x": 100, "y": 50, "width": 800, "height": 600}
page = {"url": "https://github.com/login", "webSocketDebuggerUrl": "ws://x"}
state = {"origin": "https://github.com", "editable": True, "pages": [page]}
log = []
ns.update(
    lock=__import__("threading").Lock(),
    find_window=lambda wid: WIN if wid == 7 else (_ for _ in ()).throw(Err("no window")),
    is_browser=lambda w: w["app"] == "helium",
    marks_by_window={7: [
        {"kind": "entry", "name": "Email", "x": 10, "y": 20, "w": 100, "h": 20},
        {"kind": "password text", "name": "", "x": 10, "y": 60, "w": 100, "h": 20},
        {"kind": "push button", "name": "Sign in", "x": 10, "y": 100, "w": 60, "h": 30},
    ]},
    docs_by_window={7: (100, 80, 800, 570, "Sign in to GitHub")},
    cdp_pages=lambda title: state["pages"] if title == "Sign in to GitHub" else [],
    raise_window=lambda wid: None,
    view_rect=lambda w: (0, 0, 1, 1),
    capture=lambda r: "img",
    draw_marks=lambda img, marks, labels: (log.append(["drawn", labels]), "drawn")[1],
    png_b64=lambda img: "PNG",
    cdp_open=lambda p: type("Ws", (), {"close": lambda self: log.append(["closed"])})(),
    cdp_value=lambda ws, n, js: [state["origin"], state["editable"]],
    cdp_send=lambda ws, n, method, params: log.append([method, params]),
    xdo=lambda *a: log.append(["xdo", *a]),
)
ns["time"] = type("T", (), {"sleep": staticmethod(lambda s: None)})

def run(fn, args):
    try:
        return {"ok": ns[fn](args)}
    except Err as e:
        return {"error": str(e)}

out = {}
out["button_as_field"] = run("t_sign_in_prepare", {"id": "abc123", "window": 7, "fields": [3], "submit": 1})
out["same_mark_twice"] = run("t_sign_in_prepare", {"id": "abc123", "window": 7, "fields": [1], "submit": 1})
out["prepared"] = run("t_sign_in_prepare", {"id": "abc123", "window": 7, "fields": [1, 2], "submit": 3})
out["drawn"] = [l for l in log if l[0] == "drawn"]
out["wrong_id"] = run("t_view_sign_in", {"id": "zzz999", "values": ["a", "b"]})
out["wrong_count"] = run("t_view_sign_in", {"id": "abc123", "values": ["a"]})
log.clear()
out["filled"] = run("t_view_sign_in", {"id": "abc123", "values": ["me@example.com", "hunter2"]})
out["fill_log"] = list(log)
out["again"] = run("t_view_sign_in", {"id": "abc123", "values": ["me@example.com", "hunter2"]})

# the page moved somewhere else between asking and filling: nothing is typed
run("t_sign_in_prepare", {"id": "abc124", "window": 7, "fields": [1, 2], "submit": 3})
state["pages"] = [{**page, "url": "https://evil.example/login"}]
log.clear()
out["moved"] = run("t_view_sign_in", {"id": "abc124", "values": ["me", "hunter2"]})
out["moved_log"] = list(log)
state["pages"] = [page]

# a redirect mid-fill, after the first field: the second value is never typed
run("t_sign_in_prepare", {"id": "abc125", "window": 7, "fields": [1, 2], "submit": 3})
log.clear()
calls = {"n": 0}
def flaky(ws, n, js):
    calls["n"] += 1
    return ["https://github.com" if calls["n"] == 1 else "https://evil.example", True]
ns["cdp_value"] = flaky
out["redirected"] = run("t_view_sign_in", {"id": "abc125", "values": ["me", "hunter2"]})
out["redirected_log"] = list(log)
ns["cdp_value"] = lambda ws, n, js: [state["origin"], state["editable"]]

# a field that didn't take the cursor
run("t_sign_in_prepare", {"id": "abc126", "window": 7, "fields": [1, 2], "submit": 3})
state["editable"] = False
log.clear()
out["not_editable"] = run("t_view_sign_in", {"id": "abc126", "values": ["me", "hunter2"]})
out["not_editable_log"] = list(log)
state["editable"] = True

# no submit button marked (one greyed out until typed in): Enter in the last field
out["no_submit"] = run("t_sign_in_prepare", {"id": "abc128", "window": 7, "fields": [1, 2]})
out["no_submit_drawn"] = [l for l in log if l[0] == "drawn"][-1]
log.clear()
out["entered"] = run("t_view_sign_in", {"id": "abc128", "values": ["me", "hunter2"]})
out["entered_log"] = list(log)

state["pages"] = [{**page, "url": "http://intranet.local/login"}]
out["http_site"] = run("t_sign_in_prepare", {"id": "abc127", "window": 7, "fields": [1], "submit": 3})
print(json.dumps(out))
`;

describe("the guest's sign-in", () => {
    const agent = path.join(import.meta.dir, "../computer/guest/agent.py");
    const r = Bun.spawnSync(["python3", "-I", "-c", HARNESS, agent]);
    const o = r.exitCode === 0 ? JSON.parse(r.stdout.toString()) : null;

    test("the harness ran", () => {
        expect(r.stderr.toString()).toBe("");
        expect(o).not.toBeNull();
    });

    test("only text fields can be filled, and each pick is a different mark", () => {
        expect(o.button_as_field.error).toContain("not a text field");
        expect(o.same_mark_twice.error).toContain("different mark");
    });

    test("prepare names the site from the browser, which fields are secret, and draws the picks", () => {
        expect(JSON.parse(o.prepared.ok.text)).toEqual({ site: "github.com", fields: [{ secret: false }, { secret: true }] });
        expect(o.prepared.ok.image).toBe("PNG");
        expect(o.drawn.at(-1)).toEqual(["drawn", ["1", "2", "submit"]]);
        expect(JSON.parse(o.http_site.ok.text).site).toBe("http://intranet.local");
    });

    test("the values are typed through DevTools into the picked fields, then submit is clicked, once", () => {
        expect(o.wrong_id.error).toContain("isn't waiting anymore");
        expect(o.wrong_count.error).toContain("one value per field");
        expect(o.filled).toEqual({ ok: { ok: true } });
        const typed = o.fill_log.filter((l: unknown[]) => l[0] === "Input.insertText").map((l: [string, { text: string }]) => l[1].text);
        expect(typed).toEqual(["me@example.com", "hunter2"]);
        // never on a command line
        expect(o.fill_log.filter((l: string[]) => l[0] === "xdo").flat().join(" ")).not.toContain("hunter2");
        // the clicks: email's centre, password's centre, then submit's, in screen coordinates
        const clicks = o.fill_log.filter((l: string[]) => l[0] === "xdo" && l[1] === "mousemove").map((l: string[]) => [l[3], l[4]]);
        expect(clicks).toEqual([
            ["160", "80"],
            ["160", "120"],
            ["140", "165"],
        ]);
        expect(o.fill_log.at(-1)).toEqual(["xdo", "click", "1"]);
        expect(o.again.error).toContain("isn't waiting anymore");
    });

    test("a page that left the site, before or during the fill, gets nothing more typed and nothing submitted", () => {
        expect(o.moved.error).toContain("isn't on github.com anymore");
        expect(o.moved_log.filter((l: string[]) => l[0] === "Input.insertText" || l[0] === "xdo")).toEqual([]);
        expect(o.redirected.error).toContain("isn't on github.com anymore");
        const typed = o.redirected_log.filter((l: string[]) => l[0] === "Input.insertText");
        expect(typed).toHaveLength(1);
        // the fields were clicked, submit never
        const moves = o.redirected_log.filter((l: string[]) => l[0] === "xdo" && l[1] === "mousemove").map((l: string[]) => [l[3], l[4]]);
        expect(moves).toEqual([
            ["160", "80"],
            ["160", "120"],
        ]);
    });

    test("with no submit button marked, Enter is pressed in the last field instead", () => {
        expect(o.no_submit.ok.image).toBe("PNG");
        expect(o.no_submit_drawn).toEqual(["drawn", ["1", "2"]]);
        expect(o.entered).toEqual({ ok: { ok: true } });
        const moves = o.entered_log.filter((l: string[]) => l[0] === "xdo" && l[1] === "mousemove");
        expect(moves).toHaveLength(2); // the two fields, no button
        expect(o.entered_log.at(-1)).toEqual(["xdo", "key", "Return"]);
    });

    test("a field that doesn't take the cursor stops the fill before anything is typed", () => {
        expect(o.not_editable.error).toContain("didn't take the cursor");
        expect(o.not_editable_log.filter((l: string[]) => l[0] === "Input.insertText")).toEqual([]);
    });
});
