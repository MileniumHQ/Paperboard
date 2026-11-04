import { parse } from "node-html-parser";

// Turns a prerendered docs page into Markdown, the form agents read: the
// per-page .md files, /llms.txt, and /llms-full.txt all come from here. It
// reads the page's <article>, so it sees exactly what a visitor sees, including
// tables and lists the page builds from data. Live demos are marked with
// `data-docs-demo` and left out: their markup is the component, not text.

const ORIGIN = "https://paperboard.dev";

// Elements that never carry text a reader needs.
const SKIP_TAGS = new Set(["button", "svg", "input", "select", "textarea", "script", "style", "canvas", "audio", "video", "img"]);
const BLOCK_TAGS = new Set([
    "div", "p", "section", "article", "header", "footer", "aside", "nav", "main", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table", "ul", "ol", "li", "blockquote", "hr", "dl", "dt", "dd",
]);
const HEADING_PRESETS = { header: 1, subheader: 2, title: 3 };

function skip(el) {
    if (el.nodeType !== 1) return false;
    const tag = el.rawTagName?.toLowerCase();
    return (
        SKIP_TAGS.has(tag) ||
        el.getAttribute("aria-hidden") === "true" ||
        el.hasAttribute("data-docs-demo") ||
        el.hasAttribute("hidden")
    );
}

function isBlock(el) {
    if (el.nodeType !== 1) return false;
    return BLOCK_TAGS.has(el.rawTagName?.toLowerCase()) || el.hasAttribute("data-preset");
}

function headingLevel(el) {
    const tag = el.rawTagName?.toLowerCase();
    const m = /^h([1-6])$/.exec(tag ?? "");
    if (m) return Number(m[1]);
    return HEADING_PRESETS[el.getAttribute("data-preset")] ?? 0;
}

function decode(text) {
    return text
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&#x27;", "'")
        .replaceAll("&nbsp;", " ")
        .replaceAll("&amp;", "&");
}

function absolute(href) {
    if (!href) return "";
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return href;
    return ORIGIN + (href.startsWith("/") ? href : `/${href}`);
}

function inline(node) {
    if (node.nodeType === 3) return decode(node.rawText).replace(/\s+/g, " ");
    if (node.nodeType !== 1 || skip(node)) return "";
    const tag = node.rawTagName?.toLowerCase();
    const inner = () => node.childNodes.map(inline).join("");
    if (tag === "code") {
        const text = node.text;
        const fence = text.includes("`") ? "``" : "`";
        return `${fence}${text}${fence}`;
    }
    if (tag === "a") {
        const text = inner().trim();
        const href = absolute(node.getAttribute("href"));
        return href && text ? `[${text}](${href})` : text;
    }
    if (tag === "strong" || tag === "b") {
        const text = inner().trim();
        return text ? `**${text}**` : "";
    }
    if (tag === "em" || tag === "i") {
        const text = inner().trim();
        return text ? `_${text}_` : "";
    }
    if (tag === "br") return "\n";
    return inner();
}

function cell(node) {
    return inline(node).replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}

function table(el) {
    const rows = el.querySelectorAll("tr").map((tr) =>
        tr.childNodes.filter((c) => c.nodeType === 1 && /^t[hd]$/i.test(c.rawTagName)).map(cell),
    ).filter((r) => r.length > 0);
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill("")];
    const [head, ...body] = rows;
    return [
        `| ${pad(head).join(" | ")} |`,
        `| ${Array(width).fill("---").join(" | ")} |`,
        ...body.map((r) => `| ${pad(r).join(" | ")} |`),
    ].join("\n");
}

function list(el, depth) {
    const ordered = el.rawTagName.toLowerCase() === "ol";
    let n = 0;
    const out = [];
    for (const li of el.childNodes) {
        if (li.nodeType !== 1 || li.rawTagName.toLowerCase() !== "li" || skip(li)) continue;
        n += 1;
        const marker = ordered ? `${n}.` : "-";
        const indent = "  ".repeat(depth);
        const textParts = [];
        const nested = [];
        for (const child of li.childNodes) {
            const t = child.rawTagName?.toLowerCase();
            if (t === "ul" || t === "ol") nested.push(list(child, depth + 1));
            else if (child.nodeType === 1 && isBlock(child)) textParts.push(blocks(child).join(" "));
            else textParts.push(inline(child));
        }
        out.push(`${indent}${marker} ${textParts.join("").replace(/\s+/g, " ").trim()}`);
        out.push(...nested);
    }
    return out.join("\n");
}

function blocks(node) {
    const out = [];
    let buffer = "";
    const flush = () => {
        const text = buffer.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
        if (text) out.push(text);
        buffer = "";
    };
    for (const child of node.childNodes) {
        if (child.nodeType === 1 && skip(child)) continue;
        if (!(child.nodeType === 1 && isBlock(child))) {
            buffer += inline(child);
            continue;
        }
        flush();
        const tag = child.rawTagName.toLowerCase();
        const level = headingLevel(child);
        if (level) {
            const text = inline(child).replace(/\s+/g, " ").trim();
            if (text) out.push(`${"#".repeat(level)} ${text}`);
        } else if (tag === "pre") {
            const language = child.getAttribute("data-language") ?? "";
            const code = child.text.replace(/\n+$/, "");
            const fence = code.includes("```") ? "````" : "```";
            out.push(`${fence}${language}\n${code}\n${fence}`);
        } else if (tag === "table") {
            const t = table(child);
            if (t) out.push(t);
        } else if (tag === "ul" || tag === "ol") {
            const l = list(child, 0);
            if (l) out.push(l);
        } else if (tag === "blockquote") {
            const inner = blocks(child).join("\n\n");
            if (inner) out.push(inner.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n"));
        } else if (tag === "hr") {
            out.push("---");
        } else {
            out.push(...blocks(child));
        }
    }
    flush();
    return out;
}

/** The first sentence of the lead, the docs page's search description. */
export function firstSentence(paragraph) {
    const plain = paragraph
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\*\*|__/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const m = /^.+?[.:](?=\s|$)/.exec(plain);
    return (m ? m[0] : plain).replace(/:$/, ".");
}

/**
 * Converts one prerendered docs page. Throws when the page has no <article>,
 * no single h1, or no lead paragraph under it: the build fails rather than
 * publishing a page agents and search engines cannot summarize.
 */
export function docsPageMarkdown(html, path) {
    // <pre> is parsed as markup: a highlighted block is spans inside <code>.
    const root = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
    const article = root.querySelector("article");
    if (!article) throw new Error(`paperdocs: ${path} has no <article>`);
    const h1s = article.querySelectorAll("h1");
    if (h1s.length !== 1) {
        throw new Error(`paperdocs: ${path} needs exactly one <h1> (PaperText preset="header" as="h1"), found ${h1s.length}`);
    }
    const parts = blocks(article);
    const h1 = parts.findIndex((p) => p.startsWith("# "));
    const lead = parts.slice(h1 + 1).find((p) => !/^(#|```|\||-|>|\d+\.)/.test(p));
    if (!lead) throw new Error(`paperdocs: ${path} has no lead paragraph under its title`);
    const description = firstSentence(lead);
    if (description.length > 200) {
        throw new Error(`paperdocs: ${path} lead's first sentence is ${description.length} characters; keep it under 160 (STYLE.md)`);
    }
    return {
        title: parts[h1].slice(2),
        description,
        markdown: `${parts.join("\n\n")}\n`,
    };
}

/** "/docs/paperapi/secrets/" -> "/docs/paperapi/secrets.md" */
export function markdownPath(path) {
    return `${path.replace(/\/$/, "")}.md`;
}
