#!/usr/bin/env bash
# Backstop for AGENTS.md "Legacy/fallback code needs TODO(remove after vX)
# and dies in one release": fails when a TODO(remove after vX) or
# TODO(deny after vX) names a version at or below the current app version.
# Deprecations without enforcement dates are decorations; expired ones are
# broken promises. Markdown files are excluded (docs discuss TODOs in prose).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VERSION="$(grep -m1 '"version"' "$ROOT/apps/paperboard/package.json" | grep -o '[0-9][0-9]*\.[0-9][0-9]*' | head -1)"
CUR_MAJOR="${VERSION%%.*}"
CUR_MINOR="${VERSION#*.}"
if [ -z "$CUR_MAJOR" ] || [ -z "$CUR_MINOR" ]; then
    echo "FAIL: could not parse current version from apps/paperboard/package.json" >&2
    exit 1
fi

FAIL=0
while IFS= read -r line; do
    # line shape: path:lineno: ... TODO(remove|deny after vMAJOR.MINOR) ...
    loc="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    text="${rest#*:}"
    if [[ "$text" =~ TODO\((remove|deny)\ after\ v([0-9]+)\.([0-9]+) ]]; then
        kind="${BASH_REMATCH[1]}"
        major="${BASH_REMATCH[2]}"
        minor="${BASH_REMATCH[3]}"
        # force base-10 (leading zeros would read as octal)
        if [ "$major" -lt "$CUR_MAJOR" ] || { [ "$major" -eq "$CUR_MAJOR" ] && [ "$minor" -le "$CUR_MINOR" ]; }; then
            echo "FAIL: expired TODO($kind after v$major.$minor) at $loc:$lineno (current v$CUR_MAJOR.$CUR_MINOR)" >&2
            echo "      $text" | head -c 300 >&2
            echo >&2
            FAIL=1
        fi
    fi
done < <(rg -n --pcre2 -g '!node_modules' -g '!dist' -g '!build' -g '!out' -g '!*.md' -g '!.git' 'TODO\((remove|deny) after v[0-9]+\.[0-9]+' "$ROOT" || true)

if [ "$FAIL" -ne 0 ]; then
    exit 1
else
    echo "zero expired TODOs (current v$CUR_MAJOR.$CUR_MINOR)"
fi
