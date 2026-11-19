#!/usr/bin/env bash
# App and panel styling check (warning only: findings exit 0, and only a
# scan that could not run exits nonzero): flags literal sizes, colors, motion, z-index, opacity, font weights, line
# heights and scales in apps and panels that have a PaperUI token. PaperUI's
# own sources are gated, and strictly, by check-paperui-styling.sh.
#
# Not flagged:
#   - a line that defines a custom property (`--x: 12px`): that is where a
#     panel names a footprint PaperUI has no token for
#   - `0`, `1`, percentages, viewport units, angles, and aspect ratios
#   - getVar()/getVarCss() fallbacks: they mirror a token for when it is unset
#   - a line containing `paper-literal-ok: why`, the lines after a comment
#     containing it (up to a blank line), and any file containing
#     `paper-literal-ok-file: why`
#   - tests, dist/out, node_modules, and the paperdocs marketing site
#
# Usage: check-app-styling.sh [path...]   (default: apps and panels)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

if [ "$#" -gt 0 ]; then
    SCOPE=("$@")
else
    SCOPE=(apps/paperboard services/library panels packages/create-panel/template)
fi

# a scope git does not know (a moved or mistyped folder) fails here, not as
# a clean "no files in scope"
if ! TRACKED="$(git ls-files --error-unmatch "${SCOPE[@]}")"; then
    echo "FAIL: app styling: git could not list ${SCOPE[*]}" >&2
    exit 1
fi
FILES="$(printf '%s\n' "$TRACKED" \
    | grep -E '\.(css|tsx)$' \
    | grep -vE '(^|/)(node_modules|dist|out)/|\.test\.|/__tests__/|/tests?/|\.d\.ts$')"

if [ -z "$FILES" ]; then
    echo "ok: app styling (no files in scope)"
    exit 0
fi

# shellcheck disable=SC2086
if ! OUT="$(printf '%s\n' $FILES | python3 -I "$ROOT/scripts/gate/check-app-styling.py")"; then
    echo "FAIL: app styling: the scanner (check-app-styling.py) did not finish" >&2
    exit 1
fi
if [ -n "$OUT" ]; then
    echo "WARN: literal values with a PaperUI token (use --paper-* tokens; if one is missing, add it to PaperUI):" >&2
    printf '%s\n' "$OUT" >&2
    echo "warn: app styling ($(printf '%s\n' "$OUT" | wc -l | tr -d ' ') literals, not blocking)"
else
    echo "ok: app styling"
fi
exit 0
