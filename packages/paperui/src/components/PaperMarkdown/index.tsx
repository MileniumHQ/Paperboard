import styles from "./index.module.css";
import { createMemo, For, splitProps, type JSX } from "solid-js";
import { marked, type Token, type Tokens } from "marked";
import { PaperCode } from "../PaperCode";
import { PaperLink } from "../PaperLink";
import { PaperQuote } from "../PaperQuote";
import { PaperSeparator } from "../PaperSeparator";
import { PaperTable } from "../PaperTable";
import { PaperText } from "../PaperText";
import { PaperTextList } from "../PaperTextList";
import type { PaperTextPreset } from "../../types";

/**
 * Markdown rendered as PaperUI elements — never as innerHTML. The consumer
 * owns the trust decision: `allowImages` is off by default because a remote
 * image is a beacon, and raw HTML in the source is shown as literal text, not
 * executed.
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
    class?: string;
    classList?: JSX.HTMLAttributes<HTMLDivElement>["classList"];
}

const HEADING_PRESETS: PaperTextPreset[] = [
    "header",
    "subheader",
    "title",
    "subtitle",
];

// http(s), mailto, and relative targets only — a markdown document must not be
// able to smuggle a javascript: or data: URL into an href.
function safeHref(raw: string | null | undefined): string | null {
    const value = (raw ?? "").trim();
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
        "class",
        "classList",
    ]);

    const textPreset = () => local.preset ?? "body";

    // gfm + breaks are lexer options, not a global marked.use(): a global
    // mutation would leak these settings into every other marked consumer.
    const tokens = createMemo<Token[]>(() =>
        marked.lexer(local.text ?? "", { gfm: true, breaks: true }),
    );

    const Inline = (inlineProps: { tokens: Token[] | undefined }): JSX.Element => (
        <For each={inlineProps.tokens ?? []}>
            {(token) => <InlineToken token={token} />}
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
                const src = safeImageSrc(image.href);
                if (!local.allowImages || !src) {
                    // no image permission (or an unsafe target): keep the alt
                    // text visible so the content is not silently dropped
                    return <span>{image.text}</span>;
                }
                return (
                    <img
                        src={src}
                        alt={image.text}
                        title={image.title ?? undefined}
                        loading="lazy"
                    />
                );
            }
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
