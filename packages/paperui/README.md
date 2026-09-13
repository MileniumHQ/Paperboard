# PaperUI

A component library and design system for [Paperboard](https://paperboard.dev) and its panel ecosystem, built with [SolidJS](https://www.solidjs.com).

## Testing

**@paperui/dom-requires-vitest** — the sources (including `src/__tests__`) are SolidJS `.tsx` and are transformed by `vite-plugin-solid`, so the supported runner is vitest:

    bun run test

Plain `bun test` cannot compile these sources (bun's test transpiler has no SolidJS JSX support). It is deliberately blocked with a refusal message by `test/bun-test-guard.ts` (wired via `bunfig.toml`); `bash bin/test-which.sh` reports the contract for humans and CI.
