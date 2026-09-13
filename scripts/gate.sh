#!/usr/bin/env bash
# Paperboard workspace gate: every repo's suite + typechecks, the
# silent-catch backstop, and the changelog-existence backstop.
# Exits 0 only when everything passes; keeps going to report all failures.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATCH="$ROOT/apps/paperboard/scripts/check-no-silent-catches.sh"
FAIL=0

step() {
    local desc="$1"
    shift
    echo "--- gate: $desc"
    if "$@"; then
        echo "ok: $desc"
    else
        echo "FAIL: $desc" >&2
        FAIL=1
    fi
}

run_in() {
    local dir="$1"
    shift
    (cd "$dir" && "$@")
}

# Paperboard app: node + web typechecks, full suite, lint, silent-catch gate
step "paperboard typecheck:node" run_in "$ROOT/apps/paperboard" bun run typecheck:node
step "paperboard typecheck:web" run_in "$ROOT/apps/paperboard" bun run typecheck:web
step "paperboard tests" run_in "$ROOT/apps/paperboard" bun test
step "paperboard lint" run_in "$ROOT/apps/paperboard" bunx biome lint
step "paperboard silent-catches" run_in "$ROOT/apps/paperboard" bash "$CATCH"

# shared libraries
step "paperapi typecheck" run_in "$ROOT/packages/paperapi" bunx tsc --noEmit
step "paperapi tests" run_in "$ROOT/packages/paperapi" bun test
step "paperapi silent-catches" run_in "$ROOT/packages/paperapi" bash "$CATCH" src test
step "paperui tests" run_in "$ROOT/packages/paperui" bun run test
step "paperui styling invariant" bash "$ROOT/scripts/check-paperui-styling.sh"
step "paperui silent-catches" run_in "$ROOT/packages/paperui" bash "$CATCH" src

# registry service: typecheck plus its suite (no test script, bun runs it)
step "origami typecheck" run_in "$ROOT/apps/origami" bun run typecheck
step "origami tests" run_in "$ROOT/apps/origami" bun test
step "origami silent-catches" run_in "$ROOT/apps/origami" bash "$CATCH" src test

# first-party panels: suite, typecheck, silent-catch gate each
for panel in panels/dev.paperboard.actions panels/dev.paperboard.botcreator panels/dev.paperboard.gameserver panels/dev.paperboard.terminal; do
    step "$panel tests" run_in "$ROOT/$panel" bun test
    step "$panel typecheck" run_in "$ROOT/$panel" bunx tsc --noEmit
    step "$panel silent-catches" run_in "$ROOT/$panel" bash "$CATCH" src test
done

# changelog-existence gate: changelogs are suspended, zero CHANGELOG.md files
echo "--- gate: changelog-existence"
CHANGELOGS="$(find "$ROOT" -name 'CHANGELOG.md' -not -path '*/node_modules/*' 2>/dev/null)"
if [ -n "$CHANGELOGS" ]; then
    echo "FAIL: CHANGELOG.md files exist (changelogs suspended):" >&2
    echo "$CHANGELOGS" >&2
    FAIL=1
else
    echo "ok: changelog-existence (zero CHANGELOG.md)"
fi

# deprecation-expiry gate: TODO(remove|deny after vX) must die on schedule
echo "--- gate: todo-expiry"
if bash "$ROOT/scripts/check-todo-expiry.sh"; then
    echo "ok: todo-expiry"
else
    echo "FAIL: todo-expiry" >&2
    FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
    echo "GATE FAILED" >&2
    exit 1
fi
echo "GATE GREEN"
