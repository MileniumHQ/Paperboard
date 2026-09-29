import { describe, test, expect } from "bun:test";
import { renderHtmlWithChips } from "../src/lib/richText";

describe("renderHtmlWithChips escaping", () => {
    test("typed markup is shown as text, never as elements", () => {
        const html = renderHtmlWithChips('<img src=x onerror="alert(1)"> & <b>hi</b>');
        expect(html).not.toContain("<img");
        expect(html).not.toContain("<b>");
        expect(html).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;b&gt;hi&lt;/b&gt;");
    });

    test("chip attributes and labels cannot break out of their markup", () => {
        const html = renderHtmlWithChips('{{a"><script>x</script>:"><i>:"onmouseover="y}} tail');
        expect(html).not.toContain("<script");
        expect(html).not.toContain("<i>");
        expect(html).not.toMatch(/data-[a-z-]+="[^"]*"[^>]*\sonmouseover=/);
        expect(html).toContain("actionVariableChip");
        expect(html.endsWith(" tail")).toBe(true);
    });

    test("plain text and a normal chip still render", () => {
        const html = renderHtmlWithChips("hi {{player:Username:person_add}}!");
        expect(html.startsWith("hi ​<span class=\"actionVariableChip\"")).toBe(true);
        expect(html).toContain('data-label="Username"');
        expect(html.endsWith("​!")).toBe(true);
    });
});
