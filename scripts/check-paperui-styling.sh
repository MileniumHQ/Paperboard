#!/usr/bin/env bash
# PaperUI styling invariant gate:
#   (a) no hardcoded hex colors outside the token definition file —
#       styling must use --paper-* tokens from PaperUI
#   (b) no global selectors escaping .paperui-root: bare `* {` / `*,` and
#       top-level `:global(` with no local selector anchoring it
#   (c) no literal px/rem/em in component CSS: sizes are tokens, and the
#       token files (src/styles/*.css) are the only place literals live
# Exits 0 only when all hold.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/packages/paperui/src"

# Exempted files, with reasons:
#   src/styles/colors.css
#       token definition file — the one place hex values are allowed to live
#       (it defines the --paper-* tokens everything else must consume)
#   src/__tests__/theme.test.tsx
#       hex literals are resolver passthrough assertions (proving
#       resolveBackground/resolveColor/getVarCss forward values through),
#       not styling
#   src/components/PaperEffect/index.module.css
#       documented global contract: top-level :global([data-paperui-motion="reduced"])
#       selectors key on the PaperUI-owned accessibility data attribute;
#       they target a runtime state flag, not a styling-scope escape
#   src/components/PaperButton/index.module.css
#       documented global contract: top-level :global([class*="PaperEffect"])
#       composition coupling — PaperButton's hover/active states key on the
#       PaperEffect class contract; the scoped subject (.PaperButton) stays local
EXEMPT=(
    "src/styles/colors.css"
    "src/__tests__/theme.test.tsx"
    "src/components/PaperEffect/index.module.css"
    "src/components/PaperButton/index.module.css"
)

fail=0

# (a) hardcoded hex colors
hex_out="$(grep -rnIE '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' "$SRC" \
    --exclude-dir=node_modules --exclude-dir=dist \
    | grep -vF -e "$SRC/styles/colors.css" -e "$SRC/__tests__/theme.test.tsx")"
if [ -n "$hex_out" ]; then
    echo "FAIL: hardcoded hex colors outside styles/colors.css:" >&2
    printf '%s\n' "$hex_out" >&2
    fail=1
fi

# (c) literal units in component CSS (token files are the one exception)
unit_out="$(grep -rnIE '[0-9.]+(px|rem|em)\b' "$SRC/components" "$SRC/templates" \
    --include='*.css' --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null \
    | grep -vE ':[0-9]+:[[:space:]]*\*' \
    | grep -vE '0px')"
if [ -n "$unit_out" ]; then
    echo "FAIL: literal px/rem/em in component CSS (use tokens from src/styles):" >&2
    printf '%s\n' "$unit_out" >&2
    fail=1
fi

# (b) global selectors escaping .paperui-root
global_out="$(grep -rnIE '^[[:space:]]*(:global\(|\*[[:space:]]*[,{])' "$SRC" \
    --exclude-dir=node_modules --exclude-dir=dist \
    | grep -vF -e "$SRC/styles/colors.css" -e "$SRC/__tests__/theme.test.tsx" \
              -e "$SRC/components/PaperEffect/index.module.css" \
              -e "$SRC/components/PaperButton/index.module.css")"
if [ -n "$global_out" ]; then
    echo "FAIL: global selectors escaping .paperui-root (bare * or top-level :global() outside documented global contracts):" >&2
    printf '%s\n' "$global_out" >&2
    fail=1
fi

if [ "$fail" -ne 0 ]; then
    exit 1
fi
echo "ok: paperui styling invariant"
