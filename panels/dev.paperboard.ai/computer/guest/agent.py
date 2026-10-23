#!/usr/bin/env python3
"""The agent's hands inside its own computer (scratch prototype).

Runs inside the Debian VM as the unprivileged `agent` user, next to an Xvfb
display with no window manager: every top-level window is its own thing the
agent can look at, move and resize. The host talks to it over one HTTP
endpoint, POST /call {"tool": ..., "args": {...}}, authenticated with a token.

Looking at a window returns a screenshot with numbered marks on everything
that can be clicked, typed into or scrolled, read from the accessibility tree
(AT-SPI) that every GTK, Qt, Chromium and Electron app exposes. Coordinates
always work too, and zoom shows a region enlarged with a coordinate grid for
the targets marks can't reach.
"""

import base64
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFont
from Xlib import X, display as xdisplay
from Xlib.error import XError

PORT = int(os.environ.get("AGENT_PORT", "7070"))
TOKEN = open(os.environ.get("AGENT_TOKEN_FILE", "/etc/paperboard/token")).read().strip()
DISPLAY = os.environ.get("DISPLAY", ":1")
CDP = "http://127.0.0.1:9222"
HELIUM = "/usr/bin/helium"
HOME = os.path.expanduser("~")

# every app started from here (open, shell) joins the accessibility bus, so it can be marked
os.environ.update({
    "DISPLAY": DISPLAY,
    "ACCESSIBILITY_ENABLED": "1",  # Chromium, Electron
    "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1",  # Qt
    "GTK_A11Y": "atspi",  # GTK 4
})
SHELL_TIMEOUT_MAX = 600
OUTPUT_MAX = 16_000
MAX_MARKS = 120
MAX_BODY = 1 << 20

# the last marks shown for each window, so "click mark 7" means what the agent saw
marks_by_window: dict[int, list[dict]] = {}
lock = threading.Lock()


# ---------------------------------------------------------------- windows

def xd():
    return xdisplay.Display(DISPLAY)


def prop(d, win, name):
    try:
        p = win.get_full_property(d.intern_atom(name), X.AnyPropertyType)
    except XError:
        return None
    return p.value if p else None


def text_prop(d, win, name):
    v = prop(d, win, name)
    if v is None:
        return ""
    return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)


def list_windows():
    """Top-level, viewable, normal windows (menus and tooltips are captured with their parent)."""
    d = xd()
    try:
        out = []
        for w in d.screen().root.query_tree().children:
            try:
                a = w.get_attributes()
                g = w.get_geometry()
            except XError:
                continue
            if a.map_state != X.IsViewable or a.override_redirect or g.width < 40 or g.height < 40:
                continue
            title = text_prop(d, w, "_NET_WM_NAME") or text_prop(d, w, "WM_NAME")
            cls = prop(d, w, "WM_CLASS")
            app = cls.split(b"\0")[1].decode() if isinstance(cls, bytes) and cls.count(b"\0") >= 2 else ""
            pid = prop(d, w, "_NET_WM_PID")
            out.append({
                "id": w.id, "title": title, "app": app,
                "pid": int(pid[0]) if pid is not None and len(pid) else None,
                "x": g.x, "y": g.y, "width": g.width, "height": g.height,
            })
        return out
    finally:
        d.close()


def find_window(wid):
    for w in list_windows():
        if w["id"] == wid:
            return w
    raise ToolError(f"no window {wid}; call windows to see what's open")


def raise_window(wid):
    """Bring a window to the front, unless it's already there (restacking would bury its open menus)."""
    d = xd()
    try:
        top = None
        for c in d.screen().root.query_tree().children:  # bottom to top
            try:
                a = c.get_attributes()
            except XError:
                continue
            if a.map_state == X.IsViewable and not a.override_redirect:
                top = c.id
        if top == wid:
            return
        w = d.create_resource_object("window", wid)
        w.configure(stack_mode=X.Above)
        w.set_input_focus(X.RevertToParent, X.CurrentTime)
        d.sync()
    finally:
        d.close()


def view_rect(win):
    """A window's rectangle, grown right and down over popups that open from it and hang past its edge."""
    d = xd()
    try:
        sw, sh = d.screen().width_in_pixels, d.screen().height_in_pixels
        x, y = max(0, win["x"]), max(0, win["y"])
        right, bottom = win["x"] + win["width"], win["y"] + win["height"]
        for c in d.screen().root.query_tree().children:
            try:
                a, g = c.get_attributes(), c.get_geometry()
            except XError:
                continue
            # menus and dropdowns are override-redirect windows starting inside this one
            if a.map_state == X.IsViewable and a.override_redirect and x <= g.x < right and y <= g.y < bottom:
                right, bottom = max(right, g.x + g.width), max(bottom, g.y + g.height)
        return x, y, min(right, sw) - x, min(bottom, sh) - y
    finally:
        d.close()


def capture(rect):
    """The screen inside a rectangle, popups and menus over it included."""
    d = xd()
    try:
        root = d.screen().root
        x, y, w, h = rect
        raw = root.get_image(x, y, w, h, X.ZPixmap, 0xFFFFFFFF)
        return Image.frombytes("RGB", (w, h), raw.data, "raw", "BGRX")
    finally:
        d.close()


# ---------------------------------------------------------------- marks
#
# Marks come from the accessibility tree (AT-SPI), the same one screen readers
# use, so GTK, Qt, Chromium and Electron apps are all read the same way. A node
# is a mark when it has a real action (press, jump, click, activate…), is
# editable, or has a control role; anything with scroll actions is a scroll
# area. Hit-testing through the same tree drops marks something else covers.
# Apps that draw their own pixels (canvas, games, plain X11) expose nothing:
# for those the agent zooms and uses coordinates.

ATSPI_ROLES = {
    "push button", "toggle button", "check box", "radio button", "menu item", "check menu item",
    "radio menu item", "menu", "link", "entry", "password text", "combo box", "spin button",
    "slider", "page tab", "list item", "table cell", "tree item", "icon", "scroll bar", "button",
}
# actions every node has, or that only point at a clickable ancestor
NOT_ACTIONS = {"dodefault", "showcontextmenu", "clickancestor", "setfocus", "focus", "default"}
SCROLL_ACTIONS = {"scrollup", "scrolldown", "scrollforward", "scrollbackward", "scrollleft", "scrollright"}
# containers that only count when nothing inside them is a mark of its own
CONTAINER_ROLES = {"list item", "table cell", "tree item", "table row", "section", "panel", "filler", "page tab"}
# where hit-testing gives up without reaching content: says nothing about what's on top
OPAQUE_HITS = {"panel", "filler", "frame", "window", "root pane", "layered pane", "scroll pane", "viewport"}
LABEL_ROLES = {"static", "label", "text", "heading", "image", "paragraph", "icon"}
WALK_BUDGET = 4000
WALK_SECONDS = 4.0


def _atspi():
    import warnings

    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    # Action.get_action_name is the name lookup; newer libatspi only marks it deprecated
    warnings.filterwarnings("ignore", category=DeprecationWarning, module=__name__)
    return Atspi


def _gone():
    from gi.repository import GLib

    return GLib.Error  # what AT-SPI raises when a node or app goes away mid-call


def _overlap(a, b):
    """Area of rectangle a (x, y, w, h) that lies inside b."""
    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return max(0, w) * max(0, h)


def _inner_text(node, limit=60):
    """A label for an unnamed control: the text of what's inside it."""
    out, queue, budget = [], [node], 40
    while queue and budget > 0 and len(" ".join(out)) < limit:
        n = queue.pop(0)
        budget -= 1
        for k in range(n.get_child_count()):
            c = n.get_child_at_index(k)
            if c is None:
                continue
            name = (c.get_name() or "").strip()
            if name and c.get_role_name() in LABEL_ROLES:
                out.append(name)
            else:
                queue.append(c)
    return " ".join(out)


def _hit(Atspi, root, node, cx, cy):
    """True unless hit-testing at the mark's centre lands on something else (it's covered)."""
    hit = root
    for _ in range(30):
        try:
            nxt = Atspi.Component.get_accessible_at_point(hit, cx, cy, Atspi.CoordType.SCREEN)
        except _gone():  # this app doesn't hit-test here; occlusion is unknown, keep the mark
            return True
        if nxt is None or nxt == hit:
            break
        hit = nxt
        if hit == node:
            return True
    if hit == root or hit.get_role_name() in OPAQUE_HITS:
        return True  # hit-testing stopped at the window or a host view (Electron does): unknown, keep
    # ours if the hit is inside the node (its label) or stopped above it (common in GTK)
    return _ancestor(node, hit) or _ancestor(hit, node)


def _ancestor(a, b):
    """True if a is b or one of b's ancestors."""
    for _ in range(60):
        if b is None:
            return False
        if b == a:
            return True
        b = b.get_parent()
    return False


def atspi_marks(win, rect):
    """Marks for one window, and the page's viewport (screen rect) if it shows web content."""
    Atspi = _atspi()
    desktop = Atspi.get_desktop(0)
    apps = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
    app = next((a for a in apps if a and win["pid"] and a.get_process_id() == win["pid"]), None)
    if app is None:
        return [], None, "this app has no accessibility tree; zoom in and use coordinates"

    tops = []
    for i in range(app.get_child_count()):
        c = app.get_child_at_index(i)
        if c is None:
            continue
        e = c.get_extents(Atspi.CoordType.SCREEN)
        area = max(1, e.width * e.height)
        if _overlap((e.x, e.y, e.width, e.height), rect) * 2 >= area:  # mostly inside: this window or its popups
            tops.append(c)
    # several same-sized windows of one app stacked together: keep the one with this title
    titled = [t for t in tops if t.get_role_name() == "frame" and (t.get_name() or "") == win["title"]]
    if titled:
        tops = titled + [t for t in tops if t.get_role_name() != "frame"]

    marks, docs = [], []
    budget = [WALK_BUDGET]
    deadline = time.monotonic() + WALK_SECONDS

    def classify(node, role, states):
        acts = set()
        if node.get_action_iface():
            for k in range(Atspi.Action.get_n_actions(node)):
                acts.add((Atspi.Action.get_action_name(node, k) or "").lower())
        if acts & SCROLL_ACTIONS and not states.contains(Atspi.StateType.EDITABLE):
            return "scroll area"
        if acts - NOT_ACTIONS - SCROLL_ACTIONS or role in ATSPI_ROLES or states.contains(Atspi.StateType.EDITABLE):
            return role
        return None

    def walk(node, depth, root):
        """Adds marks under node; returns how many it added."""
        if node is None or depth > 60 or budget[0] <= 0 or time.monotonic() > deadline:
            return 0
        budget[0] -= 1
        try:
            states = node.get_state_set()
            if not states.contains(Atspi.StateType.SHOWING):
                return 0
            role = node.get_role_name()
            if role == "document web":
                e = node.get_extents(Atspi.CoordType.SCREEN)
                docs.append((e.x, e.y, e.width, e.height, node.get_name() or ""))
            kind = classify(node, role, states)
            slot = None
            if kind:
                e = node.get_extents(Atspi.CoordType.SCREEN)
                box = (e.x, e.y, e.width, e.height)
                if e.width > 2 and e.height > 2 and _overlap(box, rect) * 2 >= e.width * e.height:
                    if kind == "scroll area" and e.height < 60:
                        kind = None
                    else:
                        slot = len(marks)
                        marks.append({"node": node, "root": root, "kind": kind, "box": box, "role": role})
            added = 1 if slot is not None else 0
            inner = 0
            for k in range(node.get_child_count()):
                inner += walk(node.get_child_at_index(k), depth + 1, root)
            if slot is not None and inner and role in CONTAINER_ROLES and marks[slot]["kind"] != "scroll area":
                marks[slot] = None  # its contents are marked; the container adds nothing
                added = 0
            return added + inner
        except _gone():  # the node went away mid-walk, and its subtree with it
            return 0

    for t in tops:
        walk(t, 0, t)

    out = []
    for m in marks:
        if m is None:
            continue
        x, y, w, h = m["box"]
        cx, cy = x + w // 2, y + h // 2
        try:
            if not _hit(Atspi, m["root"], m["node"], cx, cy):
                continue
            name = (m["node"].get_name() or "").strip()
            if not name and m["role"] == "password text":
                name = ""
            elif not name and m["node"].get_text_iface() and m["role"] in ("entry", "text"):
                name = Atspi.Text.get_text(m["node"], 0, 60)
            elif not name:
                name = _inner_text(m["node"])
        except _gone():  # the node vanished between the walk and now: drop it
            continue
        out.append({"kind": m["kind"], "name": " ".join(name.split())[:60],
                    "x": x - win["x"], "y": y - win["y"], "w": w, "h": h})
    doc = max(docs, key=lambda d: d[2] * d[3]) if docs else None
    return _dedupe(out), doc, ""


def _dedupe(marks):
    """One mark per target: a control nested in a same-sized control (a button in a button) is one thing."""
    kept = []
    for m in marks:  # walk order: inner marks come after their outer ones
        box = (m["x"], m["y"], m["w"], m["h"])
        for i, k in enumerate(kept):
            kbox = (k["x"], k["y"], k["w"], k["h"])
            inter = _overlap(box, kbox)
            if inter and inter >= 0.8 * max(m["w"] * m["h"], k["w"] * k["h"]):
                kept[i] = {**m, "name": m["name"] or k["name"]}  # keep the inner one, and a name
                break
        else:
            kept.append(m)
    return kept


# The agent's own browser can also be asked through DevTools for one thing the
# accessibility tree can't know: elements that look clickable (cursor: pointer)
# because a framework handles their clicks somewhere up the page.
POINTER_JS = r"""
(() => {
  const known = 'a[href],button,input,select,textarea,summary,label,[role],[onclick],[tabindex],[contenteditable]';
  const vw = innerWidth, vh = innerHeight, out = [];
  let seen = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (++seen > 6000) break;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue; // outermost only
    if (el.matches(known) || el.closest(known)) continue; // accessibility already sees these
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const hit = document.elementFromPoint(Math.min(vw - 1, r.left + r.width / 2), Math.min(vh - 1, r.top + r.height / 2));
    if (hit && hit !== el && !el.contains(hit)) continue; // covered
    out.push({ name: (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
               x: r.left, y: r.top, w: r.width, h: r.height });
    if (out.length >= 60) break;
  }
  return { marks: out, dpr: devicePixelRatio };
})()
"""


def cdp_eval(expression, title):
    import websocket  # python3-websocket

    with urllib.request.urlopen(f"{CDP}/json", timeout=2) as r:
        pages = [t for t in json.load(r) if t.get("type") == "page" and t.get("title") == title]
    if not pages:
        return None
    ws = websocket.create_connection(pages[0]["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)
    try:
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                res = msg.get("result", {})
                if "exceptionDetails" in res:
                    raise ToolError("page script failed: " + json.dumps(res["exceptionDetails"])[:300])
                return res.get("result", {}).get("value")
    finally:
        ws.close()


def pointer_marks(win, doc, marks):
    """Pointer-cursor elements the accessibility tree missed, placed inside the page's viewport."""
    dx, dy, _, _, title = doc
    page = cdp_eval(POINTER_JS, title)
    if not page:
        return []
    s = page["dpr"]
    extra = []
    for m in page["marks"]:
        x, y = round(dx - win["x"] + m["x"] * s), round(dy - win["y"] + m["y"] * s)
        w, h = round(m["w"] * s), round(m["h"] * s)
        cx, cy = x + w // 2, y + h // 2
        if any(o["x"] <= cx <= o["x"] + o["w"] and o["y"] <= cy <= o["y"] + o["h"] for o in marks):
            continue
        extra.append({"kind": "clickable", "name": m["name"], "x": x, "y": y, "w": w, "h": h})
    return extra


def is_browser(win):
    return win["app"].lower() == "helium"


def chromium_based(argv0):
    """Chromium and Electron apps hide their page content from accessibility without a switch."""
    path = shutil.which(os.path.expanduser(argv0), path=os.environ.get("PATH")) if "/" not in argv0 else os.path.join(HOME, os.path.expanduser(argv0))
    if not path or not os.path.exists(path):
        return False
    real = os.path.dirname(os.path.realpath(path))
    return any(os.path.exists(os.path.join(d, f)) for d in (real, os.path.dirname(real)) for f in ("resources.pak", "v8_context_snapshot.bin"))


def draw_marks(img, marks):
    out = img.copy()
    dr = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    palette = [(230, 57, 70), (29, 120, 220), (34, 150, 80), (200, 110, 0), (140, 60, 200)]
    for i, m in enumerate(marks):
        c = palette[i % len(palette)]
        x, y, w, h = m["x"], m["y"], m["w"], m["h"]
        dr.rectangle([x, y, x + w, y + h], outline=c, width=2)
        label = str(i + 1)
        tw = dr.textlength(label, font=font)
        lx, ly = max(0, x - 1), max(0, y - 16) if y >= 16 else y
        dr.rectangle([lx, ly, lx + tw + 6, ly + 16], fill=c)
        dr.text((lx + 3, ly + 1), label, fill=(255, 255, 255), font=font)
    return out


def png_b64(img, max_side=1280):
    if max(img.size) > max_side:
        img = img.copy()
        img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------- input

def xdo(*args):
    r = subprocess.run(["xdotool", *args], capture_output=True, text=True, timeout=20, env={**os.environ, "DISPLAY": DISPLAY})
    if r.returncode != 0:
        raise ToolError(f"xdotool {args[0]} failed: {r.stderr.strip()[:300]}")


def target_point(win, args):
    if "mark" in args:
        ms = marks_by_window.get(win["id"])
        if not ms:
            raise ToolError("look at the window first so its marks are fresh")
        n = int(args["mark"])
        if not 1 <= n <= len(ms):
            raise ToolError(f"mark {n} doesn't exist; the last look had {len(ms)}")
        m = ms[n - 1]
        return win["x"] + m["x"] + m["w"] // 2, win["y"] + m["y"] + m["h"] // 2
    if "x" in args and "y" in args:
        return win["x"] + int(args["x"]), win["y"] + int(args["y"])
    raise ToolError("give a mark number, or x and y inside the window")


# ---------------------------------------------------------------- tools

class ToolError(Exception):
    pass


def t_windows(args):
    ws = list_windows()
    if not ws:
        return {"text": "No windows are open."}
    lines = [f'{w["id"]}: {w["title"] or "(untitled)"} [{w["app"]}] at {w["x"]},{w["y"]} size {w["width"]}x{w["height"]}' for w in ws]
    return {"text": "\n".join(lines)}


def t_look(args):
    win = find_window(int(args["window"]))
    raise_window(win["id"])
    time.sleep(0.15)
    win = find_window(win["id"])
    rect = view_rect(win)
    img = capture(rect)
    try:
        marks, doc, note = atspi_marks(win, rect)
    except Exception as e:  # noqa: BLE001 - marks are an aid; the screenshot still stands
        marks, doc, note = [], None, f"marks unavailable ({type(e).__name__}: {e}); zoom in and use coordinates"
    if doc and is_browser(win):
        try:
            marks += pointer_marks(win, doc, marks)
        except Exception as e:  # noqa: BLE001 - the accessibility marks still stand
            note = (note + "\n" if note else "") + f"page-only clickables unavailable ({type(e).__name__})"
    marks = sorted(marks, key=lambda m: (m["y"] // 12, m["x"]))[:MAX_MARKS]
    with lock:
        marks_by_window[win["id"]] = marks
    listing = "\n".join(f'{i + 1}. {m["kind"]} "{m["name"]}"' if m["name"] else f'{i + 1}. {m["kind"]}' for i, m in enumerate(marks))
    head = f'Window {win["id"]} "{win["title"]}" ({win["width"]}x{win["height"]} px; x/y coordinates are pixels from its top-left).'
    if (rect[2], rect[3]) != (win["width"], win["height"]):
        head += f" A menu or popup reaches past it, so the screenshot is {rect[2]}x{rect[3]}."
    if note:
        head += f"\n{note}"
    return {"text": head + ("\nMarks:\n" + listing if marks else "\nNo marks."), "image": png_b64(draw_marks(img, marks))}


ZOOM_MAX = 6
GRID_STEPS = (2, 5, 10, 20, 25, 50, 100, 200)


def t_zoom(args):
    """A region of a window, enlarged, with a grid labelled in window coordinates."""
    win = find_window(int(args["window"]))
    raise_window(win["id"])
    time.sleep(0.15)
    win = find_window(win["id"])
    img = capture(view_rect(win))
    x, y = max(0, int(args["x"])), max(0, int(args["y"]))
    w, h = min(int(args["width"]), img.width - x), min(int(args["height"]), img.height - y)
    if w < 8 or h < 8:
        raise ToolError(f"that region is outside the window ({win['width']}x{win['height']})")
    scale = max(1.0, min(ZOOM_MAX, 1280 / max(w, h)))
    out = img.crop((x, y, x + w, y + h)).resize((round(w * scale), round(h * scale)), Image.LANCZOS).convert("RGBA")
    grid = Image.new("RGBA", out.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(grid)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    except OSError:
        font = ImageFont.load_default()
    step = next((s for s in GRID_STEPS if s * scale >= 60), GRID_STEPS[-1])
    for gx in range(-(-x // step) * step, x + w, step):
        px = round((gx - x) * scale)
        dr.line([(px, 0), (px, out.height)], fill=(255, 0, 140, 110), width=1)
        if px < 30:
            continue  # the corner belongs to the y labels
        dr.rectangle([px + 1, 0, px + 1 + dr.textlength(str(gx), font=font) + 4, 14], fill=(255, 255, 255, 210))
        dr.text((px + 3, 0), str(gx), fill=(200, 0, 110, 255), font=font)
    for gy in range(-(-y // step) * step, y + h, step):
        py = round((gy - y) * scale)
        dr.line([(0, py), (out.width, py)], fill=(255, 0, 140, 110), width=1)
        dr.rectangle([0, py + 1, dr.textlength(str(gy), font=font) + 4, py + 15], fill=(255, 255, 255, 210))
        dr.text((2, py + 1), str(gy), fill=(200, 0, 110, 255), font=font)
    # the latest look's marks keep their numbers here, so either way of clicking works
    for i, m in enumerate(marks_by_window.get(win["id"], [])):
        if _overlap((m["x"], m["y"], m["w"], m["h"]), (x, y, w, h)) == 0:
            continue
        bx, by = (m["x"] - x) * scale, (m["y"] - y) * scale
        dr.rectangle([bx, by, bx + m["w"] * scale, by + m["h"] * scale], outline=(29, 120, 220, 230), width=2)
        dr.rectangle([bx, by, bx + dr.textlength(str(i + 1), font=font) + 6, by + 15], fill=(29, 120, 220, 230))
        dr.text((bx + 3, by + 1), str(i + 1), fill=(255, 255, 255, 255), font=font)
    out = Image.alpha_composite(out, grid).convert("RGB")
    return {"text": f"Region {x},{y} to {x + w},{y + h} of window {win['id']}, enlarged {scale:.1f}x. "
                    f"Grid lines every {step} px are labelled in window coordinates: click with those x/y.",
            "image": png_b64(out)}


def window_changes(before):
    """What opened or closed since `before` (a dialog, a menu window, a crash)."""
    now = {w["id"]: w for w in list_windows()}
    notes = [f'Window {w["id"]} "{w["title"]}" opened.' for wid, w in now.items() if wid not in before]
    notes += [f"Window {wid} closed." for wid in before if wid not in now]
    return (" " + " ".join(notes)) if notes else ""


def window_ids():
    return {w["id"] for w in list_windows()}


def t_click(args):
    win = find_window(int(args["window"]))
    before = window_ids()
    raise_window(win["id"])
    x, y = target_point(win, args)
    button = {"left": "1", "middle": "2", "right": "3"}[args.get("button", "left")]
    xdo("mousemove", "--sync", str(x), str(y))
    xdo("click", "--repeat", "2" if args.get("double") else "1", button)
    time.sleep(0.4)
    return {"text": f"Clicked at {x - win['x']},{y - win['y']} in window {win['id']}." + window_changes(before)}


def t_hover(args):
    win = find_window(int(args["window"]))
    raise_window(win["id"])
    x, y = target_point(win, args)
    xdo("mousemove", "--sync", str(x), str(y))
    time.sleep(0.6)
    return {"text": f"Pointer resting at {x - win['x']},{y - win['y']}."}


def t_drag(args):
    win = find_window(int(args["window"]))
    before = window_ids()
    raise_window(win["id"])
    x1, y1 = target_point(win, args)
    to = {"mark": args["to_mark"]} if "to_mark" in args else {"x": args.get("to_x"), "y": args.get("to_y")}
    if "mark" not in to and (to["x"] is None or to["y"] is None):
        raise ToolError("give to_mark, or to_x and to_y")
    x2, y2 = target_point(win, to)
    xdo("mousemove", "--sync", str(x1), str(y1))
    xdo("mousedown", "1")
    try:
        for i in range(1, 11):  # in steps, so apps see a drag rather than a jump
            xdo("mousemove", "--sync", str(x1 + (x2 - x1) * i // 10), str(y1 + (y2 - y1) * i // 10))
            time.sleep(0.02)
    finally:
        xdo("mouseup", "1")
    time.sleep(0.3)
    return {"text": f"Dragged from {x1 - win['x']},{y1 - win['y']} to {x2 - win['x']},{y2 - win['y']}." + window_changes(before)}


def t_type(args):
    before = window_ids()
    if "window" in args:
        raise_window(int(args["window"]))
    xdo("type", "--delay", "8", "--", str(args["text"]))
    if args.get("enter"):
        xdo("key", "Return")
    time.sleep(0.3)
    return {"text": "Typed." + window_changes(before)}


def t_key(args):
    before = window_ids()
    if "window" in args:
        raise_window(int(args["window"]))
    keys = str(args["keys"]).split()
    xdo("key", "--", *keys)
    time.sleep(0.3)
    return {"text": f"Pressed {' '.join(keys)}." + window_changes(before)}


def t_scroll(args):
    win = find_window(int(args["window"]))
    raise_window(win["id"])
    if "mark" in args or "x" in args:
        x, y = target_point(win, args)
    else:
        x, y = win["x"] + win["width"] // 2, win["y"] + win["height"] // 2
    amount = int(args.get("amount", 5))
    xdo("mousemove", "--sync", str(x), str(y))
    xdo("click", "--repeat", str(abs(amount)), "--delay", "30", "5" if amount > 0 else "4")
    time.sleep(0.3)
    return {"text": f"Scrolled {'down' if amount > 0 else 'up'} {abs(amount)}."}


def t_place(args):
    wid = int(args["window"])
    find_window(wid)
    d = xd()
    try:
        w = d.create_resource_object("window", wid)
        kw = {k: int(args[k]) for k in ("x", "y", "width", "height") if k in args}
        w.configure(**kw)
        d.sync()
    finally:
        d.close()
    time.sleep(0.3)
    return {"text": "Moved." if kw else "Nothing to change."}


def t_close(args):
    xdo("windowclose", str(int(args["window"])))
    return {"text": "Closed."}


BROWSER_PROFILE = os.path.expanduser("~/.config/helium-agent")


def seed_browser_profile():
    """Skip Helium's first-run setup page: the agent's browser starts ready to use.

    Helium records a finished setup in the profile pref helium.completed_onboarding;
    --no-first-run covers Chromium's own first-run flow.
    """
    prefs = os.path.join(BROWSER_PROFILE, "Default", "Preferences")
    if os.path.exists(prefs):
        return
    os.makedirs(os.path.dirname(prefs), exist_ok=True)
    with open(prefs, "w") as f:
        json.dump({"helium": {"completed_onboarding": True}, "browser": {"has_seen_welcome_page": True}}, f)


def t_open(args):
    what = str(args["what"]).strip()
    if what.startswith(("http://", "https://", "file://")) or what in ("browser", "helium"):
        url = what if "://" in what else "about:blank"
        seed_browser_profile()
        argv = [HELIUM, f"--user-data-dir={BROWSER_PROFILE}", "--remote-debugging-port=9222", "--remote-allow-origins=http://127.0.0.1:9222",
                "--no-first-run", "--no-default-browser-check", "--disable-features=Translate",
                "--force-renderer-accessibility", "--hide-crash-restore-bubble",
                "--window-position=0,0", "--window-size=1280,800", url]
    else:
        argv = shlex.split(what)
        if not argv:
            raise ToolError("say what to open")
        if chromium_based(argv[0]) and "--force-renderer-accessibility" not in argv:
            argv.insert(1, "--force-renderer-accessibility")
    before = window_ids()
    subprocess.Popen(argv, cwd=HOME, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        time.sleep(0.25)
        new = [w for w in list_windows() if w["id"] not in before]
        if new:
            time.sleep(0.8)
            return {"text": "Opened window " + ", ".join(f'{w["id"]} "{w["title"]}"' for w in new) + "."}
    return {"text": "Started it, but no new window appeared within 15 s (it may reuse an existing window, or it isn't a windowed app)."}


def t_shell(args):
    cmd = str(args["command"])
    timeout = min(int(args.get("timeout", 60)), SHELL_TIMEOUT_MAX)
    try:
        r = subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True, timeout=timeout,
                           cwd=HOME)
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        return {"text": f"Timed out after {timeout}s.\n{out[-OUTPUT_MAX:]}"}
    out = (r.stdout + ("\n[stderr]\n" + r.stderr if r.stderr.strip() else ""))
    if len(out) > OUTPUT_MAX:
        out = out[:OUTPUT_MAX // 2] + f"\n… {len(out) - OUTPUT_MAX} characters cut …\n" + out[-OUTPUT_MAX // 2:]
    return {"text": f"exit {r.returncode}\n{out}"}


TOOLS = {
    "windows": t_windows, "look": t_look, "click": t_click, "type": t_type, "key": t_key,
    "scroll": t_scroll, "place": t_place, "close": t_close, "open": t_open, "shell": t_shell,
    "zoom": t_zoom, "hover": t_hover, "drag": t_drag,
}


# ---------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self.reply(401, {"error": "unauthorized"})
        if self.path == "/health":
            return self.reply(200, {"ok": True, "windows": len(list_windows())})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self.reply(401, {"error": "unauthorized"})
        if self.path != "/call":
            return self.reply(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self.reply(413, {"error": "request too large"})
        try:
            req = json.loads(self.rfile.read(n))
            fn = TOOLS[req["tool"]]
        except (ValueError, KeyError) as e:
            return self.reply(400, {"error": f"bad request: {e}"})
        try:
            self.reply(200, fn(req.get("args") or {}))
        except (ToolError, KeyError, ValueError) as e:
            self.reply(200, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 - reported to the caller as a failed tool call
            self.reply(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *a):
        sys.stderr.write("agent: " + fmt % a + "\n")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
