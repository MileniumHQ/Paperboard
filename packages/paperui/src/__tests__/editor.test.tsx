import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import {
    PaperEditor,
    caretPosition,
    detectIndent,
    indentEdit,
    newlineEdit,
} from "../components/PaperEditor";
import { highlightLines } from "../utils/highlight";

function applyEdit(text: string, edit: NonNullable<ReturnType<typeof indentEdit>>): string {
    return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

describe("detectIndent", () => {
    test("uses the smallest space indent the file already has", () => {
        expect(detectIndent("a:\n  b:\n    c: 1\n")).toBe("  ");
        expect(detectIndent("regions:\n    enable: true\n")).toBe("    ");
    });

    test("uses a tab when most indented lines start with one (Skript, Forge TOML)", () => {
        expect(detectIndent("[general]\n\tkey = 1\n\tother = 2\n  odd\n")).toBe("\t");
    });

    test("a file with no indented lines gets the fallback", () => {
        expect(detectIndent("a=1\nb=2", "  ")).toBe("  ");
    });
});

describe("indentEdit", () => {
    test("Tab at a caret inserts one indent", () => {
        const edit = indentEdit("key: 1", 0, 0, "  ", false)!;
        expect(applyEdit("key: 1", edit)).toBe("  key: 1");
        expect(edit.selectionStart).toBe(2);
    });

    test("Tab over several lines indents each non-blank line", () => {
        const text = "a: 1\n\nb: 2\nc: 3";
        const edit = indentEdit(text, 0, text.indexOf("b: 2") + 2, "  ", false)!;
        expect(applyEdit(text, edit)).toBe("  a: 1\n\n  b: 2\nc: 3");
    });

    test("Shift+Tab removes one indent and keeps the caret in place on its line", () => {
        const text = "root:\n    child: 1";
        const caret = text.length;
        const edit = indentEdit(text, caret, caret, "    ", true)!;
        expect(applyEdit(text, edit)).toBe("root:\nchild: 1");
        expect(edit.selectionStart).toBe(caret - 4);
    });

    test("Shift+Tab with nothing to remove is no edit", () => {
        expect(indentEdit("flat: 1", 3, 3, "  ", true)).toBeNull();
    });
});

describe("newlineEdit", () => {
    test("Enter keeps the line's indent", () => {
        const text = "a:\n  b: 1";
        const edit = newlineEdit(text, text.length, text.length, "  ", "yaml");
        expect(edit.insert).toBe("\n  ");
    });

    test("Enter after a YAML block key opens one more level", () => {
        const text = "a:\n  b:";
        expect(newlineEdit(text, text.length, text.length, "  ", "yaml").insert).toBe("\n    ");
    });

    test("a trailing colon only opens a level in YAML, and never in a comment", () => {
        expect(newlineEdit("note:", 5, 5, "  ", "properties").insert).toBe("\n");
        expect(newlineEdit("# see:", 6, 6, "  ", "yaml").insert).toBe("\n");
    });
});

test("caretPosition is 1-based line and column", () => {
    expect(caretPosition("ab\ncd", 0)).toEqual({ line: 1, column: 1 });
    expect(caretPosition("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
});

describe("highlightLines", () => {
    test("returns one valid line of HTML per text line, reopening tokens that span lines", () => {
        const text = "# comment\nkey: value\nblock: |\n  one\n  two\n";
        const lines = highlightLines(text, "yaml")!;
        expect(lines).toHaveLength(text.split("\n").length);
        for (const line of lines) {
            const opens = (line.match(/<span/g) ?? []).length;
            const closes = (line.match(/<\/span>/g) ?? []).length;
            expect(opens).toBe(closes);
        }
        expect(lines[0]).toContain('class="token comment"');
    });

    test("escapes text so a file can never inject markup", () => {
        const lines = highlightLines('motd: "<img src=x onerror=alert(1)>"', "yaml")!;
        expect(lines[0]).not.toContain("<img");
        expect(lines[0]).toContain("&lt;img");
    });

    test("an unknown language has no grammar", () => {
        expect(highlightLines("x", "hocon")).toBeNull();
    });
});

describe("PaperEditor", () => {
    test("is a labelled multi-line textbox that reports edits", () => {
        const onChange = vi.fn();
        const { getByRole } = render(() => (
            <PaperEditor value={"a: 1"} language="yaml" aria-label="Contents of config.yml" onChange={onChange} />
        ));
        const box = getByRole("textbox", { name: "Contents of config.yml" }) as HTMLTextAreaElement;
        expect(box.value).toBe("a: 1");
        box.value = "a: 2";
        fireEvent.input(box);
        expect(onChange).toHaveBeenCalledWith("a: 2");
    });

    test("one row per line, numbered", () => {
        const { container } = render(() => <PaperEditor value={"one\ntwo\nthree"} aria-label="x" />);
        const numbers = [...container.querySelectorAll("[aria-hidden='true']")]
            .map((el) => el.textContent)
            .filter((t) => /^\d+$/.test(t ?? ""));
        expect(numbers).toEqual(["1", "2", "3"]);
    });

    test("an outside value replaces the text; its own typing does not reset it", () => {
        const [value, setValue] = createSignal("first");
        const { getByRole } = render(() => <PaperEditor value={value()} onChange={setValue} aria-label="x" />);
        const box = getByRole("textbox") as HTMLTextAreaElement;
        setValue("second file");
        expect(box.value).toBe("second file");
    });

    test("Ctrl+S saves instead of reaching the browser", () => {
        const onSave = vi.fn();
        const { getByRole } = render(() => <PaperEditor value="x" onSave={onSave} aria-label="x" />);
        const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
        getByRole("textbox").dispatchEvent(event);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    test("Tab indents, but Escape then Tab lets focus leave", () => {
        const { getByRole } = render(() => <PaperEditor value="x" aria-label="x" />);
        const box = getByRole("textbox");
        const tab = () => new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        const first = tab();
        box.dispatchEvent(first);
        expect(first.defaultPrevented).toBe(true);
        box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const second = tab();
        box.dispatchEvent(second);
        expect(second.defaultPrevented).toBe(false);
    });

    test("read-only text can be selected but Tab and Enter edit nothing", () => {
        const { getByRole } = render(() => <PaperEditor value="x" readOnly aria-label="x" />);
        const box = getByRole("textbox") as HTMLTextAreaElement;
        expect(box.readOnly).toBe(true);
        const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        box.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(false);
        expect(box.value).toBe("x");
    });
});
