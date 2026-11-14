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
        const solid = `import { createEffect, onCleanup, onMount } from "solid-js";\ndeclare const load: () => Promise<() => void>;\n`;
        expect(rules(`${solid}onMount(async () => {\n    const stop = await load();\n    if (stop) onCleanup(stop);\n});\n`)).toEqual([
            "5:cleanup-after-await",
        ]);
        // registered before the first await; a nested function is opaque by design
        expect(
            rules(
                `${solid}createEffect(async () => {\n    let stop = () => {};\n    onCleanup(() => stop());\n    stop = await load();\n    const later = () => onCleanup(stop);\n    later();\n});\n`,
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
