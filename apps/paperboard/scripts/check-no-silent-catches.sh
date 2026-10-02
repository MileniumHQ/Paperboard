#!/usr/bin/env bash
# Backstop for AGENTS.md "No silent failure".
# Biome's noEmptyBlockStatements misses some empty-body shapes (arrow-function
# handlers, parenthesized bindings), so this grep runs as a gates step and
# fails the build if any silent catch exists.
#
# Three shapes fail:
#  1. empty or comment-only bodies — a comment is not a log (updater.ts:390
#     taught us comments defeat naive gates, so comment-only bodies fail too).
#  2. single-level bodies whose last statement is `return <fallback>` with no
#     log, rethrow, or other observable effect in the body. Returning a
#     fabricated value with no trace is the silent-failure shape that bit
#     readCraneCreds/normalizeEmbeds/getSystemInfo. Bodies that log (logger.,
#     console., debugErr, logToMain), rethrow, answer over RPC/HTTP (reply,
#     res.end, jsonResponse), emit events, update UI state (setX), deliver the
#     error to a callback (onError, onVerifyError), or do multi-statement work
#     never match. Probe predicates must log too (even debug) — false IS an
#     answer, but an untraced one.
#  3. empty promise-arrow bodies (no-paren and paren-bound error params).
#
# Deliberately NOT covered: single-expression arrow recoveries such as a
# reconnect trigger — they take a real action rather than fabricating a
# value; review judges those. Named-function handlers are opaque to grep
# for the same reason.
# (This comment avoids quoting any shape the patterns below would match.)
set -u
if [ "$#" -gt 0 ]; then
    DIRS="$*"
else
    DIRS="papercrane src tests scripts"
fi
GLOBS=(--glob '!node_modules' --glob '!dist' --glob '!out' --glob '!build')
FAIL=0
# rg exits 0 on a match, 1 on none, and anything else when it could not
# search at all (missing binary, bad pattern, unreadable path). Only 1 is
# "clean": a scan that never ran must not report zero silent catches.
scan() {
    rg "$@"
    local status=$?
    if [ "$status" -gt 1 ]; then
        echo "FAIL: ripgrep could not run the scan (exit $status); install ripgrep" >&2
        exit 2
    fi
    return "$status"
}
# shellcheck disable=SC2086
if scan -U --pcre2 -n "${GLOBS[@]}" 'catch\s*(\([^)]*\))?\s*\{\s*\}|catch\s*(\([^)]*\))?\s*\{\s*/\*[^}]*\*/\s*\}' $DIRS; then
    echo "FAIL: empty or comment-only catch bodies found above" >&2
    FAIL=1
fi
# shellcheck disable=SC2086
if scan -U --pcre2 -n "${GLOBS[@]}" 'catch\s*(\([^)]*\))?\s*\{(?![^{}]*\b(logToMain|logger\.|\blog\s*\.|\blog\s*\(|console\.|debugErr|debug\s*\(|throw\b|emitTrigger|\bemit\s*\(|reply\s*\(|reject\s*\(|set[A-Z]\w*|res\.end|jsonResponse|onError|onVerifyError))[^{}]*\breturn\b\s*[^;{}]*;\s*\}' $DIRS; then
    echo "FAIL: value-returning catches with no log found above" >&2
    FAIL=1
fi
# shellcheck disable=SC2086
if scan -n "${GLOBS[@]}" '\.catch\(\(\s*\)\s*=>\s*\{\s*\}\)|\.catch\(\(\s*_\s*\)\s*=>\s*\{\s*\}\)|\.catch\([A-Za-z_$][\w$]*\s*=>\s*\{\s*\}\)' $DIRS; then
    echo "FAIL: empty promise-arrow catches found above" >&2
    FAIL=1
fi
if [ "$FAIL" -ne 0 ]; then
    exit 1
else
    echo "zero silent catches"
fi
