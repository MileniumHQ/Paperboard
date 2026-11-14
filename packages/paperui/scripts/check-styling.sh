#!/usr/bin/env bash
# Styling invariant gate for PaperUI (AGENTS.md hard rules):
#   - no hardcoded hex colors outside the token-definition file
#     (src/styles/colors.css — the only place `--paper-*` tokens may define
#     concrete values)
#   - no unscoped global selectors (`* {`, `:global(*)`) — styling must live
#     inside a scoped root context
#
# Attribute-scoped global rules (body[data-paperui-theme] rules in colors.css,
# `:global([data-paperui-theme=...])` inside a scoped selector) are allowed:
# they style a document only once it opts in with the attribute, and check (b)
# below only matches a bare `* {` or `:global(*)`.
#
# Usage: bash packages/paperui/scripts/check-styling.sh (it checks the package it
# sits in, from any directory)

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
