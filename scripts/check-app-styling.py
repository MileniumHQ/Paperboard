"""Scan the CSS and TSX paths on stdin for literal styling values. Prints
`file:line: kind: text` per finding. Driven by check-app-styling.sh."""
import re
import sys

UNIT = r"(?<![\w.#-])-?\d*\.?\d+(?:px|rem|em|ms|s)\b"
CSS_RULES = [
    ("size", re.compile(UNIT)),
    ("color", re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")),
    ("easing", re.compile(r"cubic-bezier\(|\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b(?!-)")),
    ("z-index", re.compile(r"\bz-index:\s*-?\d{2,}|\bz-index:\s*[2-9]\b")),
    ("opacity", re.compile(r"(?<![-\w])opacity:\s*0?\.\d+")),
    ("font-weight", re.compile(r"\bfont-weight:\s*\d")),
    ("line-height", re.compile(r"\bline-height:\s*\d")),
    ("scale", re.compile(r"\bscale\(\s*(?!1\s*\)|0\s*\))[\d.]+")),
]
TSX_RULES = [
    ("size", re.compile(r"""["'`][^"'`]*(?<![\w.#-])-?\d*\.?\d+(?:px|rem|em|ms)\b""")),
    ("color", re.compile(r"""["'`]#[0-9a-fA-F]{3,8}["'`]|\brgba?\(|\bhsla?\(""")),
    ("z-index", re.compile(r"""["']?z-?[iI]ndex["']?\s*:\s*\d""")),
    ("opacity", re.compile(r"""\bopacity\s*:\s*["']?0?\.\d""")),
    ("font-weight", re.compile(r"""["']?font-?[wW]eight["']?\s*:\s*["']?\d""")),
    ("line-height", re.compile(r"""["']?line-?[hH]eight["']?\s*:\s*["']?\d""")),
]
# a pixel/em value computed from state (`${x}px`) is layout maths, not a style choice
COMPUTED = re.compile(r"\$\{[^}]*\}(?:px|rem|em)")
CUSTOM_PROP = re.compile(r"^\s*--[\w-]+\s*:")
FALLBACK = re.compile(r"\bgetVar(?:Css)?\(")
OK = "paper-literal-ok"


def is_comment(s):
    t = s.lstrip()
    return t.startswith(("/*", "*", "//"))


def scan(path):
    try:
        text = open(path, encoding="utf-8").read()
    except OSError as err:
        print(f"{path}:0: unreadable: {err}")
        return
    if "paper-literal-ok-file" in text:
        return
    css = path.endswith(".css")
    rules = CSS_RULES if css else TSX_RULES
    lines = text.split("\n")
    in_block = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if in_block:
            if "*/" in stripped:
                in_block = False
            continue
        if stripped.startswith("/*") and "*/" not in stripped:
            in_block = True
            continue
        if is_comment(line) or CUSTOM_PROP.match(line):
            continue
        if OK in line:
            continue
        # a marker comment covers the lines that follow it, up to a blank line
        j = i - 1
        while j >= 0 and lines[j].strip() and OK not in lines[j]:
            j -= 1
        if j >= 0 and OK in lines[j] and is_comment(lines[j]):
            continue
        body = re.sub(r"/\*.*?\*/", "", line)
        if not css:
            if FALLBACK.search(body):
                continue
            body = COMPUTED.sub("", body)
        if css and ("@media" in body or "@container" in body):
            body = re.sub(r"@(media|container)[^{]*", "", body)
        for kind, rx in rules:
            if rx.search(body):
                # 0px and 1px hairlines are not worth a token
                if kind == "size" and not re.search(r"(?<![\w.#-])-?(?:[2-9]|\d{2,}|\d*\.\d*[1-9])\d*(?:\.\d+)?(?:px|rem|em|ms|s)\b|(?<![\w.#-])1(?:\.\d+)(?:px|rem|em|ms|s)\b", body):
                    continue
                print(f"{path}:{i + 1}: {kind}: {stripped[:110]}")
                break


for p in (ln.strip() for ln in sys.stdin):
    if p:
        scan(p)
