#!/usr/bin/env bash
# Reports which test runner this repo requires.
#
# Contract "@paperui/dom-requires-vitest" (see README): PaperUI's sources are
# SolidJS tsx, whose suite needs vite-plugin-solid's transform, which `bun test`
# does not provide. `bun test` is deliberately blocked by test/bun-test-guard.ts.
#
# Usage: bash bin/test-which.sh [--warn]
#   --warn: also emit a stderr warning (for CI callers that want a non-zero pass
#            when the contract is violated).

set -u

contract="@paperui/dom-requires-vitest"

if [ "${1:-}" = "--warn" ]; then
    echo "WARNING [$contract]: do not run this repo with plain \`bun test\`." >&2
    echo "Run \`bun run test\` (vitest) instead. See README." >&2
fi

echo "PaperUI test runner contract: ${contract}"
echo "Run: bun run test"
