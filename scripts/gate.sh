#!/usr/bin/env bash
# Paperboard workspace gate: every repo's suite + typechecks, the
# silent-catch backstop, and the changelog-existence backstop.
# Exits 0 only when everything passes; keeps going to report all failures.
#
# Usage: gate.sh [target...]
#   No target runs the whole gate. Named targets run only their own steps
#   plus the shared-library builds they consume. Targets:
#     packages       shared library builds + packed external consumer check
#     paperapi       SDK: build, typecheck, tests, silent-catches
#     paperui        design system: build, tests, styling, silent-catches
#     paperboard     desktop app: typechecks, tests, lint, silent-catches
#     paperconvert   converter app: typecheck, tests, silent-catches
#     paperdocs      docs site: tests, build
#     origami        registry worker: typecheck, tests, silent-catches
#     origami-library  library UI: tests, build, silent-catches
#     scripts        root dev/publish scripts: tests, silent-catches
#     actions ai botcreator gameserver terminal   first-party panels
#   e.g. `bun run gate terminal`, `bun run gate paperapi paperui`
#
# Repo-wide checks (changelog-existence, todo-expiry) run only in the full
# gate; a filtered run is about the named targets.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATCH="$ROOT/apps/paperboard/scripts/check-no-silent-catches.sh"
FAIL=0
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/paperboard-gate-XXXXXX")"
export PAPERBOARD_DIR="$TEST_ROOT/data"
trap 'rm -rf "$TEST_ROOT"' EXIT

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

# ── target selection ─────────────────────────────────────────────────────────
# Every selectable target. The *-build names are prerequisites, not
# user-facing: they exist so a filtered run can pull in the shared library
# artifact a consumer needs without running that library's whole suite.
KNOWN_TARGETS="packages paperapi paperui paperapi-build paperui-build paperboard paperconvert paperdocs origami origami-library scripts actions ai botcreator gameserver terminal"

# Prerequisites per target, expanded transitively. A panel (and any app that
# bundles the SDK/design system) needs paperapi/paperui dist present; the
# panel's vite build resolves @paperboard-dev/paperapi to dist, not source.
target_deps() {
    case "$1" in
        paperapi) echo "paperapi-build" ;;
        paperui) echo "paperui-build" ;;
        packages) echo "paperapi-build paperui-build" ;;
        paperboard | paperconvert | paperdocs | origami-library) echo "paperapi-build paperui-build" ;;
        actions | ai | botcreator | gameserver | terminal) echo "paperapi-build paperui-build" ;;
        *) echo "" ;;
    esac
}

is_known() {
    local t
    for t in $KNOWN_TARGETS; do
        [ "$t" = "$1" ] && return 0
    done
    return 1
}

TARGETS=("$@")
SELECTED=()
if [ "${#TARGETS[@]}" -gt 0 ]; then
    for t in "${TARGETS[@]}"; do
        if ! is_known "$t"; then
            echo "gate: unknown target \"$t\"" >&2
            echo "gate: known targets: $KNOWN_TARGETS" >&2
            exit 2
        fi
    done
    queue=("${TARGETS[@]}")
    while [ "${#queue[@]}" -gt 0 ]; do
        t="${queue[0]}"
        queue=("${queue[@]:1}")
        already=0
        if [ "${#SELECTED[@]}" -gt 0 ]; then
            for s in "${SELECTED[@]}"; do
                [ "$s" = "$t" ] && already=1 && break
            done
        fi
        [ "$already" -eq 1 ] && continue
        SELECTED+=("$t")
        for d in $(target_deps "$t"); do
            queue+=("$d")
        done
    done
    echo "--- gate: targets: ${SELECTED[*]}"
fi

# want <target>: is it in the selected set (or is this the full gate)?
want() {
    [ "${#SELECTED[@]}" -eq 0 ] && return 0
    local s
    for s in "${SELECTED[@]}"; do
        [ "$s" = "$1" ] && return 0
    done
    return 1
}

# gstep <target> <desc> <cmd...>: run a step only when its target is selected
gstep() {
    local target="$1"
    shift
    if want "$target"; then
        step "$@"
    fi
}

# ── shared library artifacts ─────────────────────────────────────────────────
# Test current shared artifacts, never whatever an earlier developer built.
gstep paperapi-build "paperapi build" run_in "$ROOT/packages/paperapi" bun run build
gstep paperui-build "paperui build" run_in "$ROOT/packages/paperui" bun run build
gstep packages "packed external consumers" node "$ROOT/scripts/check-package-artifacts.mjs"

# ── Paperboard app: node + web typechecks, full suite, lint, silent-catches ──
gstep paperboard "paperboard typecheck:node" run_in "$ROOT/apps/paperboard" bun run typecheck:node
gstep paperboard "paperboard typecheck:web" run_in "$ROOT/apps/paperboard" bun run typecheck:web
gstep paperboard "paperboard tests" run_in "$ROOT/apps/paperboard" bun test
gstep paperboard "paperboard lint" run_in "$ROOT/apps/paperboard" bunx biome lint
gstep paperboard "paperboard silent-catches" run_in "$ROOT/apps/paperboard" bash "$CATCH"

# ── root dev scripts: publisher release-math proofs + silent-catch backstop ──
gstep scripts "root scripts tests" run_in "$ROOT" bun test scripts
gstep scripts "root scripts silent-catches" run_in "$ROOT" bash "$CATCH" scripts

# ── paperconvert: workspace app with its own typecheck and silent-catch gate ─
gstep paperconvert "paperconvert typecheck" run_in "$ROOT/apps/paperconvert" bun run typecheck
gstep paperconvert "paperconvert tests" run_in "$ROOT/apps/paperconvert" bun run test
gstep paperconvert "paperconvert silent-catches" run_in "$ROOT/apps/paperconvert" bash "$CATCH" src

# ── paperdocs: tests plus the static site build (typecheck, SPA, prerender) ──
gstep paperdocs "paperdocs tests" run_in "$ROOT/apps/paperdocs" bun test
gstep paperdocs "paperdocs build" run_in "$ROOT/apps/paperdocs" bun run build

# ── shared libraries ─────────────────────────────────────────────────────────
gstep paperapi "paperapi typecheck" run_in "$ROOT/packages/paperapi" bunx tsc --noEmit
gstep paperapi "paperapi tests" run_in "$ROOT/packages/paperapi" bun test
gstep paperapi "paperapi silent-catches" run_in "$ROOT/packages/paperapi" bash "$CATCH" src test
gstep paperui "paperui tests" run_in "$ROOT/packages/paperui" bun run test
gstep paperui "paperui styling invariant" bash "$ROOT/scripts/check-paperui-styling.sh"
gstep paperui "paperui silent-catches" run_in "$ROOT/packages/paperui" bash "$CATCH" src

# ── registry service: typecheck plus its worker suite (the library division
# has its own vitest suite below; `bun test ./test` scopes bun to the worker) ─
gstep origami "origami typecheck" run_in "$ROOT/apps/origami" bun run typecheck
gstep origami "origami tests" run_in "$ROOT/apps/origami" bun run test
gstep origami "origami silent-catches" run_in "$ROOT/apps/origami" bash "$CATCH" src test

# ── the panel library division of origami: browser-logic suite and the
# production build that static assets serve (typecheck rides origami's) ──────
gstep origami-library "origami library tests" run_in "$ROOT/apps/origami/library" bun run test
gstep origami-library "origami library build" run_in "$ROOT/apps/origami/library" bun run build
gstep origami-library "origami library silent-catches" run_in "$ROOT/apps/origami/library" bash "$CATCH" src test

# ── first-party panels: suite, typecheck, production build, silent-catch gate.
# The daemon runs the built dist/service.js, not the TypeScript source, so the
# gate rebuilds every panel: tests and typechecks prove the source, the build
# proves the artifact that actually ships. ───────────────────────────────────
for short in actions ai botcreator gameserver terminal; do
    panel="panels/dev.paperboard.$short"
    gstep "$short" "$panel tests" run_in "$ROOT/$panel" bun run test
    gstep "$short" "$panel typecheck" run_in "$ROOT/$panel" bunx tsc --noEmit
    gstep "$short" "$panel build" run_in "$ROOT/$panel" bun run build
    gstep "$short" "$panel silent-catches" run_in "$ROOT/$panel" bash "$CATCH" src test
done

# ── repo-wide checks (full gate only) ────────────────────────────────────────
if want global; then
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
fi

if [ "$FAIL" -ne 0 ]; then
    echo "GATE FAILED" >&2
    exit 1
fi
echo "GATE GREEN"
