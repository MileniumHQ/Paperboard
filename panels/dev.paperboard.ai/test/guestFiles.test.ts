// The guest's file tools (agent.py), run with python3 against a temporary
// home: files move in chunks, only inside the home folder, and never past
// their size limit.

import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HARNESS = `
import ast, base64, json, os, sys
src = open(sys.argv[1]).read()
home = os.path.realpath(sys.argv[2])
names = {"ToolError", "_home_path", "_offset", "t_file_get", "t_file_put"}
want = [n for n in ast.parse(src).body
        if (isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in names)
        or (isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") in ("FILE_CHUNK", "FILE_MAX"))]
ns = {"os": os, "base64": base64, "HOME": home}
exec(compile(ast.Module(want, []), "agent.py", "exec"), ns)
Err = ns["ToolError"]
out = {}

def attempt(fn, args):
    try:
        return fn(args)
    except Err as e:
        return {"error": str(e)}

b64 = lambda b: base64.b64encode(b).decode()
put, get = ns["t_file_put"], ns["t_file_get"]
out["first"] = put({"path": "Downloads/cat.jpg", "data": b64(b"abc")})
out["next"] = put({"path": "~/Downloads/cat.jpg", "offset": 3, "data": b64(b"def")})
out["gap"] = attempt(put, {"path": "Downloads/cat.jpg", "offset": 9, "data": b64(b"x")})
out["read"] = get({"path": "Downloads/cat.jpg"})
out["read_from"] = get({"path": "Downloads/cat.jpg", "offset": 4})
out["escape"] = attempt(get, {"path": "../../etc/passwd"})
out["absolute"] = attempt(get, {"path": "/etc/passwd"})
os.symlink("/etc", os.path.join(home, "etc"))
out["symlink"] = attempt(get, {"path": "etc/passwd"})
out["home_itself"] = attempt(put, {"path": "~", "data": b64(b"x")})
out["big_chunk"] = attempt(put, {"path": "big", "data": b64(b"x" * (ns["FILE_CHUNK"] + 1))})
out["not_b64"] = attempt(put, {"path": "x", "data": "!!!"})
out["bad_offset"] = attempt(get, {"path": "Downloads/cat.jpg", "offset": -1})
out["missing"] = attempt(get, {"path": "nope.txt"})
with open(os.path.join(home, "huge"), "wb") as f:
    f.truncate(ns["FILE_MAX"] + 1)
out["huge"] = attempt(get, {"path": "huge"})
print(json.dumps(out))
`;

const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-guest-files-"));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
const r = Bun.spawnSync(["python3", "-I", "-c", HARNESS, path.join(import.meta.dir, "../computer/guest/agent.py"), home]);
const out = JSON.parse(r.stdout.toString() || "{}");
const real = fs.realpathSync(home);
const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("the guest's file tools", () => {
    test("ran", () => expect(r.stderr.toString()).toBe(""));

    test("a file is written in order, chunk after chunk, and read back from any offset", () => {
        expect(out.first).toEqual({ path: path.join(real, "Downloads/cat.jpg"), written: 3 });
        expect(out.next).toEqual({ path: path.join(real, "Downloads/cat.jpg"), written: 6 });
        expect(out.gap.error).toContain("doesn't end at 9");
        expect(out.read).toEqual({ path: path.join(real, "Downloads/cat.jpg"), size: 6, data: b64("abcdef") });
        expect(out.read_from.data).toBe(b64("ef"));
    });

    test("only the home folder: no climbing out, no absolute paths elsewhere, no symlinks out", () => {
        for (const k of ["escape", "absolute", "symlink"]) expect(out[k].error).toContain("can be shared");
        expect(out.home_itself.error).toContain("can be shared");
    });

    test("bounded and checked: a chunk, a file, base64, offsets", () => {
        expect(out.big_chunk.error).toContain("more than a chunk");
        expect(out.not_b64.error).toBe("data must be base64");
        expect(out.bad_offset.error).toContain("offset");
        expect(out.missing.error).toContain("no file");
        expect(out.huge.error).toContain("MB can be shared");
    });
});
