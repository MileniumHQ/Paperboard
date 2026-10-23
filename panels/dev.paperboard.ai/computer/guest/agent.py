#!/usr/bin/env python3
"""The agent's hands inside its own computer.

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
import hashlib
import io
import json
import os
import re
import select
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFont
from Xlib import X, display as xdisplay
from Xlib.ext import composite
from Xlib.error import ConnectionClosedError, DisplayError, XError

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
# after the command itself exits, how long its output still has to arrive
SHELL_DRAIN_SECONDS = 0.5
SCROLL_MAX = 50
SIZE_MAX = 8192
MAX_MARKS = 120
MAX_BODY = 1 << 20


def _version():
    # the service compares this with its own copy of these files and replaces them when they differ
    here = os.path.dirname(os.path.abspath(__file__))
    h = hashlib.sha256()
    for name in ("agent.py", "session.sh"):
        with open(os.path.join(here, name), "rb") as f:
            h.update(hashlib.sha256(f.read()).digest())
    return h.hexdigest()


VERSION = _version()

# the last marks shown for each window, so "click mark 7" means what the agent saw
marks_by_window: dict[int, list[dict]] = {}
# and the web page each look found in it (screen x, y, w, h, title), for the browser's DevTools
docs_by_window: dict[int, tuple | None] = {}
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
    """Bring a window to the front and give it the keyboard.

    A window already on top isn't restacked (that would bury its open menus),
    but it still gets focus: with no window manager, focus stays wherever it
    was last put, so keys would otherwise go to the previous window."""
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
        w = d.create_resource_object("window", wid)
        if top != wid:
            w.configure(stack_mode=X.Above)
        if d.get_input_focus().focus != w:
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


def cdp_pages(title):
    with urllib.request.urlopen(f"{CDP}/json", timeout=2) as r:
        return [t for t in json.load(r) if t.get("type") == "page" and t.get("title") == title]


def cdp_open(page):
    import websocket  # python3-websocket

    return websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)


def cdp_send(ws, n, method, params):
    """One DevTools command on an open page connection; its result. Errors never quote the params."""
    ws.send(json.dumps({"id": n, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == n:
            if "error" in msg:
                raise ToolError(f"{method} failed: {str(msg['error'].get('message', ''))[:200]}")
            return msg.get("result", {})


def cdp_value(ws, n, expression):
    res = cdp_send(ws, n, "Runtime.evaluate", {"expression": expression, "returnByValue": True})
    if "exceptionDetails" in res:
        raise ToolError("page script failed: " + json.dumps(res["exceptionDetails"])[:300])
    return res.get("result", {}).get("value")


def cdp_eval(expression, title):
    pages = cdp_pages(title)
    if not pages:
        return None
    ws = cdp_open(pages[0])
    try:
        return cdp_value(ws, 1, expression)
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


def draw_marks(img, marks, labels=None):
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
        label = labels[i] if labels else str(i + 1)
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
    open_ids = window_ids()
    with lock:
        # one entry per open window: a closed window's marks go with it
        for gone in [k for k in marks_by_window if k not in open_ids]:
            del marks_by_window[gone]
        for gone in [k for k in docs_by_window if k not in open_ids]:
            del docs_by_window[gone]
        marks_by_window[win["id"]] = marks
        docs_by_window[win["id"]] = doc
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
    if not amount or abs(amount) > SCROLL_MAX:
        raise ToolError(f"amount is 1 to {SCROLL_MAX} steps, negative to scroll up")
    xdo("mousemove", "--sync", str(x), str(y))
    xdo("click", "--repeat", str(abs(amount)), "--delay", "30", "5" if amount > 0 else "4")
    time.sleep(0.3)
    return {"text": f"Scrolled {'down' if amount > 0 else 'up'} {abs(amount)}."}


def t_place(args):
    wid = int(args["window"])
    kw = {k: int(args[k]) for k in ("x", "y", "width", "height") if k in args}
    if any(not 1 <= kw[k] <= SIZE_MAX for k in ("width", "height") if k in kw) or any(abs(kw[k]) > SIZE_MAX for k in ("x", "y") if k in kw):
        raise ToolError(f"sizes are 1 to {SIZE_MAX} px, and positions within {SIZE_MAX} px of the screen")
    find_window(wid)
    d = xd()
    try:
        w = d.create_resource_object("window", wid)
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


class Capped:
    """A stream's output, keeping its start and its end: memory stays bounded however much it writes."""

    def __init__(self, keep):
        self.keep = keep
        self.head, self.tail, self.total = bytearray(), bytearray(), 0

    def add(self, chunk):
        self.total += len(chunk)
        room = self.keep - len(self.head)
        if room > 0:
            self.head += chunk[:room]
            chunk = chunk[room:]
        if chunk:
            self.tail = (self.tail + chunk)[-self.keep:]

    def text(self):
        cut = self.total - len(self.head) - len(self.tail)
        out = self.head.decode("utf-8", "replace")
        if cut > 0:
            out += f"\n… {cut} bytes cut …\n"
        return out + self.tail.decode("utf-8", "replace")


def t_shell(args):
    """Run a command; its result once bash itself exits.

    Background jobs it started keep running, as in a terminal, but the call
    doesn't wait for them: one still holding the output is cut off from it
    once bash has exited. On timeout the command's whole process group is
    stopped, background jobs with it."""
    cmd = str(args["command"])
    timeout = max(1, min(int(args.get("timeout", 60)), SHELL_TIMEOUT_MAX))
    proc = subprocess.Popen(["bash", "-lc", cmd], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            cwd=HOME, start_new_session=True)
    streams = {proc.stdout.fileno(): Capped(OUTPUT_MAX // 2), proc.stderr.fileno(): Capped(OUTPUT_MAX // 4)}
    out, err = streams.values()
    open_fds = set(streams)
    deadline = time.monotonic() + timeout
    drain_until = None  # set once bash exits: what's already written still arrives
    timed_out = False
    try:
        while open_fds:
            now = time.monotonic()
            if drain_until is None and proc.poll() is not None:
                drain_until = now + SHELL_DRAIN_SECONDS
            if drain_until is not None and now >= drain_until:
                break
            if drain_until is None and now >= deadline:
                timed_out = True
                break
            ready, _, _ = select.select(list(open_fds), [], [], min(0.1, (drain_until or deadline) - now))
            for fd in ready:
                chunk = os.read(fd, 65536)
                if chunk:
                    streams[fd].add(chunk)
                else:
                    open_fds.discard(fd)
        if timed_out:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass  # it exited just now
        proc.wait()
    finally:
        proc.stdout.close()
        proc.stderr.close()
    text = out.text()
    if err.total:
        text += "\n[stderr]\n" + err.text()
    if timed_out:
        return {"text": f"Timed out after {timeout}s; it was stopped.\n{text}"}
    if open_fds:
        text += "\n[a background job still held the output; it keeps running, but its later output isn't shown. Redirect it to a file to keep it.]"
    return {"text": f"exit {proc.returncode}\n{text}"}


# ---------------------------------------------------------------- tool servers (MCP over stdio)
#
# The user can have MCP servers run in this computer. The service speaks
# JSON-RPC to them through this relay: it starts one by argv, writes the
# service's messages to its stdin one per line, and hands back the answer to
# each request. Servers are bounded (count, line size, waiting requests,
# time) and stop when asked, with the whole process group.

MCP_MAX_SERVERS = 8
MCP_MAX_LINE = 4 << 20
MCP_MAX_WAITING = 32
MCP_STDERR_KEEP = 4000
MCP_RPC_TIMEOUT_MAX = 600
MCP_ID = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
MCP_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


class McpServer:
    def __init__(self, argv, env):
        # bash -l so a program is found where the agent installed it; argv is passed as arguments, never as a command line
        self.proc = subprocess.Popen(
            ["bash", "-lc", 'exec "$0" "$@"', *argv],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, **env}, cwd=HOME, start_new_session=True,
        )
        self.cond = threading.Condition()
        self.wlock = threading.Lock()
        self.waiting = set()
        self.replies = {}
        self.next_id = 1
        self.stderr = ""
        threading.Thread(target=self._read_out, daemon=True).start()
        threading.Thread(target=self._read_err, daemon=True).start()

    def _read_out(self):
        for raw in iter(lambda: self.proc.stdout.readline(MCP_MAX_LINE + 1), b""):
            if len(raw) > MCP_MAX_LINE and not raw.endswith(b"\n"):
                self.stderr = "a message was past the size limit"
                self.kill()
                break
            try:
                msg = json.loads(raw)
            except ValueError:
                continue  # a server logging to stdout is not a message
            if not isinstance(msg, dict) or "method" in msg or "id" not in msg:
                continue  # we offer no capabilities: nothing it asks of us is answered
            with self.cond:
                if msg["id"] in self.waiting:
                    self.replies[msg["id"]] = msg
                    self.cond.notify_all()
        with self.cond:
            self.cond.notify_all()

    def _read_err(self):
        for raw in iter(lambda: self.proc.stderr.read1(4096), b""):
            self.stderr = (self.stderr + raw.decode("utf-8", "replace"))[-MCP_STDERR_KEEP:]

    def running(self):
        return self.proc.poll() is None

    def _gone(self):
        tail = " | ".join(self.stderr.strip().splitlines()[-3:])
        return ToolError(f"the server isn't running (exit {self.proc.poll()})" + (f": {tail}" if tail else ""))

    def _write(self, msg):
        line = json.dumps(msg).encode() + b"\n"
        if len(line) > MCP_MAX_LINE:
            raise ToolError("that message is too large")
        with self.wlock:
            try:
                self.proc.stdin.write(line)
                self.proc.stdin.flush()
            except (BrokenPipeError, ValueError, OSError):
                raise self._gone()

    def rpc(self, msg, timeout):
        if not self.running():
            raise self._gone()
        if "id" not in msg:
            self._write(msg)
            return {}
        # the service numbers its requests from 1 on every connection: ours are unique for this server
        with self.cond:
            if len(self.waiting) >= MCP_MAX_WAITING:
                raise ToolError("too many requests are waiting on this server")
            rid = self.next_id
            self.next_id += 1
            self.waiting.add(rid)
        try:
            self._write({**msg, "id": rid})
            with self.cond:
                self.cond.wait_for(lambda: rid in self.replies or not self.running(), timeout)
                reply = self.replies.pop(rid, None)
            if reply is None:
                if not self.running():
                    raise self._gone()
                raise ToolError(f"the server didn't answer within {timeout:g} s")
            return {**reply, "id": msg["id"]}
        finally:
            with self.cond:
                self.waiting.discard(rid)
                self.replies.pop(rid, None)

    def kill(self):
        try:
            os.killpg(self.proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass  # already gone

    def stop(self):
        """Stop it and its children, and return its exit code once it has gone."""
        if self.running():
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass  # exited on its own just now
            try:
                self.proc.wait(2)
            except subprocess.TimeoutExpired:
                self.kill()
                self.proc.wait(5)
        else:
            self.kill()  # its children may outlive it
        return self.proc.returncode


mcp_servers = {}
mcp_lock = threading.Lock()


def _mcp_id(args):
    sid = args.get("id")
    if not isinstance(sid, str) or not MCP_ID.match(sid):
        raise ToolError("a server's id is lowercase letters, digits and dashes")
    return sid


def t_mcp_start(args):
    sid = _mcp_id(args)
    argv = args.get("argv")
    if not isinstance(argv, list) or not 1 <= len(argv) <= 33 or not all(isinstance(a, str) and len(a) <= 4096 and "\0" not in a for a in argv):
        raise ToolError("argv is a list of up to 33 strings")
    if not argv[0] or argv[0].startswith("-"):
        raise ToolError("the first item is the program")
    env = args.get("env") or {}
    if not isinstance(env, dict) or len(env) > 32 or not all(
            isinstance(k, str) and MCP_ENV_NAME.match(k) and isinstance(v, str) and len(v) <= 8192 and "\0" not in v for k, v in env.items()):
        raise ToolError("env is up to 32 names with text values")
    with mcp_lock:
        old = mcp_servers.pop(sid, None)
    if old:
        old.stop()  # a fresh start is a fresh server: it must be initialized again
    with mcp_lock:
        if len(mcp_servers) >= MCP_MAX_SERVERS:
            raise ToolError(f"at most {MCP_MAX_SERVERS} tool servers can run in this computer")
        try:
            mcp_servers[sid] = McpServer(argv, env)
        except OSError as e:
            raise ToolError(f"couldn't start it: {e}")
    return {"text": "started"}


def t_mcp_rpc(args):
    sid = _mcp_id(args)
    msg = args.get("message")
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        raise ToolError("message is a JSON-RPC request or notification")
    try:
        timeout = min(max(float(args.get("timeout", 30)), 1.0), MCP_RPC_TIMEOUT_MAX)
    except (TypeError, ValueError):
        raise ToolError("timeout is a number of seconds")
    with mcp_lock:
        server = mcp_servers.get(sid)
    if server is None:
        raise ToolError("no such server")
    return {"text": json.dumps(server.rpc(msg, timeout))}


def t_mcp_stop(args):
    sid = _mcp_id(args)
    with mcp_lock:
        server = mcp_servers.pop(sid, None)
    if server is None:
        return {"text": "wasn't running"}
    return {"text": f"stopped (exit {server.stop()})"}


def t_mcp_status(args):
    with mcp_lock:
        return {"text": json.dumps({sid: {"running": s.running(), "stderr": s.stderr[-500:]} for sid, s in mcp_servers.items()})}


# ---------------------------------------------------------------- the user's view
#
# The panel shows each window in a tab the user can watch and drive. These
# are the user's tools, not the agent's: the service never offers them over
# MCP. Frames come from X Composite, so a window reads right even while
# another one covers it; the redirect lasts as long as the connection that
# asked for it, so one connection is kept for the life of the agent.

VIEW_MAX_EVENTS = 64
VIEW_MAX_TEXT = 2000
VIEW_BUTTONS = {1, 2, 3}
view_lock = threading.Lock()
view_display = None


def _view():
    global view_display
    if view_display is None:
        d = xd()
        if not d.has_extension("Composite"):
            d.close()
            raise ToolError("this display can't show windows on their own (no Composite extension)")
        # automatic, not manual: the server still draws the screen, so look and capture see the windows
        d.screen().root.composite_redirect_subwindows(composite.RedirectAutomatic)
        d.sync()
        view_display = d
    return view_display


def _drop_view():
    global view_display
    if view_display is not None:
        try:
            view_display.close()
        except Exception as e:  # noqa: BLE001 - a dead connection is what's being dropped
            sys.stderr.write(f"agent: closing the view connection: {e}\n")
    view_display = None


def _window_image(d, w):
    g = w.get_geometry()
    pix = w.composite_name_window_pixmap()
    try:
        raw = pix.get_image(0, 0, g.width, g.height, X.ZPixmap, 0xFFFFFFFF)
    finally:
        pix.free()
    return g, Image.frombytes("RGB", (g.width, g.height), raw.data, "raw", "BGRX")


def t_view_windows(args):
    return {"windows": [{k: w[k] for k in ("id", "title", "app", "width", "height")} for w in list_windows()]}


def t_view_frame(args):
    """One window as the user sees it, its open menus drawn over it. Unchanged since `since`: just says so."""
    wid = int(args["window"])
    if wid not in window_ids():
        raise ToolError("that window is closed")
    quality = max(30, min(90, int(args.get("quality", 72))))
    with view_lock:
        try:
            d = _view()
            g, img = _window_image(d, d.create_resource_object("window", wid))
            for c in d.screen().root.query_tree().children:  # bottom to top
                try:
                    a, cg = c.get_attributes(), c.get_geometry()
                    if a.map_state != X.IsViewable or not a.override_redirect:
                        continue
                    if cg.x >= g.x + g.width or cg.y >= g.y + g.height or cg.x + cg.width <= g.x or cg.y + cg.height <= g.y:
                        continue
                    _, pop = _window_image(d, c)
                except XError:
                    continue  # a menu that closed while it was being read
                img.paste(pop, (cg.x - g.x, cg.y - g.y))
        except (XError, ConnectionClosedError) as e:
            _drop_view()  # the next frame reconnects (and redirects again, after an X restart)
            raise ToolError(f"couldn't read the window: {e}")
    digest = hashlib.blake2b(img.tobytes(), digest_size=12).hexdigest()
    if args.get("since") == digest:
        return {"same": True, "hash": digest}
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return {"frame": base64.b64encode(buf.getvalue()).decode(), "hash": digest, "width": g.width, "height": g.height}


def _view_point(win, e):
    x, y = int(e["x"]), int(e["y"])
    if not (0 <= x < win["width"] and 0 <= y < win["height"]):
        raise ToolError("that point is outside the window")
    return str(win["x"] + x), str(win["y"] + y)


def t_view_input(args):
    """The user's mouse and keys, replayed into one window (raised first so they land there)."""
    win = find_window(int(args["window"]))
    events = args.get("events") or []
    if not isinstance(events, list) or len(events) > VIEW_MAX_EVENTS:
        raise ToolError(f"send at most {VIEW_MAX_EVENTS} events at a time")
    raise_window(win["id"])
    for e in events:
        kind = e.get("type")
        if kind == "move":
            xdo("mousemove", *_view_point(win, e))
        elif kind in ("down", "up"):
            button = int(e.get("button", 1))
            if button not in VIEW_BUTTONS:
                raise ToolError("unknown mouse button")
            if "x" in e:
                xdo("mousemove", *_view_point(win, e))
            xdo("mousedown" if kind == "down" else "mouseup", str(button))
        elif kind == "scroll":
            xdo("mousemove", *_view_point(win, e))
            dy, dx = int(e.get("dy", 0)), int(e.get("dx", 0))
            for n, (neg, pos) in ((dy, ("4", "5")), (dx, ("6", "7"))):
                if n:
                    xdo("click", "--repeat", str(min(abs(n), 20)), pos if n > 0 else neg)
        elif kind == "key":
            keys = str(e.get("keys", ""))
            if not keys or len(keys) > 64 or not all(ch.isalnum() or ch in "_+" for ch in keys):
                raise ToolError("keys look like ctrl+shift+t")
            xdo("key", "--clearmodifiers", "--", keys)
        elif kind == "text":
            text = str(e.get("text", ""))
            if len(text) > VIEW_MAX_TEXT:
                raise ToolError(f"type at most {VIEW_MAX_TEXT} characters at a time")
            if text:
                xdo("type", "--delay", "0", "--", text)
        else:
            raise ToolError(f"unknown input {kind!r}")
    return {"ok": True}


def t_view_close(args):
    return t_close(args)


# ---------------------------------------------------------------- sign-in
# The agent points at a page's sign-in fields and its submit button, and the
# user types the values into the panel. They never reach the agent: the
# service hands them to view_sign_in, which types them in through the
# browser's DevTools (never a command line) and presses submit. One request
# waits at a time, and it can be used once.

SIGN_IN_FIELD_KINDS = {"entry", "text", "password text"}
SIGN_IN_MAX_FIELDS = 4
SIGN_IN_MAX_VALUE = 1000
SIGN_IN_ID = re.compile(r"^[a-z0-9]{6,32}$")
EDITABLE_JS = r"""
(() => {
  const e = document.activeElement;
  const editable = !!e && !e.disabled && !e.readOnly && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable);
  if (editable && e.select) e.select();  // typing replaces what's there
  return [location.protocol + '//' + location.hostname, editable];
})()
"""
sign_in_pending = None


def site_of(url):
    """What the user is told they're signing in to: the host, with the scheme only when it isn't https."""
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("https", "http") or not u.hostname:
        raise ToolError("that page isn't a website")
    return u.hostname if u.scheme == "https" else f"http://{u.hostname}"


def sign_in_page(title):
    pages = cdp_pages(title)
    if not pages:
        raise ToolError("that page isn't open anymore")
    if len({p.get("url") for p in pages}) > 1:
        raise ToolError("two tabs share that page's title; close one and look again")
    return pages[0]


def t_sign_in_prepare(args):
    """Check the agent's picks and remember them; the page's site and a picture of the picks for the user."""
    global sign_in_pending
    rid = str(args.get("id", ""))
    if not SIGN_IN_ID.match(rid):
        raise ToolError("a sign-in id is lowercase letters and digits")
    win = find_window(int(args["window"]))
    if not is_browser(win):
        raise ToolError("sign-in works in your browser (Helium) only")
    with lock:
        ms, doc = marks_by_window.get(win["id"]), docs_by_window.get(win["id"])
    if not ms or not doc:
        raise ToolError("look at the browser window first so its marks are fresh")
    fields = args.get("fields")
    if not isinstance(fields, list) or not 1 <= len(fields) <= SIGN_IN_MAX_FIELDS:
        raise ToolError(f"pick 1 to {SIGN_IN_MAX_FIELDS} fields")

    def mark(n):
        n = int(n)
        if not 1 <= n <= len(ms):
            raise ToolError(f"mark {n} doesn't exist; the last look had {len(ms)}")
        return n, ms[n - 1]

    picked = [mark(n) for n in fields]
    submit_n, submit = mark(args["submit"])
    numbers = [n for n, _ in picked] + [submit_n]
    if len(set(numbers)) != len(numbers):
        raise ToolError("each field, and the submit button, is a different mark")
    for n, m in picked:
        if m["kind"] not in SIGN_IN_FIELD_KINDS:
            raise ToolError(f"mark {n} is a {m['kind']}, not a text field")
    page = sign_in_page(doc[4])
    site = site_of(page.get("url", ""))
    centre = lambda m: (m["x"] + m["w"] // 2, m["y"] + m["h"] // 2)  # noqa: E731
    raise_window(win["id"])
    time.sleep(0.15)
    img = capture(view_rect(find_window(win["id"])))
    boxes = [m for _, m in picked] + [submit]
    labels = [str(i + 1) for i in range(len(picked))] + ["submit"]
    sign_in_pending = {"id": rid, "window": win["id"], "title": doc[4], "site": site,
                       "fields": [centre(m) for _, m in picked], "submit": centre(submit)}
    info = {"site": site, "fields": [{"secret": m["kind"] == "password text"} for _, m in picked]}
    return {"text": json.dumps(info), "image": png_b64(draw_marks(img, boxes, labels))}


def t_view_sign_in(args):
    """The user's values, typed into the fields the waiting request named, then submit pressed."""
    global sign_in_pending
    p = sign_in_pending
    if not p or p["id"] != args.get("id"):
        raise ToolError("that sign-in isn't waiting anymore")
    values = args.get("values")
    if not isinstance(values, list) or len(values) != len(p["fields"]) or not all(isinstance(v, str) and len(v) <= SIGN_IN_MAX_VALUE for v in values):
        raise ToolError(f"one value per field, each at most {SIGN_IN_MAX_VALUE} characters")
    sign_in_pending = None  # used once, whatever happens next
    win = find_window(p["window"])
    page = sign_in_page(p["title"])
    if site_of(page.get("url", "")) != p["site"]:
        raise ToolError(f"the page isn't on {p['site']} anymore")
    ws = cdp_open(page)
    try:
        n = 0
        for i, ((x, y), value) in enumerate(zip(p["fields"], values)):
            raise_window(win["id"])
            xdo("mousemove", "--sync", str(win["x"] + x), str(win["y"] + y))
            xdo("click", "1")
            time.sleep(0.15)
            n += 1
            origin, editable = cdp_value(ws, n, EDITABLE_JS)
            if site_of(origin) != p["site"]:
                raise ToolError(f"the page isn't on {p['site']} anymore")
            if not editable:
                raise ToolError(f"field {i + 1} didn't take the cursor; the page may have changed")
            n += 1
            cdp_send(ws, n, "Input.insertText", {"text": value})
        n += 1
        origin, _ = cdp_value(ws, n, EDITABLE_JS)
        if site_of(origin) != p["site"]:
            raise ToolError(f"the page isn't on {p['site']} anymore")
    finally:
        ws.close()
    sx, sy = p["submit"]
    xdo("mousemove", "--sync", str(win["x"] + sx), str(win["y"] + sy))
    xdo("click", "1")
    return {"ok": True}


TOOLS = {
    "windows": t_windows, "look": t_look, "click": t_click, "type": t_type, "key": t_key,
    "scroll": t_scroll, "place": t_place, "close": t_close, "open": t_open, "shell": t_shell,
    "zoom": t_zoom, "hover": t_hover, "drag": t_drag,
    # the service's half of a sign-in; the agent reaches it only through ask_to_sign_in
    "sign_in_prepare": t_sign_in_prepare,
    # the service's relay to the user's tool servers; never offered to the agent as tools
    "mcp_start": t_mcp_start, "mcp_rpc": t_mcp_rpc, "mcp_stop": t_mcp_stop, "mcp_status": t_mcp_status,
    # the user's, never offered to the agent
    "view_windows": t_view_windows, "view_frame": t_view_frame, "view_input": t_view_input, "view_close": t_view_close,
    "view_sign_in": t_view_sign_in,
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
            return self.reply(200, {"ok": True, "version": VERSION, "windows": len(list_windows())})
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
    # redirect before any window opens, so every window has painted its own pixels by the time the user looks
    try:
        with view_lock:
            _view()
    except (ToolError, XError, DisplayError, OSError) as e:
        sys.stderr.write(f"agent: windows can't be shown on their own yet: {e}\n")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
