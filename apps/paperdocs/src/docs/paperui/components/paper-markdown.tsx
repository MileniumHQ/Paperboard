import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperMarkdown,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const sample = [
    "## Heading",
    "",
    "Some **bold**, *italic*, and `code` text with a [link](https://paperboard.dev).",
    "",
    "- First",
    "- Second",
    "",
    "> A quote",
    "",
    "| Name | Count |",
    "| --- | --- |",
    "| One | 1 |",
].join("\n");

export default function PaperMarkdownDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperMarkdown</PaperText>
            <PaperText preset="body" as="p">
                PaperMarkdown renders a Markdown string as PaperUI components, never as HTML.
                Use it for text you did not write, such as a model's reply, a README, or a changelog from a server.
                Raw HTML in the source shows as literal text, links are filtered by scheme, and images stay off until you allow them.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the Markdown in <PaperCode>text</PaperCode>.
                The component re-renders when the string changes, so you can stream text into it.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperMarkdown text={sample} />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperMarkdown } from "@mileniumhq/paperui";

const text = [
    "## Heading",
    "",
    "Some **bold**, *italic*, and \`code\` text with a [link](https://paperboard.dev).",
    "",
    "- First",
    "- Second",
    "",
    "> A quote",
    "",
    "| Name | Count |",
    "| --- | --- |",
    "| One | 1 |",
].join("\\n");

export function Example() {
    return <PaperMarkdown text={text} />;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperMarkdownProps does not extend the HTML attributes. Only the props below exist.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>text</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The Markdown source. GitHub-flavored Markdown, with a single line break drawn as a line break.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>preset</PaperCode></td>
                        <td><PaperCode>PaperTextPreset</PaperCode></td>
                        <td><PaperCode>"body"</PaperCode></td>
                        <td>The <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink> preset of paragraphs and list items. Headings keep their own presets.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>allowImages</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws <PaperCode>![alt](src)</PaperCode> as an image. Off, an image shows its alt text. A remote image tells its server who is reading, so turn this on only for sources you trust.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>allowHtml</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws HTML in the source as the same components Markdown gets. Off, HTML shows as its source. See HTML.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>renderImage</PaperCode></td>
                        <td><PaperCode>(image: MarkdownImage) =&gt; JSX.Element | undefined</PaperCode></td>
                        <td>No default</td>
                        <td>Draws images yourself. See Custom images.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the wrapping <PaperCode>div</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="markdown-image">MarkdownImage</PaperText>
            <PaperText preset="body" as="p">
                The object <PaperCode>renderImage</PaperCode> receives. It is exported from <PaperCode>@mileniumhq/paperui</PaperCode>.
            </PaperText>
            <PaperCode block language="ts">
{`interface MarkdownImage {
    src: string;          // the address as written in the Markdown, any scheme
    alt: string;          // the text in the brackets
    title: string | null; // the quoted title after the address, if any
    block: boolean;       // true for an image alone in its paragraph
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="rendering">What each part becomes</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Markdown</th>
                        <th>Rendered as</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Headings <PaperCode>#</PaperCode> to <PaperCode>######</PaperCode></td>
                        <td><PaperCode>PaperText</PaperCode> with the real <PaperCode>h1</PaperCode> to <PaperCode>h6</PaperCode> element. Level 1 uses the <PaperCode>header</PaperCode> preset, 2 <PaperCode>subheader</PaperCode>, 3 <PaperCode>title</PaperCode>, and 4 to 6 <PaperCode>subtitle</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Paragraphs</td>
                        <td><PaperCode>PaperText</PaperCode> as a <PaperCode>p</PaperCode>, with <PaperCode>preset</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Bold, italic, strikethrough</td>
                        <td><PaperCode>strong</PaperCode>, <PaperCode>em</PaperCode>, and <PaperCode>del</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Inline code</td>
                        <td><PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td>Code fences</td>
                        <td>A block <PaperCode>PaperCode</PaperCode> with a copy button. The fence's language is passed as <PaperCode>language</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Links</td>
                        <td><PaperLink href="/docs/paperui/paperlink/">PaperLink</PaperLink>. See Links.</td>
                    </tr>
                    <tr>
                        <td>Lists</td>
                        <td><PaperLink href="/docs/paperui/papertextlist/">PaperTextList</PaperLink>, ordered lists keeping their start number. Lists nest.</td>
                    </tr>
                    <tr>
                        <td>Task list boxes</td>
                        <td>The text <PaperCode>[x]</PaperCode> or <PaperCode>[ ]</PaperCode>. They are not checkboxes.</td>
                    </tr>
                    <tr>
                        <td>Block quotes</td>
                        <td><PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> with the monochrome look.</td>
                    </tr>
                    <tr>
                        <td>Tables</td>
                        <td><PaperLink href="/docs/paperui/papertable/">PaperTable</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td>Horizontal rules</td>
                        <td><PaperLink href="/docs/paperui/paperseparator/">PaperSeparator</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td>Raw HTML</td>
                        <td>Its source, as text, unless <PaperCode>allowHtml</PaperCode> is on. A <PaperCode>script</PaperCode> tag in the Markdown is visible characters.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="html">HTML</PaperText>
            <PaperText preset="body" as="p">
                Many READMEs and catalog pages, such as Modrinth's, mix HTML into their Markdown for centered images, headings, and badges.
                Turn on <PaperCode>allowHtml</PaperCode> to draw it.
                The HTML is read by PaperMarkdown itself, never by the browser, so it works the same when a page is rendered on a server.
            </PaperText>
            <PaperTextList>
                <li>Headings, paragraphs, lists, quotes, <PaperCode>pre</PaperCode>, tables, and rules become the same components as their Markdown.</li>
                <li><PaperCode>b</PaperCode>, <PaperCode>i</PaperCode>, <PaperCode>s</PaperCode>, <PaperCode>u</PaperCode>, <PaperCode>sup</PaperCode>, <PaperCode>sub</PaperCode>, and similar tags keep their formatting. <PaperCode>code</PaperCode> becomes PaperCode, and <PaperCode>details</PaperCode> stays a disclosure.</li>
                <li>Links and images follow the same rules as Markdown, including <PaperCode>allowImages</PaperCode> and <PaperCode>renderImage</PaperCode>. An image keeps a <PaperCode>width</PaperCode> or <PaperCode>height</PaperCode> given in pixels.</li>
                <li>No other attribute is kept: no <PaperCode>style</PaperCode>, <PaperCode>class</PaperCode>, <PaperCode>align</PaperCode>, or event handler. Containers such as <PaperCode>div</PaperCode> and <PaperCode>center</PaperCode> keep only their content.</li>
                <li><PaperCode>script</PaperCode>, <PaperCode>style</PaperCode>, <PaperCode>svg</PaperCode>, comments, and similar code are dropped with their content. An <PaperCode>iframe</PaperCode>, <PaperCode>video</PaperCode>, or <PaperCode>audio</PaperCode> becomes a link to its address.</li>
            </PaperTextList>
            <PaperCode block language="tsx">
{`<PaperMarkdown text={project.body} allowHtml allowImages />`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="headings">Headings</PaperText>
            <PaperText preset="body" as="p">
                A heading level is the real element level, so a <PaperCode>#</PaperCode> line renders an <PaperCode>h1</PaperCode>.
                On a page that already has its own <PaperCode>h1</PaperCode>, start the Markdown at <PaperCode>##</PaperCode> to keep one top-level heading.
            </PaperText>
            <PaperText preset="body" as="p">
                Each Markdown heading gets the slug GitHub would give it, in a <PaperCode>data-anchor</PaperCode> attribute.
                The text is lowercased, punctuation is dropped, spaces become hyphens, and a repeated heading gets <PaperCode>-1</PaperCode>, <PaperCode>-2</PaperCode>, and so on.
                So <PaperCode>## What's new?</PaperCode> is <PaperCode>whats-new</PaperCode>. Headings drawn from HTML with <PaperCode>allowHtml</PaperCode> get no slug.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="links">Links</PaperText>
            <PaperTextList>
                <li>A link with an <PaperCode>http:</PaperCode>, <PaperCode>https:</PaperCode>, or <PaperCode>mailto:</PaperCode> address, or a relative address with no scheme, becomes a link.</li>
                <li>Any other scheme, such as <PaperCode>javascript:</PaperCode> or <PaperCode>data:</PaperCode>, drops the link and keeps its text. The scheme is read the way a browser reads it, so tabs, line breaks, and leading control characters do not hide it.</li>
                <li>A link title becomes the link's tooltip.</li>
                <li>A link to <PaperCode>#slug</PaperCode> scrolls to the heading with that slug in the same PaperMarkdown and moves focus to it, so a README's table of contents works. The slug can be written as is or percent-encoded. The page's address does not change.</li>
                <li>Headings get no <PaperCode>id</PaperCode>, so a heading in the text can never clash with an element of your page or with a heading in another PaperMarkdown. A <PaperCode>#link</PaperCode> with no matching heading does what the browser does by default.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="images">Images</PaperText>
            <PaperTextList>
                <li>With <PaperCode>allowImages</PaperCode> off, or an address the filter refuses, the alt text shows in place of the image. The content is never dropped silently.</li>
                <li>The same address filter as links applies, and <PaperCode>data:</PaperCode> addresses are also refused for images.</li>
                <li>Allowed images load lazily.</li>
                <li>An image alone in its paragraph with a title, <PaperCode>![alt](src "Caption")</PaperCode>, becomes a figure whose title is a visible caption. In running text the title stays a tooltip.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="custom-images">Custom images</PaperText>
            <PaperTextList>
                <li><PaperCode>renderImage</PaperCode> runs for every image before the defaults, with <PaperCode>allowImages</PaperCode> off as well. It sees the address as written with any scheme, so refusing an unsafe address is your job.</li>
                <li>Return an element to draw the image yourself, or <PaperCode>undefined</PaperCode> to use the default.</li>
                <li>For an image alone in its paragraph, <PaperCode>block</PaperCode> is true and your element replaces the whole paragraph. If you return <PaperCode>undefined</PaperCode>, the function runs once more for that image with <PaperCode>block</PaperCode> false, because the paragraph then falls back to inline rendering.</li>
                <li>Use it to show files that live in your panel, such as <PaperCode>![a cat](attachment:abc123)</PaperCode>, through your own components.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="streamed-reply">Streamed reply</PaperText>
            <PaperText preset="body" as="p">
                Pass a signal's value as <PaperCode>text</PaperCode> and append to the signal as chunks arrive.
                The Agent panel renders every message this way.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperMarkdown, PaperQuote } from "@mileniumhq/paperui";

export function Reply(props: { chunks: AsyncIterable<string> }) {
    const [text, setText] = createSignal("");
    const [failure, setFailure] = createSignal<string>();

    async function read() {
        setFailure(undefined);
        try {
            for await (const chunk of props.chunks) setText((current) => current + chunk);
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <PaperFlex direction="column" gap="full">
            <PaperButton onClick={() => void read()}>Read reply</PaperButton>
            <PaperMarkdown text={text()} />
            <Show when={failure()}>
                {(message) => (
                    <PaperQuote variant="danger" title="Reply interrupted" onDismiss={() => setFailure(undefined)}>
                        {message()}
                    </PaperQuote>
                )}
            </Show>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="panel-media">Panel-owned images</PaperText>
            <PaperText preset="body" as="p">
                Turn an address scheme your panel owns into your own component, and let the default handle the rest.
                Return <PaperCode>undefined</PaperCode> for anything you do not recognize, so the default text fallback applies.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperMarkdown, type MarkdownImage } from "@mileniumhq/paperui";
import type { JSX } from "solid-js";

const SCHEME = "attachment:";

export function Message(props: { text: string; urlOf: (id: string) => string }) {
    function renderAttachment(image: MarkdownImage): JSX.Element | undefined {
        if (!image.src.startsWith(SCHEME)) return undefined;
        return <img src={props.urlOf(image.src.slice(SCHEME.length))} alt={image.alt} loading="lazy" />;
    }

    return <PaperMarkdown text={props.text} renderImage={renderAttachment} />;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>Text you write yourself belongs in <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink>, with its presets, and lists in <PaperLink href="/docs/paperui/papertextlist/">PaperTextList</PaperLink>.</li>
                <li>HTML you already have, rendered by a library you trust, goes inside <PaperLink href="/docs/paperui/paperprose/">PaperProse</PaperLink>, which only styles it. PaperMarkdown never uses HTML.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
