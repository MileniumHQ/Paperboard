#!/usr/bin/env bash
# Paperboard workspace gate: every repo's suite + typechecks, the code
# check, and the changelog-existence backstop.
# Exits 0 only when everything passes; keeps going to report all failures.
#
# Usage: gate.sh [target...]
#   No target runs the whole gate. Named targets run only their own steps
#   plus the shared-library builds they consume. Targets:
#     packages       shared library builds + packed external consumer check
#     paperapi       SDK: build, typecheck, tests
#     paperui        design system: build, tests, styling
#   Every target with code runs the code check (scripts/gate/check-solid.ts) over
#   its sources and tests: the mechanical Solid mistakes AGENTS.md's "Solid:"
#   section names, and the house rules that kept coming back (a catch that
#   only logs, an effect without on(), <For> fed fresh rows, fixed sleeps in
#   tests).
#   paperboard, library and the panels also run an advisory styling
#   check (scripts/gate/check-app-styling.sh): literal sizes, colors, motion,
#   z-index and the like that have a PaperUI token. It warns, never fails.
#     create-panel   panel scaffolder: build, tests
#     release        @mileniumhq/release (release key, signed messages, package
#                    recipes, version order): typecheck, tests
#     testkit        the shared test harness (packages/testkit): typecheck,
#                    tests
#     npx            @mileniumhq/paperboard (npx launcher for the daemon):
#                    build, tests
#     daemon         server daemon (apps/daemon): typecheck, tests, lint,
#                    and the workload supervisor's (Go) format, vet and
#                    tests
#     paperboard     desktop app: typechecks (src and tests), tests, lint
#     paperdocs      docs site: tests, build
#     origami        registry worker: typecheck, tests
#     library        panel library (store) web app: tests, build
#     arilink        pbd.lc short-link worker: typecheck, tests
#     panelapis      third-party API proxy worker: typecheck, tests
#     scripts        root dev/publish scripts: typecheck, tests
#     agents blocks botcreator gameserver terminal   first-party panels
#     global         repo-wide checks (changelog-existence, todo-expiry)
#     platform       the cross-platform suites only: each `tests/platform` or
#                    `test/platform` directory below. CI runs this on every
#                    release target other than linux-x64, which runs it as
#                    part of the full suites (the full gate skips it).
#   e.g. `bun run gate terminal`, `bun run gate paperapi paperui`
#
# Repo-wide checks (changelog-existence, todo-expiry) run in the full gate or
# when `global` is named; any other filtered run is about the named targets.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

# The workload supervisor (Go) is formatted and vets clean for every system it
# ships on; its Windows and macOS code is only run on those systems (the
# platform target), so a mistake there has to be caught by the compiler here.
supervisor_vet() {
    (
        cd "$ROOT/apps/daemon/supervisor" || exit 1
        unformatted="$(gofmt -l .)" || exit 1
        if [ -n "$unformatted" ]; then
            echo "not gofmt-formatted: $unformatted" >&2
            exit 1
        fi
        for os in linux darwin windows; do
            GOOS="$os" go vet ./... || exit 1
        done
    )
}

# ── target selection ─────────────────────────────────────────────────────────
# Every selectable target. The *-build names are prerequisites, not
# user-facing: they exist so a filtered run can pull in the shared library
# artifact a consumer needs without running that library's whole suite.
KNOWN_TARGETS="global platform packages paperapi paperui create-panel release testkit npx paperapi-build paperui-build create-panel-build daemon paperboard paperdocs origami library arilink panelapis scripts agents blocks botcreator gameserver terminal"

# Prerequisites per target, expanded transitively. A panel (and any app that
# bundles the SDK/design system) needs paperapi/paperui dist present; the
# panel's vite build resolves @mileniumhq/paperapi to dist, not source.
target_deps() {
    case "$1" in
        paperapi) echo "paperapi-build" ;;
        paperui) echo "paperui-build" ;;
        create-panel) echo "paperapi-build paperui-build create-panel-build" ;;
        packages) echo "paperapi-build paperui-build create-panel-build" ;;
        daemon | paperboard | paperdocs | library | platform) echo "paperapi-build paperui-build" ;;
        agents | blocks | botcreator | gameserver | terminal) echo "paperapi-build paperui-build" ;;
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

# gwarn <target> <desc> <cmd...>: like gstep, but advisory. The command's
# output is shown and a nonzero exit is reported, but never fails the gate.
gwarn() {
    local target="$1" desc="$2"
    shift 2
    if want "$target"; then
        echo "--- gate (advisory): $desc"
        "$@" || echo "warn: $desc exited nonzero (advisory, not failing the gate)" >&2
    fi
}

# ── shared library artifacts ─────────────────────────────────────────────────
# Test current shared artifacts, never whatever an earlier developer built.
# CI may restore a library's dist from a cache keyed by every file in the
# package plus the lockfile, and then names it in PAPERBOARD_GATE_PREBUILT.
# That's the same build of the same sources, so a consumer uses it as is. A
# run of the library's own target always builds it from scratch.
lib_build() {
    local name="$1"
    case " ${PAPERBOARD_GATE_PREBUILT:-} " in
        *" $name "*)
            if ! want "$name"; then
                echo "--- gate: $name build"
                if [ -f "$ROOT/packages/$name/dist/index.d.ts" ]; then
                    echo "ok: $name build (restored, built from these exact sources)"
                else
                    echo "FAIL: $name build: PAPERBOARD_GATE_PREBUILT names it, but packages/$name/dist has no build" >&2
                    FAIL=1
                fi
                return
            fi
            ;;
    esac
    step "$name build" run_in "$ROOT/packages/$name" bun run build
}
want paperapi-build && lib_build paperapi
want paperui-build && lib_build paperui
gstep create-panel-build "create-panel build" run_in "$ROOT/packages/create-panel" bun run build
gstep packages "packed external consumers" bun "$ROOT/scripts/gate/check-package-artifacts.mjs"

# ── server daemon: typecheck, full suite, lint, code check, and the Go
# workload supervisor it launches ───────────────────────────────────────────
gstep daemon "daemon typecheck" run_in "$ROOT/apps/daemon" bun run typecheck
gstep daemon "daemon typecheck:tests" run_in "$ROOT/apps/daemon" bun run typecheck:tests
gstep daemon "daemon tests" run_in "$ROOT/apps/daemon" bun run test
gstep daemon "daemon lint" run_in "$ROOT/apps/daemon" bunx biome lint
gstep daemon "supervisor format and vet (linux, macOS, Windows)" supervisor_vet
gstep daemon "supervisor tests" run_in "$ROOT/apps/daemon/supervisor" go test -count=1 ./...
gstep daemon "daemon code check" run_in "$ROOT" bun scripts/gate/check-solid.ts apps/daemon/src apps/daemon/test

# ── Paperboard app: node + web + tests typechecks, full suite, lint ──
gstep paperboard "paperboard typecheck:node" run_in "$ROOT/apps/paperboard" bun run typecheck:node
gstep paperboard "paperboard typecheck:web" run_in "$ROOT/apps/paperboard" bun run typecheck:web
gstep paperboard "paperboard typecheck:tests" run_in "$ROOT/apps/paperboard" bun run typecheck:tests
gstep paperboard "paperboard tests" run_in "$ROOT/apps/paperboard" bun run test
gstep paperboard "paperboard lint" run_in "$ROOT/apps/paperboard" bunx biome lint
gstep paperboard "paperboard code check" run_in "$ROOT" bun scripts/gate/check-solid.ts apps/paperboard/src apps/paperboard/tests apps/paperboard/scripts
gwarn paperboard "paperboard styling literals" bash "$ROOT/scripts/gate/check-app-styling.sh" apps/paperboard

# ── root dev scripts: typecheck, publisher release-math proofs, the browser
# test drivers, code check. The compiler is packages/paperui's, the
# same one check-solid.ts loads; the root package depends on none. ──────────
gstep scripts "root scripts typecheck" run_in "$ROOT" bun packages/paperui/node_modules/typescript/bin/tsc -p scripts/tsconfig.json
gstep scripts "root scripts tests" run_in "$ROOT" bun test --parallel scripts
gstep scripts "root scripts code check" run_in "$ROOT" bun scripts/gate/check-solid.ts scripts

## ── paperdocs: static site build (typecheck, site + docs prerender, alias files, shared 404) ──
gstep paperdocs "paperdocs build" run_in "$ROOT/apps/paperdocs" bun run build
gstep paperdocs "paperdocs code check" run_in "$ROOT" bun scripts/gate/check-solid.ts apps/paperdocs/src apps/paperdocs/scripts

# ── shared libraries ────────────────────────────────────────────────────────
gstep paperapi "paperapi typecheck" run_in "$ROOT/packages/paperapi" bunx tsc --noEmit
gstep paperapi "paperapi tests" run_in "$ROOT/packages/paperapi" bun run test
gstep paperapi "paperapi code check" run_in "$ROOT" bun scripts/gate/check-solid.ts packages/paperapi/src packages/paperapi/test
gstep paperui "paperui tests" run_in "$ROOT/packages/paperui" bun run test
gstep paperui "paperui styling invariant" bash "$ROOT/scripts/gate/check-paperui-styling.sh"
gstep paperui "paperui code check" run_in "$ROOT" bun scripts/gate/check-solid.ts packages/paperui/src
gstep create-panel "create-panel typecheck:tests" run_in "$ROOT/packages/create-panel" bun run typecheck:tests
gstep create-panel "create-panel tests" run_in "$ROOT/packages/create-panel" bun run test
gstep create-panel "create-panel code check" run_in "$ROOT" bun scripts/gate/check-solid.ts packages/create-panel/src packages/create-panel/bin packages/create-panel/test packages/create-panel/template
gstep release "release typecheck" run_in "$ROOT/packages/release" bunx tsc --noEmit
gstep release "release typecheck:tests" run_in "$ROOT/packages/release" bun run typecheck:tests
gstep release "release tests" run_in "$ROOT/packages/release" bun run test
gstep release "release code check" run_in "$ROOT" bun scripts/gate/check-solid.ts packages/release/src packages/release/test
gstep testkit "testkit typecheck" run_in "$ROOT/packages/testkit" bun run typecheck
gstep testkit "testkit code check" run_in "$ROOT" bun scripts/gate/check-solid.ts packages/testkit/src
gstep npx "npx typecheck:tests" run_in "$ROOT/packages/npx" bun run typecheck:tests
gstep npx "npx tests" run_in "$ROOT/packages/npx" bun run test
gstep npx "npx code check" run_in "$ROOT" bun scripts/gate/check-solid.ts packages/npx/src packages/npx/test

# ── registry service: typecheck plus its worker suite (the library division
# has its own vitest suite below; `bun test ./test` scopes bun to the worker) ─
gstep origami "origami typecheck" run_in "$ROOT/services/origami" bun run typecheck
gstep origami "origami tests" run_in "$ROOT/services/origami" bun run test
gstep origami "origami code check" run_in "$ROOT" bun scripts/gate/check-solid.ts services/origami/src services/origami/test services/origami/scripts

# ── arilink: the pbd.lc short-link worker ───────────────────────────────────
gstep arilink "arilink typecheck" run_in "$ROOT/services/arilink" bun run typecheck
gstep arilink "arilink tests" run_in "$ROOT/services/arilink" bun run test
gstep arilink "arilink code check" run_in "$ROOT" bun scripts/gate/check-solid.ts services/arilink/src services/arilink/test

# ── panelapis: third-party API proxy worker ─────────────────────────────────
gstep panelapis "panelapis typecheck" run_in "$ROOT/services/panelapis" bun run typecheck
gstep panelapis "panelapis tests" run_in "$ROOT/services/panelapis" bun run test
gstep panelapis "panelapis code check" run_in "$ROOT" bun scripts/gate/check-solid.ts services/panelapis/src services/panelapis/test

# ── the panel library division of origami: browser-logic suite and the
# production build that static assets serve (typecheck rides origami's) ──────
gstep library "library tests" run_in "$ROOT/services/library" bun run test
gstep library "library build" run_in "$ROOT/services/library" bun run build
gstep library "library code check" run_in "$ROOT" bun scripts/gate/check-solid.ts services/library/src services/library/test
gwarn library "library styling literals" bash "$ROOT/scripts/gate/check-app-styling.sh" services/library

# ── first-party panels: suite, typecheck, production build, store listing,
# code check.
# The daemon runs the built dist/service.js, not the TypeScript source, so the
# gate rebuilds every panel: tests and typechecks prove the source, the build
# proves the artifact that actually ships. ───────────────────────────────────
for short in agents blocks botcreator gameserver terminal; do
    panel="panels/dev.paperboard.$short"
    gstep "$short" "$panel tests" run_in "$ROOT/$panel" bun run test
    gstep "$short" "$panel typecheck" run_in "$ROOT/$panel" bunx tsc --noEmit
    gstep "$short" "$panel typecheck:tests" run_in "$ROOT/$panel" bun run typecheck:tests
    gstep "$short" "$panel build" run_in "$ROOT/$panel" bun run build
    gstep "$short" "$panel store listing" run_in "$ROOT" bun scripts/gate/check-store-listing.ts "$panel"
    gstep "$short" "$panel code check" run_in "$ROOT" bun scripts/gate/check-solid.ts "$panel"
    gwarn "$short" "$panel styling literals" bash "$ROOT/scripts/gate/check-app-styling.sh" "$panel"
done

# ── cross-platform suites: what depends on the OS or CPU (booting and
# updating the built app and daemon, processes, signals, paths, archives,
# file modes). The full suites above already include these directories, so
# the full gate skips them: they run only when `platform` is named. ─────────
if [ "${#SELECTED[@]}" -gt 0 ]; then
    gstep platform "supervisor tests" run_in "$ROOT/apps/daemon/supervisor" go test -count=1 ./...
    gstep platform "daemon platform tests" run_in "$ROOT/apps/daemon" bun test ./test/platform
    gstep platform "paperboard platform tests" run_in "$ROOT/apps/paperboard" bun test ./tests/platform
    gstep platform "gameserver platform tests" run_in "$ROOT/panels/dev.paperboard.gameserver" bun test --isolate --conditions browser ./test/platform
    gstep platform "agents platform tests" run_in "$ROOT/panels/dev.paperboard.agents" bun test ./test/platform
    gstep platform "terminal platform tests" run_in "$ROOT/panels/dev.paperboard.terminal" bun test ./test/platform
    gstep platform "npx platform tests" run_in "$ROOT/packages/npx" bash -c "bun run build && bun test ./test/platform"
fi

# ── repo-wide checks (full gate, or `global`) ────────────────────────────────
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
    if bash "$ROOT/scripts/gate/check-todo-expiry.sh"; then
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
