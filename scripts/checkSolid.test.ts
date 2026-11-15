import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDirs, checkSource } from "./check-solid";

const rules = (src: string) => checkSource("Fixture.tsx", src).map((h) => `${h.line}:${h.rule}`);

// The Solid check flags each mechanical mistake and passes its near miss.
describe("the Solid check flags each mistake and passes its near miss", () => {
    test("a JSX prop read again in <Show>, and its callback-child near miss", () => {
        const header = `import { Show, type JSX } from "solid-js";\ntype P = { icon?: JSX.Element; label?: string };\n`;
        expect(rules(`${header}export function A(props: P) {\n    return <Show when={props.icon}>{props.icon}</Show>;\n}\n`)).toEqual([
            "4:read-jsx-prop-twice",
        ]);
        // the callback child reads it once; a string read twice is harmless
        expect(
            rules(
                `${header}export function A(props: P) {\n    return <><Show when={props.icon}>{(i) => i()}</Show><Show when={props.label}>{props.label}</Show></>;\n}\n`,
            ),
        ).toEqual([]);
    });

    test("typeof on a JSX prop then the same prop in the non-string branch, and its string-branch near miss", () => {
        const header = `import { splitProps, type JSX } from "solid-js";\ntype P = { icon: string | JSX.Element };\n`;
        const body = (expr: string) =>
            `${header}export function A(props: P) {\n    const [local] = splitProps(props, ["icon"]);\n    return <b>{${expr}}</b>;\n}\n`;
        expect(rules(body(`typeof local.icon === "string" ? <i>{local.icon}</i> : local.icon`))).toEqual(["5:read-jsx-prop-twice"]);
        expect(rules(body(`typeof local.icon !== "string" ? <i /> : local.icon`))).toEqual([]);
    });

    test("destructured component props, and the splitProps near miss", () => {
        const solid = `import { splitProps } from "solid-js";\n`;
        expect(rules(`${solid}export const A = ({ a }: { a: string }) => <b>{a}</b>;\n`)).toEqual(["2:destructured-props"]);
        expect(rules(`${solid}export function A(props: { a: string }) {\n    const { a } = props;\n    return <b>{a}</b>;\n}\n`)).toEqual([
            "3:destructured-props",
        ]);
        // splitProps keeps reactivity; a lowercase helper returning data is not a component
        expect(
            rules(
                `${solid}export function A(props: { a: string }) {\n    const [local] = splitProps(props, ["a"]);\n    return <b>{local.a}</b>;\n}\nexport const pick = ({ a }: { a: string }) => a;\n`,
            ),
        ).toEqual([]);
    });

    test("onCleanup after an await in an async effect, and the before-the-await near miss", () => {
        const solid = `import { createEffect, on, onCleanup, onMount } from "solid-js";\ndeclare const load: () => Promise<() => void>;\n`;
        expect(rules(`${solid}onMount(async () => {\n    const stop = await load();\n    if (stop) onCleanup(stop);\n});\n`)).toEqual([
            "5:cleanup-after-await",
        ]);
        // registered before the first await; a nested function is opaque by design
        expect(
            rules(
                `${solid}createEffect(on(load, async () => {\n    let stop = () => {};\n    onCleanup(() => stop());\n    stop = await load();\n    const later = () => onCleanup(stop);\n    later();\n}));\n`,
            ),
        ).toEqual([]);
    });

    test("scanning a directory skips fixtures and node_modules", () => {
        const root = mkdtempSync(join(tmpdir(), "check-solid-"));
        try {
            const bad = `export const A = ({ a }: { a: string }) => <b>{a}</b>;\n`;
            for (const dir of ["src", "src/fixtures", "node_modules/x"]) {
                mkdirSync(join(root, dir), { recursive: true });
                writeFileSync(join(root, dir, "A.tsx"), bad);
            }
            expect(checkDirs([root]).map((h) => h.file)).toEqual([join(root, "src", "A.tsx")]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// an empty body, spelled so the silent-catch grep doesn't take the fixtures for code
const EMPTY = "{}";
const ruleIn = (file: string, src: string) => checkSource(file, src).map((h) => `${h.line}:${h.rule}`);

// Each house rule: one hit, one allowed with a reason, one near miss.
describe("the house rules flag each break, honour a reasoned quiet marker, and pass the near miss", () => {
    test("a catch that only logs, and a .catch that swallows (Fail loudly)", () => {
        expect(rules(`try {\n    run();\n} catch (e) {\n    console.error(e);\n}\n`)).toEqual(["3:swallowed-error"]);
        expect(rules(`void run().catch(() => ${EMPTY});\nvoid run().catch(() => undefined);\nvoid run().catch(console.warn);\n`)).toEqual([
            "1:swallowed-error",
            "2:swallowed-error",
            "3:swallowed-error",
        ]);
        // a reasoned marker allows it, inside the block or on the line above
        expect(rules(`try {\n    run();\n} catch (e) {\n    // quiet: the logger cannot report its own failure\n    console.error(e);\n}\n`)).toEqual([]);
        expect(rules(`// quiet: shutdown, nothing is left to show it\nvoid run().catch(() => ${EMPTY});\n`)).toEqual([]);
        // a marker with no reason is itself a hit
        expect(rules(`void run().catch(() => ${EMPTY}); // quiet:\n`)).toEqual(["1:swallowed-error"]);
        // a catch that rethrows or sets state does something the user sees
        expect(rules(`try {\n    run();\n} catch (e) {\n    console.error(e);\n    setError(e);\n}\nvoid run().catch((e) => setError(e));\n`)).toEqual([]);
    });

    test("an effect that does not name its dependencies (Effects track what they mean)", () => {
        const solid = `import { createEffect, on } from "solid-js";\ndeclare const a: () => number;\n`;
        expect(rules(`${solid}createEffect(() => console.log(a()));\n`)).toEqual(["3:effect-without-on"]);
        expect(rules(`${solid}// quiet: reads every field of a store on purpose\ncreateEffect(() => console.log(a()));\n`)).toEqual([]);
        expect(rules(`${solid}createEffect(on(a, (v) => console.log(v)));\n`)).toEqual([]);
    });

    test("<For> fed fresh objects (Rows keep their identity)", () => {
        const solid = `import { For } from "solid-js";\ndeclare const rows: () => { id: string }[];\n`;
        expect(rules(`${solid}export const A = () => <For each={rows().map((r) => ({ ...r, on: true }))}>{(r) => <b>{r.id}</b>}</For>;\n`)).toEqual([
            "3:for-fresh-rows",
        ]);
        expect(rules(`${solid}export const A = () => <For each={Object.entries({ a: 1 })}>{(e) => <b>{e[0]}</b>}</For>;\n`)).toEqual(["3:for-fresh-rows"]);
        expect(
            rules(`${solid}// quiet: two fixed rows, nothing to animate\nexport const A = () => <For each={rows().map((r) => ({ ...r }))}>{(r) => <b>{r.id}</b>}</For>;\n`),
        ).toEqual([]);
        // filtering keeps the same objects; mapping to ids keeps primitives
        expect(
            rules(`${solid}export const A = () => <><For each={rows().filter((r) => r.id)}>{(r) => <b>{r.id}</b>}</For><For each={rows().map((r) => r.id)}>{(id) => <b>{id}</b>}</For></>;\n`),
        ).toEqual([]);
    });

    test("a fixed sleep in a test (Tests are CI), and the deadline near miss", () => {
        expect(ruleIn("a.test.ts", `await Bun.sleep(50);\nawait sleep(50);\nawait new Promise((r) => setTimeout(r, 50));\n`)).toEqual([
            "1:test-sleep",
            "2:test-sleep",
            "3:test-sleep",
        ]);
        expect(ruleIn("test/support/wait.ts", `// quiet: the poll interval of a deadline-bound wait\nawait new Promise((r) => setTimeout(() => r(undefined), 10));\n`)).toEqual([]);
        // a raced deadline is not a wait; outside a test file a sleep is the product's business
        expect(ruleIn("a.test.ts", `await Promise.race([done, new Promise((late) => setTimeout(() => late("timed out"), 5000))]);\n`)).toEqual([]);
        expect(ruleIn("src/retry.ts", `await Bun.sleep(50);\n`)).toEqual([]);
    });

    test("--solid-only leaves the house rules out", () => {
        expect(checkSource("a.test.ts", `void run().catch(() => ${EMPTY});\nawait Bun.sleep(5);\n`, { solidOnly: true })).toEqual([]);
    });

    test("a relative import into another package, and the near misses: its own files, the repo root, a package by name", () => {
        // a file of crane-launcher, by its place in this repository (the packages around it are real)
        const file = join(import.meta.dir, "..", "packages/crane-launcher/src/fixture.ts");
        const hits = (src: string) => checkSource(file, src).map((h) => `${h.line}:${h.rule}`);
        expect(
            hits(
                `import { semverGt } from "../../../apps/paperboard/papercrane/util";\nexport { errorMessage } from "../../paperapi/src/errors";\nconst ui = await import("../../paperui/src/index");\ntype T = typeof import("../../paperapi/src/ws");\n`,
            ),
        ).toEqual(["1:cross-package-import", "2:cross-package-import", "3:cross-package-import", "4:cross-package-import"]);
        expect(
            hits(
                `import { ensureCrane } from "./launcher";\nimport pkg from "../package.json";\nimport { openChrome } from "../../../scripts/testing/chrome";\nimport { semverGt } from "@mileniumhq/release";\n`,
            ),
        ).toEqual([]);
    });
});
