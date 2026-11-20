import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { checkProseSpacing, proseSpacingHits } from "../scripts/check-prose-spacing.mjs";

const hits = (body: string) =>
    proseSpacingHits("Fixture.tsx", `export default () => (\n    <p>\n${body}\n    </p>\n);\n`).map((hit) => `${hit.line}: ${hit.left} | ${hit.right}`);

// The paragraph from install.tsx that rendered "installer.npx" (issue #36).
const INSTALL = [
    `        With Node.js 18 or newer, <PaperCode>npx @mileniumhq/paperboard install</PaperCode> and <PaperCode>npm install -g @mileniumhq/paperboard</PaperCode> run the same installer.`,
    `        <PaperCode>npx @mileniumhq/paperboard</PaperCode> opens Paperboard, and asks to install it first if it isn't installed.`,
];

// A line break is the only space between prose and an element, and JSX drops it.
describe("the prose spacing check flags a line break that is the only space, and passes its near misses", () => {
    test("the sentence end before an element from issue #36, and the same paragraph with its space", () => {
        expect(hits(INSTALL.join("\n"))).toEqual(["3: run the same installer. | <PaperCode>npx @mileniumhq/pap"]);
        expect(hits(INSTALL.join(`{" "}\n`))).toEqual([]);
    });

    test("an element that ends a sentence before text on the next line, and the closing punctuation near miss", () => {
        expect(hits(`        Paperboard says <PaperCode>Pairing is locked.</PaperCode>\n        After the third wrong code, wait.`)).toEqual([
            "3: Pairing is locked.</PaperCode> | After the third wrong code, wa",
        ]);
        expect(hits(`        Write to <PaperLink href="/contact/">us</PaperLink>\n        . It answers.`)).toEqual([]);
    });

    test("two elements across a line break in prose, and an opening bracket before a break", () => {
        expect(hits(`        Two calls. <PaperCode>a</PaperCode>\n        <PaperCode>b</PaperCode> run.`)).toEqual([
            "3: <PaperCode>a</PaperCode> | <PaperCode>b</PaperCode>",
        ]);
        expect(hits(`        It takes a key (\n        <PaperCode>id</PaperCode>). That is all.`)).toEqual([]);
    });

    test("a button's icon and label carry no sentence, so their layout spaces them", () => {
        expect(hits(`        <PaperIcon>add</PaperIcon>\n        New item`)).toEqual([]);
        expect(hits(`        New item\n        <PaperIcon>add</PaperIcon>`)).toEqual([]);
    });

    test("every docs, blog and site page passes", () => {
        expect(checkProseSpacing([fileURLToPath(new URL("../src", import.meta.url))])).toEqual([]);
    });
});
