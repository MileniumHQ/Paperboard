import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperProse,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperProseDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperProse</PaperText>
            <PaperText preset="body" as="p">
                PaperProse styles plain HTML elements as readable text: headings, paragraphs, lists, links, code, quotes, tables, and images.
                Use it around HTML you already have as markup, such as a sanitized description or a rendered document, so the panel ships no prose CSS of its own.
                It adds styling only: it does not render Markdown and does not sanitize anything.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put elements in as children, or pass an HTML string with the <PaperCode>innerHTML</PaperCode> prop.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperProse>
                    <h2>Heading</h2>
                    <p>A paragraph with <a href="https://paperboard.dev">a link</a> and <code>inline code</code>.</p>
                    <ul>
                        <li>First</li>
                        <li>Second</li>
                    </ul>
                    <blockquote>A quote</blockquote>
                </PaperProse>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperProse } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperProse>
            <h2>Heading</h2>
            <p>A paragraph with <a href="https://paperboard.dev">a link</a> and <code>inline code</code>.</p>
            <ul>
                <li>First</li>
                <li>Second</li>
            </ul>
            <blockquote>A quote</blockquote>
        </PaperProse>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperProseProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> and adds none of its own.
                Other props land on the wrapping <PaperCode>div</PaperCode>. <PaperCode>class</PaperCode> and <PaperCode>classList</PaperCode> are added to it, and children are its content.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="elements">Styled elements</PaperText>
            <PaperTextList>
                <li><PaperCode>h1</PaperCode> to <PaperCode>h6</PaperCode> take descending sizes. <PaperCode>h2</PaperCode> has a divider under it.</li>
                <li><PaperCode>p</PaperCode>, <PaperCode>ul</PaperCode>, <PaperCode>ol</PaperCode>, and <PaperCode>li</PaperCode> get spacing. Links use the primary color.</li>
                <li><PaperCode>code</PaperCode> and <PaperCode>pre</PaperCode> use the code font on a tinted background, and wrap long lines.</li>
                <li><PaperCode>blockquote</PaperCode> has a left border and subdued text.</li>
                <li><PaperCode>table</PaperCode> scrolls sideways when wider than the container. <PaperCode>img</PaperCode> never grows past it. <PaperCode>hr</PaperCode> is a thin divider.</li>
                <li>Elements outside this list keep the browser's defaults.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="safety">Safety</PaperText>
            <PaperText preset="body" as="p">
                Passing a string as <PaperCode>innerHTML</PaperCode> writes it into the page as markup.
                Pass only HTML your panel built, or HTML cleaned by a sanitizer you trust.
                Text from a server, a user, or a model is not safe to pass this way: render it with <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink>, which never uses HTML.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="inner-html">Markup you already trust</PaperText>
            <PaperCode block language="tsx">
{`import { PaperProse } from "@mileniumhq/paperui";

// html must come from your own panel or from a sanitizer you trust
export function Description(props: { html: string }) {
    return <PaperProse innerHTML={props.html} />;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>Text of your own is <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink>, with its presets, and lists are <PaperLink href="/docs/paperui/papertextlist/">PaperTextList</PaperLink>.</li>
                <li>Markdown from any source is <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink>, drawn through PaperUI components.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
