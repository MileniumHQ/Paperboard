#!/usr/bin/env bash
# Styling invariant gate for PaperUI (AGENTS.md hard rules):
#   - no hardcoded hex colors outside the token-definition file
#     (src/styles/colors.css — the only place `--paper-*` tokens may define
#     concrete values)
#   - no unscoped global selectors (`* {`, `:global(*)`) — styling must live
#     inside a scoped root context
#
# Attribute-scoped global contracts (e.g. body[data-paperui-theme] rules in
# colors.css, `:global([data-paperui-theme=...])` inside a scoped selector) are
# allowed per the documented exceptions in AGENTS.md.
#
# Usage: bash scripts/check-styling.sh (from the repo root)

set -u
cd "$(dirname "$0")/.."

STATUS=0

FILES=$(find src -name '*.css' ! -path 'src/styles/colors.css')

if [ -n "$FILES" ]; then
    # (a) hardcoded hex colors
    HEX=$(grep -nE '#[0-9a-fA-F]{3,8}' $FILES || true)
    if [ -n "$HEX" ]; then
        echo "check-styling: hardcoded hex colors found outside src/styles/colors.css:" >&2
        echo "$HEX" >&2
        STATUS=1
    fi

    # (b) top-level global selectors
    GLOBAL=$(grep -nE '^[[:space:]]*\*[[:space:]]*\{|^[[:space:]]*:global\(\*\)' $FILES || true)
    if [ -n "$GLOBAL" ]; then
        echo "check-styling: unscoped global selectors found:" >&2
        echo "$GLOBAL" >&2
        STATUS=1
    fi
else
    echo "check-styling: no stylesheet files found under src/ — nothing checked." >&2
    STATUS=1
fi

if [ "$STATUS" -eq 0 ]; then
    echo "check-styling: OK (hex + global-selector invariants hold)"
fi

exit "$STATUS"
