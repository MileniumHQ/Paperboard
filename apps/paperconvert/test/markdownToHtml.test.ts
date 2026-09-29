import { describe, test, expect } from "bun:test";
import { markdownToHtml, escapeHtml } from "../src/lib/pdfConverter";

const body = (md: string) => markdownToHtml(md).split("<body>")[1]!;

describe("markdownToHtml", () => {
  test("markup and script typed in the source is text, not elements", () => {
    const html = body('# Hi <script>alert(1)</script> <img src=x onerror="y">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("<h1>Hi &lt;script&gt;");
  });

  test("javascript: and data: link targets are neutralised", () => {
    expect(body("[x](javascript:alert(1))")).toContain('<a href="#">x</a>');
    expect(body("![x](data:text/html;base64,AAAA)")).toContain('src="#"');
    expect(body("[x](JaVaScRiPt:alert(1))")).toContain('href="#"');
  });

  test("a quote in a link cannot open a new attribute", () => {
    const html = body('[x](https://a.test/" onclick="z)');
    const tag = /<a [^>]*>/.exec(html)![0];
    // only the attribute's own two quotes remain raw; the payload is inert text
    expect(tag.split('"').length - 1).toBe(2);
    expect(tag).toContain("&quot;");
  });

  test("ordinary formatting and safe links still work", () => {
    const html = body("## Title\n\n**bold** [site](https://example.com) [rel](docs/a.md) ![p](img/a.png)");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">site</a>');
    expect(html).toContain('<a href="docs/a.md">rel</a>');
    expect(html).toContain('<img alt="p" src="img/a.png" />');
  });

  test("escapeHtml covers the five characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
