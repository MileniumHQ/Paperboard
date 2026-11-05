import styles from "./index.module.css";
import { createMemo, For, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { marked, type Token, type Tokens } from "marked";
import { PaperCode } from "../PaperCode";
import { PaperLink } from "../PaperLink";
import { PaperQuote } from "../PaperQuote";
import { PaperSeparator } from "../PaperSeparator";
import { PaperTable } from "../PaperTable";
import { PaperText } from "../PaperText";
import { PaperTextList } from "../PaperTextList";
import type { PaperTextPreset } from "../../types";
import { nestHtml, textOf, tokenizeHtml, type HtmlNode, type HtmlToken } from "./html";

/**
 * Markdown rendered as PaperUI elements — never as innerHTML. The consumer
 * owns the trust decision: `allowImages` is off by default because a remote
 * image is a beacon, and raw HTML in the source is shown as literal text, not
 * executed, unless `allowHtml` draws it.
 *
 * An image alone in its paragraph with a title, `![alt](src "Caption")`, is a
 * figure: the title renders as its visible caption instead of a tooltip.
 */
export interface PaperMarkdownProps {
    text: string;
    preset?: PaperTextPreset;
    /**
     * Render `![alt](src)`. Off by default: remote images are beacons. A
     * titled image alone in a paragraph renders as a captioned figure.
     */
    allowImages?: boolean;
    /**
     * Draw HTML in the source, such as a README's `<h2>` or
     * `<p align="center">`, as the same PaperUI elements Markdown gets. Off by
     * default: raw HTML shows as its source. Only formatting is kept: no
     * attribute other than a link's href and title or an image's src, alt,
     * title, width and height, nothing that runs or styles, and the same link
     * and image rules as Markdown. An embed (iframe, video, audio) becomes a
     * link to its address.
     */
    allowHtml?: boolean;
    /**
     * Render an image yourself: called for every `![alt](src "title")` before
     * the default, with the src as written, any scheme (refusing an unsafe one
     * is yours to do). `block` is true for an image alone in its paragraph,
     * which then renders in place of the paragraph. Return undefined for the
     * default rendering. This is how a panel shows its own media, such as
     * `![a cat](attachment:abc123)`.
     */
    renderImage?: (image: MarkdownImage) => JSX.Element | undefined;
    class?: string;
    classList?: JSX.HTMLAttributes<HTMLDivElement>["classList"];
}

export interface MarkdownImage {
    src: string;
    alt: string;
    title: string | null;
    block: boolean;
}

const HEADING_PRESETS: PaperTextPreset[] = [
    "header",
    "subheader",
    "title",
    "subtitle",
];

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

// http(s), mailto, and relative targets only — a markdown document must not be
// able to smuggle a javascript: or data: URL into an href. The scheme is read
// the way a browser's URL parser reads it: tab and newline removed anywhere,
// C0 controls and spaces trimmed from both ends, so "java\tscript:" is
// javascript: here too.
function safeHref(raw: string | null | undefined): string | null {
    const value = (raw ?? "").replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
    if (!value) return null;
    if (/^(https?:|mailto:)/i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
    return value;
}

// images additionally refuse data: payloads, which are an unbounded decode
// and a tracking vector even when the page never navigates
function safeImageSrc(raw: string | null | undefined): string | null {
    const value = safeHref(raw);
    if (!value) return null;
    if (/^data:/i.test(value)) return null;
    return value;
}

// the paragraph's one image, if it has nothing else but surrounding whitespace
function soleImage(tokens: Token[] | undefined): Tokens.Image | null {
    const content = (tokens ?? []).filter(
        (token) => !(token.type === "text" && !token.raw.trim()),
    );
    return content.length === 1 && content[0].type === "image"
        ? (content[0] as Tokens.Image)
        : null;
}

export function PaperMarkdown(props: PaperMarkdownProps) {
    const [local] = splitProps(props, [
        "text",
        "preset",
        "allowImages",
        "allowHtml",
        "renderImage",
        "class",
        "classList",
    ]);

    const textPreset = () => local.preset ?? "body";

    // gfm + breaks are lexer options, not a global marked.use(): a global
    // mutation would leak these settings into every other marked consumer.
    const tokens = createMemo<Token[]>(() =>
        marked.lexer(local.text ?? "", { gfm: true, breaks: true }),
    );

    const InlineImage = (image: { src: string; alt: string; title: string | null; width?: string; height?: string }): JSX.Element => {
        const custom = local.renderImage?.({ src: image.src, alt: image.alt, title: image.title, block: false });
        if (custom !== undefined) return custom;
        const src = safeImageSrc(image.src);
        if (!local.allowImages || !src) {
            // no image permission (or an unsafe target): keep the alt
            // text visible so the content is not silently dropped
            return <span>{image.alt}</span>;
        }
        return (
            <img
                src={src}
                alt={image.alt}
                title={image.title ?? undefined}
                width={image.width}
                height={image.height}
                // a height alone sizes the image (a badge row): the root's
                // height: auto, there for width-scaled images, would undo it
                style={image.height && !image.width ? { height: `${image.height}px`, width: "auto" } : undefined}
                loading="lazy"
            />
        );
    };

    const Inline = (inlineProps: { tokens: Token[] | undefined }): JSX.Element => {
        const tokens = inlineProps.tokens ?? [];
        if (!local.allowHtml || !tokens.some((token) => token.type === "html")) {
            return (
                <For each={tokens}>
                    {(token) => <InlineToken token={token} />}
                </For>
            );
        }
        // an inline <b> and its </b> are separate tokens with Markdown between
        // them: nest them first so the tag wraps what it encloses
        const nodes = nestHtml<Token>(
            tokens.flatMap((token): (HtmlToken | { type: "leaf"; leaf: Token })[] =>
                token.type === "html" ? tokenizeHtml(token.raw) : [{ type: "leaf", leaf: token }],
            ),
        );
        return <HtmlInline nodes={nodes} />;
    };

    type Node = HtmlNode<Token>;
    type Element = Extract<Node, { type: "element" }>;
    const leafText = (token: Token) => (token as Tokens.Text).text ?? token.raw;
    const elements = (nodes: Node[]) => nodes.filter((node): node is Element => node.type === "element");

    const HtmlInline = (htmlProps: { nodes: Node[] }): JSX.Element => (
        <For each={htmlProps.nodes}>
            {(node) =>
                node.type === "text" ? node.text
                : node.type === "leaf" ? <InlineToken token={node.leaf} />
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
                const href = safeHref(el.attrs.href);
                if (!href) return children();
                return <PaperLink href={href} title={el.attrs.title}>{children()}</PaperLink>;
            }
            case "img":
                return (
                    <InlineImage
                        src={el.attrs.src ?? ""}
                        alt={el.attrs.alt ?? ""}
                        title={el.attrs.title ?? null}
                        width={pixels(el.attrs.width)}
                        height={pixels(el.attrs.height)}
                    />
                );
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
                        <PaperText preset={textPreset()} as="div">
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
                <PaperText preset={HEADING_PRESETS[Math.min(depth, 4) - 1]} as={el.tag}>
                    {inline()}
                </PaperText>
            );
        }
        switch (el.tag) {
            case "p":
                return <PaperText preset={textPreset()} as="p">{inline()}</PaperText>;
            case "dt":
            case "dd":
            case "figcaption":
                return <PaperText preset={textPreset()} as="div">{inline()}</PaperText>;
            case "summary":
                return <summary><PaperText preset={textPreset()} as="span">{inline()}</PaperText></summary>;
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
                        preset={textPreset()}
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

    const InlineToken = (tokenProps: { token: Token }): JSX.Element => {
        const token = tokenProps.token;
        switch (token.type) {
            case "strong":
                return (
                    <strong>
                        <Inline tokens={(token as Tokens.Strong).tokens} />
                    </strong>
                );
            case "em":
                return (
                    <em>
                        <Inline tokens={(token as Tokens.Em).tokens} />
                    </em>
                );
            case "del":
                return (
                    <del>
                        <Inline tokens={(token as Tokens.Del).tokens} />
                    </del>
                );
            case "codespan":
                return <PaperCode>{(token as Tokens.Codespan).text}</PaperCode>;
            case "br":
                return <br />;
            case "checkbox":
                return (
                    <span>
                        {" "}
                        {(token as Tokens.Checkbox).checked ? "[x]" : "[ ]"}{" "}
                    </span>
                );
            case "link": {
                const link = token as Tokens.Link;
                const href = safeHref(link.href);
                if (!href) return <Inline tokens={link.tokens} />;
                return (
                    <PaperLink href={href} title={link.title ?? undefined}>
                        <Inline tokens={link.tokens} />
                    </PaperLink>
                );
            }
            case "image": {
                const image = token as Tokens.Image;
                return <InlineImage src={image.href} alt={image.text} title={image.title ?? null} />;
            }
            case "html":
                // reached only without allowHtml, or for a lone end tag: the source as text
                return local.allowHtml ? null : (token as Tokens.HTML).raw;
            case "escape":
                return (token as Tokens.Escape).text;
            case "text": {
                const text = token as Tokens.Text;
                return text.tokens ? (
                    <Inline tokens={text.tokens} />
                ) : (
                    text.text
                );
            }
            default: {
                // raw HTML etc. is shown as source text, never parsed
                const generic = token as Tokens.Generic;
                return generic.raw ?? (token as Tokens.Text).text ?? "";
            }
        }
    };

    const ListItem = (itemProps: { item: Tokens.ListItem }): JSX.Element => (
        <PaperTextList.Item>
            <For each={itemProps.item.tokens}>
                {(child) => {
                    if (child.type === "text") {
                        return (
                            <Inline
                                tokens={
                                    (child as Tokens.Text).tokens ?? [child]
                                }
                            />
                        );
                    }
                    if (child.type === "paragraph") {
                        return (
                            <Inline
                                tokens={(child as Tokens.Paragraph).tokens}
                            />
                        );
                    }
                    return <Block token={child} />;
                }}
            </For>
        </PaperTextList.Item>
    );

    const Block = (blockProps: { token: Token }): JSX.Element => {
        const token = blockProps.token;
        switch (token.type) {
            case "heading": {
                const heading = token as Tokens.Heading;
                const preset =
                    HEADING_PRESETS[Math.min(heading.depth, 4) - 1] ??
                    "subtitle";
                return (
                    <PaperText preset={preset} as={`h${heading.depth}`}>
                        <Inline tokens={heading.tokens} />
                    </PaperText>
                );
            }
            case "paragraph": {
                const paragraph = token as Tokens.Paragraph;
                const image = soleImage(paragraph.tokens);
                const custom = image
                    ? local.renderImage?.({ src: image.href, alt: image.text, title: image.title ?? null, block: true })
                    : undefined;
                if (custom !== undefined) return <div class={styles.media}>{custom}</div>;
                const src = image ? safeImageSrc(image.href) : null;
                if (local.allowImages && image?.title && src) {
                    return (
                        <figure class={styles.figure}>
                            <img src={src} alt={image.text} loading="lazy" />
                            <PaperText
                                preset="caption"
                                color="text-subtle"
                                as="figcaption"
                            >
                                {image.title}
                            </PaperText>
                        </figure>
                    );
                }
                return (
                    <PaperText preset={textPreset()} as="p">
                        <Inline tokens={paragraph.tokens} />
                    </PaperText>
                );
            }
            case "list": {
                const list = token as Tokens.List;
                return (
                    <PaperTextList
                        ordered={list.ordered}
                        start={list.start || undefined}
                        preset={textPreset()}
                    >
                        <For each={list.items}>
                            {(item) => <ListItem item={item} />}
                        </For>
                    </PaperTextList>
                );
            }
            case "blockquote":
                return (
                    <PaperQuote>
                        <Blocks tokens={(token as Tokens.Blockquote).tokens} />
                    </PaperQuote>
                );
            case "code": {
                const code = token as Tokens.Code;
                return (
                    <PaperCode
                        block
                        copyable
                        language={code.lang || undefined}
                    >
                        {code.text}
                    </PaperCode>
                );
            }
            case "table": {
                const table = token as Tokens.Table;
                return (
                    <PaperTable>
                        <thead>
                            <tr>
                                <For each={table.header}>
                                    {(cell) => (
                                        <th>
                                            <Inline tokens={cell.tokens} />
                                        </th>
                                    )}
                                </For>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={table.rows}>
                                {(row) => (
                                    <tr>
                                        <For each={row}>
                                            {(cell) => (
                                                <td>
                                                    <Inline
                                                        tokens={cell.tokens}
                                                    />
                                                </td>
                                            )}
                                        </For>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </PaperTable>
                );
            }
            case "hr":
                return <PaperSeparator />;
            case "space":
            case "def":
                return null;
            case "html":
                if (local.allowHtml) {
                    return (
                        <div class={styles.html}>
                            <HtmlBlocks nodes={nestHtml(tokenizeHtml((token as Tokens.HTML).raw))} />
                        </div>
                    );
                }
                return (
                    <PaperText preset={textPreset()} as="p">
                        {(token as Tokens.HTML).raw}
                    </PaperText>
                );
            default: {
                const generic = token as Tokens.Generic;
                return (
                    <PaperText preset={textPreset()} as="p">
                        {generic.raw ?? ""}
                    </PaperText>
                );
            }
        }
    };

    const Blocks = (blocksProps: { tokens: Token[] }): JSX.Element => (
        <For each={blocksProps.tokens}>
            {(token) => <Block token={token} />}
        </For>
    );

    return (
        <div
            class={[styles.PaperMarkdown, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            <Blocks tokens={tokens()} />
        </div>
    );
}
