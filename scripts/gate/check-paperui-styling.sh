#!/usr/bin/env bash
# PaperUI styling invariant gate:
#   (a) no hardcoded hex colors outside the token definition file —
#       styling must use --paper-* tokens from PaperUI
#   (b) no global selectors escaping .paperui-root: bare `* {` / `*,` and
#       top-level `:global(` with no local selector anchoring it
#   (c) no literal px/rem/em in component CSS: sizes are tokens, and the
#       token files (src/styles/*.css) are the only place literals live.
#       An @container or @media condition is the exception: a query cannot
#       read a custom property, so its breakpoint has to be a literal
# Exits 0 only when all hold.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/packages/paperui/src"

# Files each check exempts, with reasons. Paths are relative to $SRC.
# (a) hex colors:
#   styles/colors.css
#       token definition file — the one place hex values are allowed to live
#       (it defines the --paper-* tokens everything else must consume)
#   __tests__/theme.test.tsx
#       hex literals are resolver passthrough assertions (proving
#       resolveBackground/resolveColor/getVarCss forward values through),
#       not styling
HEX_EXEMPT=(
    "styles/colors.css"
    "__tests__/theme.test.tsx"
)
# (b) global selectors: the files above, and
#   components/PaperEffect/index.module.css
#       documented global contract: top-level :global([data-paperui-motion="reduced"])
#       selectors key on the PaperUI-owned accessibility data attribute;
#       they target a runtime state flag, not a styling-scope escape
#   components/PaperButton/index.module.css
#       documented global contract: top-level :global([class*="PaperEffect"])
#       composition coupling — PaperButton's hover/active states key on the
#       PaperEffect class contract; the scoped subject (.PaperButton) stays local
GLOBAL_EXEMPT=(
    "${HEX_EXEMPT[@]}"
    "components/PaperEffect/index.module.css"
    "components/PaperButton/index.module.css"
)

fail=0

# scan <grep args...>: the matching lines, into SCAN. A scan that cannot read
# what it was pointed at (a moved folder, a grep error) fails the check
# instead of passing it with nothing found.
scan() {
    SCAN="$(grep -rnIE --exclude-dir=node_modules --exclude-dir=dist "$@")"
    local status=$?
    if [ "$status" -gt 1 ]; then
        echo "FAIL: paperui styling: grep could not scan (exit $status): $*" >&2
        exit 1
    fi
}

# without <file...>: stdin minus the lines grep -rn printed for those files
without() {
    local args=() file
    for file in "$@"; do
        args+=(-e "$SRC/$file:")
    done
    grep -vF "${args[@]}"
}

# (a) hardcoded hex colors
scan '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' "$SRC"
hex_out="$(printf '%s\n' "$SCAN" | without "${HEX_EXEMPT[@]}")"
if [ -n "$hex_out" ]; then
    echo "FAIL: hardcoded hex colors outside styles/colors.css:" >&2
    printf '%s\n' "$hex_out" >&2
    fail=1
fi

# (c) literal units in component CSS (token files are the one exception).
# src/marketing is left out on purpose: PaperUI Marketing draws the site's own
# fixed scale (its button's 18px and 24px type, its paper edge), which the
# app's tokens don't have and no app component should borrow. The hex and
# global-selector checks still cover it.
# A standalone 0px is not a size; a line is flagged when a literal is left
# once those are gone (`0px 12px` still has its 12px, `10px` is no zero).
scan '[0-9.]+(px|rem|em)\b' "$SRC/components" "$SRC/templates" --include='*.css'
unit_out="$(printf '%s\n' "$SCAN" \
    | grep -vE ':[0-9]+:[[:space:]]*\*' \
    | grep -vE ':[0-9]+:[[:space:]]*@(container|media)[[:space:]]' \
    | sed -nE 'h
s/^[^:]*:[0-9]+://
:zero
s/(^|[^0-9.])0px([^a-zA-Z0-9_]|$)/\1\2/
t zero
/[0-9.]+(px|rem|em)([^a-zA-Z0-9_]|$)/{
g
p
}')"
if [ -n "$unit_out" ]; then
    echo "FAIL: literal px/rem/em in component CSS (use tokens from src/styles):" >&2
    printf '%s\n' "$unit_out" >&2
    fail=1
fi

# (b) global selectors escaping .paperui-root
scan '^[[:space:]]*(:global\(|\*[[:space:]]*[,{])' "$SRC"
global_out="$(printf '%s\n' "$SCAN" | without "${GLOBAL_EXEMPT[@]}")"
if [ -n "$global_out" ]; then
    echo "FAIL: global selectors escaping .paperui-root (bare * or top-level :global() outside documented global contracts):" >&2
    printf '%s\n' "$global_out" >&2
    fail=1
fi

if [ "$fail" -ne 0 ]; then
    exit 1
fi
echo "ok: paperui styling invariant"
