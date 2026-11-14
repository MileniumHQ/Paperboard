import { describe, expect, test } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperCode, PaperEditor } from "../index";

const python = 'def greet(name):\n    return "hi " + name\n';

function codeBlock(language?: string) {
    return render(() => (
        <PaperCode block language={language}>
            {python}
        </PaperCode>
    )).container;
}

describe("code highlighting", () => {
    test("a language PaperUI has no grammar for is shown as written, in PaperCode as in PaperEditor", () => {
        const code = codeBlock("python");
        expect(code.querySelectorAll(".token").length).toBe(0);
        expect(code.querySelector("pre")?.textContent).toContain('return "hi " + name');

        const editor = render(() => <PaperEditor value={python} language="python" />).container;
        expect(editor.querySelectorAll(".token").length).toBe(0);
    });

    test("a block with no language is highlighted as TSX", () => {
        expect(codeBlock().querySelector(".token.keyword")?.textContent).toBe("return");
    });
});
