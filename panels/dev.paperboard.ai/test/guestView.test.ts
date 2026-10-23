// The guest's view of windows (agent.py) redirects them with X Composite so
// the user can watch one while another covers it. The redirect must be
// automatic: under a manual one the server stops drawing the screen, and
// every look and capture (root-window reads) comes back black. Run with
// python3 against stand-ins for the display; agent.py as a whole needs X.

import { expect, test } from "bun:test";
import path from "node:path";

const HARNESS = `
import ast, json, sys
src = open(sys.argv[1]).read()
want = [n for n in ast.parse(src).body
        if (isinstance(n, ast.ClassDef) and n.name == "ToolError") or (isinstance(n, ast.FunctionDef) and n.name == "_view")]
modes = []
class Root:
    def composite_redirect_subwindows(self, mode): modes.append(mode)
class Screen:
    def __init__(self): self.root = Root()
class Display:
    def has_extension(self, name): return name == "Composite"
    def screen(self): return Screen()
    def sync(self): pass
# the Composite protocol's values (python-xlib's Xlib.ext.composite)
Composite = type("composite", (), {"RedirectAutomatic": 0, "RedirectManual": 1})
ns = {"composite": Composite, "xd": Display, "view_display": None}
exec(compile(ast.Module(want, []), "agent.py", "exec"), ns)
ns["_view"]()
print(json.dumps(modes))
`;

test("windows are redirected automatically, so the screen is still drawn for looks", () => {
    const r = Bun.spawnSync(["python3", "-I", "-c", HARNESS, path.join(import.meta.dir, "../computer/guest/agent.py")]);
    expect(r.stderr.toString()).toBe("");
    expect(JSON.parse(r.stdout.toString())).toEqual([0]);
});
