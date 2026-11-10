// Reads the raw HTML that Markdown from a catalog carries (READMEs, Modrinth
// project pages) into a tree PaperMarkdown draws as PaperUI elements. It never
// hands the source to the browser's parser: it runs the same on the server
// prerender and in the panel, and nothing in it can execute or load.

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
