import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperCodeDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperCode</PaperText>
            <PaperText preset="body" as="p">
                PaperCode shows code, either inline in a sentence or as a highlighted block with a copy button.
                Use it for identifiers, commands, and configuration samples.
                For an editable file, use <PaperLink href="/docs/paperui/papereditor/">PaperEditor</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Without <PaperCode>block</PaperCode> the component renders an inline <PaperCode>code</PaperCode> element.
                With <PaperCode>block</PaperCode> it renders a bordered <PaperCode>pre</PaperCode> and a copy button.
                Pass the code as a string child.
            </PaperText>
            <PaperCard data-docs-demo padding="double" gap="full" surface="front">
                <PaperText preset="body" as="p">
                    Call <PaperCode>getVarCss("primary")</PaperCode> to read a token.
                </PaperText>
                <PaperCode block language="tsx">
{`const color = getVarCss("primary");`}
                </PaperCode>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperCode, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" gap="full" surface="front">
            <PaperText preset="body" as="p">
                Call <PaperCode>getVarCss("primary")</PaperCode> to read a token.
            </PaperText>
            <PaperCode block language="tsx">
{\`const color = getVarCss("primary");\`}
            </PaperCode>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperCodeProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLElement&gt;</PaperCode>.
                Other props land on the <PaperCode>code</PaperCode> element when inline and on the <PaperCode>pre</PaperCode> when a block.
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
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The code. Pass a plain string. Other child types are joined into text, so an element child does not render as markup.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>block</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (inline)</td>
                        <td>Renders a full-width bordered block instead of an inline span of code.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>language</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default: a block highlights as <PaperCode>tsx</PaperCode>, inline code is not highlighted</td>
                        <td>The grammar to highlight with. A block also writes it to <PaperCode>data-language</PaperCode> on the <PaperCode>pre</PaperCode>, which text exports keep.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>lang</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Alias of <PaperCode>language</PaperCode>. <PaperCode>language</PaperCode> wins when both are set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>copyable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>The value of <PaperCode>block</PaperCode></td>
                        <td>Shows the copy button. Only a block has a button, so <PaperCode>copyable</PaperCode> on inline code does nothing; set <PaperCode>copyable={"{false}"}</PaperCode> on a block to hide it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ref</PaperCode></td>
                        <td>Solid ref</td>
                        <td>No default</td>
                        <td>The <PaperCode>code</PaperCode> element when inline, the <PaperCode>pre</PaperCode> when a block.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the <PaperCode>code</PaperCode> or the <PaperCode>pre</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="languages">Languages</PaperText>
            <PaperText preset="body" as="p">
                Highlighting uses Prism with these grammars loaded: <PaperCode>tsx</PaperCode>, <PaperCode>jsx</PaperCode>, <PaperCode>typescript</PaperCode> (<PaperCode>ts</PaperCode>), <PaperCode>javascript</PaperCode> (<PaperCode>js</PaperCode>), <PaperCode>css</PaperCode>, <PaperCode>json</PaperCode>, <PaperCode>json5</PaperCode>, <PaperCode>bash</PaperCode> (<PaperCode>sh</PaperCode>, <PaperCode>shell</PaperCode>), <PaperCode>yaml</PaperCode> (<PaperCode>yml</PaperCode>), <PaperCode>toml</PaperCode>, <PaperCode>ini</PaperCode>, <PaperCode>properties</PaperCode>, <PaperCode>markdown</PaperCode> (<PaperCode>md</PaperCode>), <PaperCode>html</PaperCode>, <PaperCode>xml</PaperCode>, <PaperCode>clike</PaperCode>, and <PaperCode>text</PaperCode> for no highlighting.
                An unlisted language, such as <PaperCode>python</PaperCode>, is highlighted as <PaperCode>tsx</PaperCode> and still gets its name in <PaperCode>data-language</PaperCode>. Use <PaperCode>text</PaperCode> to avoid wrong colors.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The copy button copies the child string exactly, using the clipboard API with a textarea fallback for sandboxed frames.</li>
                <li>The button's name changes to <PaperCode>Copied</PaperCode> for 2 seconds after a copy and to <PaperCode>Copy failed</PaperCode> when both clipboard paths are rejected. A failed copy is never shown as success.</li>
                <li>A block never wraps. Long lines scroll horizontally. Text in both forms is selectable.</li>
                <li>Inline code never wraps.</li>
                <li>Markup in the string is escaped, not rendered: <PaperCode>&lt;b&gt;</PaperCode> shows as the text <PaperCode>&lt;b&gt;</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="commands">A shell command</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperCode block language="sh">
{`bun run --cwd apps/paperdocs build`}
                </PaperCode>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperCode block language="sh">
{\`bun run --cwd apps/paperdocs build\`}
</PaperCode>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="config">Configuration without a copy button</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperCode block language="json" copyable={false}>
{`{
    "name": "Panel",
    "version": "1.0.0"
}`}
                </PaperCode>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperCode block language="json" copyable={false}>
{\`{
    "name": "Panel",
    "version": "1.0.0"
}\`}
</PaperCode>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperLink href="/docs/paperui/paperconsole/">PaperConsole</PaperLink> for scrolling logs and command output, <PaperLink href="/docs/paperui/papercopybutton/">PaperCopyButton</PaperLink> for a lone copyable value, and <PaperLink href="/docs/paperui/paperkbd/">PaperKbd</PaperLink> for a key name.
            </PaperText>
        </PaperFlex>
    );
}
