// The raw HTML that Markdown from a catalog carries (READMEs, Modrinth project
// pages), for PaperMarkdown's allowHtml: read into a tree, then drawn as the
// same PaperUI elements Markdown gets. It never hands the source to the
// browser's parser: it runs the same on the server prerender and in the
// panel, nothing in it can execute, and an image is drawn by PaperMarkdown.
import { For, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperCode } from "../PaperCode";
import { PaperLink } from "../PaperLink";
import { PaperQuote } from "../PaperQuote";
import { PaperSeparator } from "../PaperSeparator";
import { PaperTable } from "../PaperTable";
import { PaperText } from "../PaperText";
import { PaperTextList } from "../PaperTextList";
import type { PaperTextPreset } from "../../types";
import type { MarkdownLink } from ".";
import styles from "./index.module.css";

export interface HtmlTag {
    type: "open";
    tag: string;
    attrs: Record<string, string>;
    /** a void element, `<br/>`, or an embed whose fallback content was skipped */
    closed: boolean;
}

export type HtmlToken =
    | HtmlTag
    | { type: "close"; tag: string }
    | { type: "text"; text: string }
    /**
     * A skipped element whose end tag is not in this fragment: inline Markdown
     * HTML is one tag per fragment, so `<script>`, its text and `</script>`
     * arrive apart. nestHtml drops everything up to the end tag.
     */
    | { type: "skip"; tag: string };

export type HtmlNode<Leaf> =
    | { type: "text"; text: string }
    | { type: "leaf"; leaf: Leaf }
    | { type: "element"; tag: string; attrs: Record<string, string>; children: HtmlNode<Leaf>[] };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// their content is code or another document, never text to read
const SKIPPED = new Set(["script", "style", "template", "textarea", "title", "noscript", "xmp", "svg", "math", "head", "select"]);

// their content is a fallback for browsers without them; the element itself
// is kept (as a link to what it embeds)
const EMBEDS = new Set(["iframe", "video", "audio", "object"]);

const NAMED: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    copy: "©", reg: "®", trade: "™", hellip: "…",
    mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
    ldquo: "“", rdquo: "”", bull: "•", middot: "·",
    times: "×", divide: "÷", deg: "°", laquo: "«",
    raquo: "»", larr: "←", rarr: "→", uarr: "↑",
    darr: "↓", check: "✓", hearts: "♥", star: "☆",
    emsp: " ", ensp: " ", thinsp: " ", zwj: "‍", zwnj: "‌",
};

/** Character references decoded; an unknown name stays as written, like a browser leaves it. */
export function decodeEntities(text: string): string {
    return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ref: string) => {
        if (ref[0] !== "#") return NAMED[ref] ?? NAMED[ref.toLowerCase()] ?? whole;
        const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
        return valid ? String.fromCodePoint(code) : "�";
    });
}

const OPEN = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const CLOSE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function readAttrs(source: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of source.matchAll(ATTR)) {
        const name = match[1].toLowerCase();
        if (name in attrs) continue; // the first one wins, as in a browser
        attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    return attrs;
}

/** The tags and text of an HTML fragment, in order. Comments and declarations are dropped. */
export function tokenizeHtml(source: string): HtmlToken[] {
    const tokens: HtmlToken[] = [];
    let text = "";
    const flush = () => {
        if (text) tokens.push({ type: "text", text: decodeEntities(text) });
        text = "";
    };
    let i = 0;
    while (i < source.length) {
        const lt = source.indexOf("<", i);
        if (lt === -1) {
            text += source.slice(i);
            break;
        }
        text += source.slice(i, lt);
        const rest = source.slice(lt);
        if (rest.startsWith("<!--")) {
            const end = source.indexOf("-->", lt + 4);
            i = end === -1 ? source.length : end + 3;
            continue;
        }
        if (rest.startsWith("<!") || rest.startsWith("<?")) {
            const end = source.indexOf(">", lt);
            i = end === -1 ? source.length : end + 1;
            continue;
        }
        const close = CLOSE.exec(rest);
        if (close) {
            flush();
            tokens.push({ type: "close", tag: close[1].toLowerCase() });
            i = lt + close[0].length;
            continue;
        }
        const open = OPEN.exec(rest);
        if (!open) {
            text += "<";
            i = lt + 1;
            continue;
        }
        flush();
        const tag = open[1].toLowerCase();
        i = lt + open[0].length;
        if (SKIPPED.has(tag) || EMBEDS.has(tag)) {
            if (EMBEDS.has(tag)) tokens.push({ type: "open", tag, attrs: readAttrs(open[2]), closed: true });
            if (!open[3]) {
                const end = source.toLowerCase().indexOf(`</${tag}`, i);
                if (end === -1) {
                    tokens.push({ type: "skip", tag });
                    i = source.length;
                } else {
                    i = source.indexOf(">", end) + 1 || source.length;
                }
            }
            continue;
        }
        tokens.push({ type: "open", tag, attrs: readAttrs(open[2]), closed: VOID.has(tag) || open[3] === "/" });
    }
    flush();
    return tokens;
}

// an open tag of the key closes the open element named by the value, the way
// a browser ends a paragraph or a list item without its end tag
const IMPLIED_END: Record<string, string[]> = {
    p: ["p"],
    li: ["li"],
    tr: ["tr", "td", "th"],
    td: ["td", "th"],
    th: ["td", "th"],
    dt: ["dt", "dd"],
    dd: ["dt", "dd"],
};

// where an implied end stops looking: a nested list's item does not close the outer one
const SCOPES = new Set(["ul", "ol", "table", "dl", "div", "blockquote", "details"]);

/**
 * Nest a token stream into elements. Leaves are items that are not HTML, such
 * as the Markdown tokens between an inline `<b>` and `</b>`. An end tag with no
 * open element is ignored and elements still open at the end are closed.
 */
export function nestHtml<Leaf>(items: (HtmlToken | { type: "leaf"; leaf: Leaf })[]): HtmlNode<Leaf>[] {
    const root: HtmlNode<Leaf>[] = [];
    const stack: Extract<HtmlNode<Leaf>, { type: "element" }>[] = [];
    const children = () => (stack.length ? stack[stack.length - 1].children : root);
    // the skipped element being dropped, and how deep it nests in itself
    let skipping: { tag: string; depth: number } | null = null;
    for (const item of items) {
        if (skipping) {
            const same = "tag" in item && item.tag === skipping.tag;
            if (same && item.type === "close") skipping.depth--;
            else if (same && (item.type === "skip" || (item.type === "open" && !item.closed))) skipping.depth++;
            if (skipping.depth === 0) skipping = null;
            continue;
        }
        if (item.type === "skip") {
            skipping = { tag: item.tag, depth: 1 };
            continue;
        }
        if (item.type === "text" || item.type === "leaf") {
            children().push(item);
            continue;
        }
        if (item.type === "close") {
            const at = stack.map((el) => el.tag).lastIndexOf(item.tag);
            if (at !== -1) stack.length = at;
            continue;
        }
        const ends = IMPLIED_END[item.tag];
        if (ends) {
            for (let at = stack.length - 1; at >= 0 && !SCOPES.has(stack[at].tag); at--) {
                if (ends.includes(stack[at].tag)) {
                    stack.length = at;
                    break;
                }
            }
        }
        const element = { type: "element" as const, tag: item.tag, attrs: item.attrs, children: [] };
        children().push(element);
        if (!item.closed) stack.push(element);
    }
    return root;
}

/** All the text inside nodes, for elements drawn as plain text (code, pre). */
export function textOf<Leaf>(nodes: HtmlNode<Leaf>[], leafText: (leaf: Leaf) => string): string {
    return nodes
        .map((node) =>
            node.type === "text" ? node.text
            : node.type === "leaf" ? leafText(node.leaf)
            : node.tag === "br" ? "\n"
            : textOf(node.children, leafText),
        )
        .join("");
}

const HEADING_PRESETS: PaperTextPreset[] = ["header", "subheader", "title", "subtitle"];

/** the text preset for a heading of `depth` (1 to 6) */
export function headingPreset(depth: number): PaperTextPreset {
    return HEADING_PRESETS[Math.min(depth, 4) - 1];
}

// http(s), mailto, and relative targets only — a markdown document must not be
// able to smuggle a javascript: or data: URL into an href. The scheme is read
// the way a browser's URL parser reads it: tab and newline removed anywhere,
// C0 controls and spaces trimmed from both ends, so "java\tscript:" is
// javascript: here too.
export function safeHref(raw: string | null | undefined): string | null {
    const value = (raw ?? "").replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
    if (!value) return null;
    if (/^(https?:|mailto:)/i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
    return value;
}

// allowHtml: tags drawn as the same element, without any attribute
const INLINE_TAGS: Record<string, string> = {
    b: "strong", strong: "strong", i: "em", em: "em", cite: "em", var: "em",
    s: "del", del: "del", strike: "del", u: "u", ins: "u",
    sup: "sup", sub: "sub", small: "small", mark: "mark", abbr: "abbr", q: "q",
};

// allowHtml: elements that start their own block
const BLOCK_TAGS = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "center", "section", "article",
    "header", "footer", "main", "nav", "aside", "figure", "figcaption", "details",
    "summary", "ul", "ol", "blockquote", "pre", "table", "hr", "dl", "dt", "dd",
]);

// allowHtml: blocks that stay blocks inside a list item or a paragraph
const BLOCK_ANYWHERE = new Set(["ul", "ol", "pre", "table", "blockquote", "hr"]);

const TABLE_PARTS = new Set(["thead", "tbody", "tfoot", "tr"]);

// a width or height attribute in pixels; anything else is dropped
function pixels(value: string | undefined): string | undefined {
    return value && /^\d{1,5}$/.test(value.trim()) ? value.trim() : undefined;
}

export interface HtmlImage {
    src: string;
    alt: string;
    title: string | null;
    width?: string;
    height?: string;
}

export interface HtmlRenderOptions<Leaf> {
    /** the text preset paragraphs and list items use */
    preset: () => PaperTextPreset;
    /** draws a Markdown token between tags */
    leaf: (leaf: Leaf) => JSX.Element;
    /** what a Markdown token between tags reads as, for code and pre */
    leafText: (leaf: Leaf) => string;
    image: (image: HtmlImage) => JSX.Element;
    /** a link drawn by the consumer, or undefined for the default */
    renderLink: (link: MarkdownLink) => JSX.Element | undefined;
}

/** Draws HTML trees as PaperUI elements: `Inline` inside a line, `Blocks` as a container's content. */
export function htmlRenderer<Leaf>(options: HtmlRenderOptions<Leaf>) {
    type Node = HtmlNode<Leaf>;
    type Element = Extract<Node, { type: "element" }>;
    const { leafText } = options;
    const elements = (nodes: Node[]) => nodes.filter((node): node is Element => node.type === "element");

    const HtmlInline = (htmlProps: { nodes: Node[] }): JSX.Element => (
        <For each={htmlProps.nodes}>
            {(node) =>
                node.type === "text" ? node.text
                : node.type === "leaf" ? options.leaf(node.leaf)
                : <HtmlInlineElement element={node} />
            }
        </For>
    );

    const HtmlInlineElement = (elementProps: { element: Element }): JSX.Element => {
        const el = elementProps.element;
        const children = () => <HtmlInline nodes={el.children} />;
        const tag = INLINE_TAGS[el.tag];
        if (tag) return <Dynamic component={tag}>{children()}</Dynamic>;
        if (BLOCK_ANYWHERE.has(el.tag)) return <HtmlBlock element={el} />;
        switch (el.tag) {
            case "code":
            case "tt":
            case "kbd":
                return <PaperCode>{textOf(el.children, leafText)}</PaperCode>;
            case "br":
                return <br />;
            case "a": {
                const custom = options.renderLink({
                    href: el.attrs.href ?? "",
                    title: el.attrs.title ?? null,
                    text: textOf(el.children, leafText),
                    children,
                });
                if (custom !== undefined) return custom;
                const href = safeHref(el.attrs.href);
                if (!href) return children();
                return <PaperLink href={href} title={el.attrs.title}>{children()}</PaperLink>;
            }
            case "img":
                return options.image({
                    src: el.attrs.src ?? "",
                    alt: el.attrs.alt ?? "",
                    title: el.attrs.title ?? null,
                    width: pixels(el.attrs.width),
                    height: pixels(el.attrs.height),
                });
            case "iframe":
            case "video":
            case "audio":
            case "object":
            case "embed": {
                const href = safeHref(el.attrs.src ?? el.attrs.data);
                return href ? <PaperLink href={href}>{href}</PaperLink> : null;
            }
            case "input":
                return el.attrs.type === "checkbox" ? <span> {"checked" in el.attrs ? "[x]" : "[ ]"} </span> : null;
            default:
                // span, font, center and any tag not listed: its content only
                return children();
        }
    };

    // a container's children as blocks: a run of text and inline elements
    // becomes one paragraph, the way a browser boxes it
    const HtmlBlocks = (htmlProps: { nodes: Node[] }): JSX.Element => {
        const groups: (Element | Node[])[] = [];
        for (const node of htmlProps.nodes) {
            if (node.type === "element" && BLOCK_TAGS.has(node.tag)) groups.push(node);
            else if (Array.isArray(groups[groups.length - 1])) (groups[groups.length - 1] as Node[]).push(node);
            else groups.push([node]);
        }
        const blank = (run: Node[]) => run.every((node) => node.type === "text" && !node.text.trim());
        return (
            <For each={groups}>
                {(group) =>
                    !Array.isArray(group) ? <HtmlBlock element={group} />
                    : blank(group) ? null
                    : (
                        <PaperText preset={options.preset()} as="div">
                            <HtmlInline nodes={group} />
                        </PaperText>
                    )
                }
            </For>
        );
    };

    const HtmlBlock = (blockProps: { element: Element }): JSX.Element => {
        const el = blockProps.element;
        const inline = () => <HtmlInline nodes={el.children} />;
        const heading = /^h([1-6])$/.exec(el.tag);
        if (heading) {
            const depth = Number(heading[1]);
            return (
                <PaperText preset={headingPreset(depth)} as={el.tag}>
                    {inline()}
                </PaperText>
            );
        }
        switch (el.tag) {
            case "p":
                return <PaperText preset={options.preset()} as="p">{inline()}</PaperText>;
            case "dt":
            case "dd":
            case "figcaption":
                return <PaperText preset={options.preset()} as="div">{inline()}</PaperText>;
            case "summary":
                return <summary><PaperText preset={options.preset()} as="span">{inline()}</PaperText></summary>;
            case "details": {
                const summary = el.children.find((node) => node.type === "element" && node.tag === "summary");
                return (
                    <details>
                        {summary ? <HtmlBlock element={summary as Element} /> : null}
                        <div class={styles.html}>
                            <HtmlBlocks nodes={el.children.filter((node) => node !== summary)} />
                        </div>
                    </details>
                );
            }
            case "ul":
            case "ol":
                return (
                    <PaperTextList
                        ordered={el.tag === "ol"}
                        start={Number(el.attrs.start) || undefined}
                        preset={options.preset()}
                    >
                        <For each={elements(el.children)}>
                            {(item) => (
                                <PaperTextList.Item>
                                    <HtmlInline nodes={item.tag === "li" ? item.children : [item]} />
                                </PaperTextList.Item>
                            )}
                        </For>
                    </PaperTextList>
                );
            case "blockquote":
                return (
                    <PaperQuote>
                        <HtmlBlocks nodes={el.children} />
                    </PaperQuote>
                );
            case "pre":
                return (
                    <PaperCode block copyable>
                        {textOf(el.children, leafText).replace(/^\n/, "")}
                    </PaperCode>
                );
            case "table":
                return (
                    <PaperTable>
                        <HtmlTableRows nodes={el.children} />
                    </PaperTable>
                );
            case "hr":
                return <PaperSeparator />;
            default:
                // div, center, section and the other containers
                return (
                    <div class={styles.html}>
                        <HtmlBlocks nodes={el.children} />
                    </div>
                );
        }
    };

    // a table's sections, rows and cells: text between them is markup
    // whitespace, which a browser moves out of the table too
    const HtmlTableRows = (tableProps: { nodes: Node[] }): JSX.Element => (
        <For each={elements(tableProps.nodes)}>
            {(el) =>
                TABLE_PARTS.has(el.tag) ? (
                    <Dynamic component={el.tag}>
                        <HtmlTableRows nodes={el.children} />
                    </Dynamic>
                ) : el.tag === "td" || el.tag === "th" ? (
                    <Dynamic component={el.tag} colSpan={pixels(el.attrs.colspan)} rowSpan={pixels(el.attrs.rowspan)}>
                        <HtmlInline nodes={el.children} />
                    </Dynamic>
                ) : null
            }
        </For>
    );

    return { Inline: HtmlInline, Blocks: HtmlBlocks };
}
