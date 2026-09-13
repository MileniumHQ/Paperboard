// Wired into bunfig.toml under [test].preload, so this only runs inside
// `bun test`. It refuses loudly instead of letting the suite run against a
// runtime that cannot compile SolidJS tsx.
//
// Plain `bun test` cannot work in this repo: bun's test transpiler has no
// SolidJS JSX support, so the DOM tests fail with misleading errors (React
// fallback or SSR `notSup`) rather than a clean refusal.
// (@paperui/dom-requires-vitest contract — see README.)
throw new Error(
    [
        "",
        "PaperUI sources are SolidJS — `bun test` cannot compile them.",
        "Run the suite with vitest instead:",
        "",
        "    bun run test",
        "",
        "(@paperui/dom-requires-vitest — see README)",
        "",
    ].join("\n"),
);
