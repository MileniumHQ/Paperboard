import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperCode</PaperText>
            <PaperText preset="body">
                <strong>PaperCode</strong> is a syntax-highlighted code rendering primitive supporting inline code fragments, multiline code blocks, PrismJS grammar integration, and clipboard copy operations.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperCode provides formatted display of programming languages, CLI commands, and configuration data. It uses <PaperCode>SUSE Mono</PaperCode> typography, background surface fills, and syntax tokenizers powered by PrismJS. Highlighted output is injected as HTML, so both inline and block modes render Prism token markup.
            </PaperText>

            <PaperSeparator />

            <PaperText id="inline-code" preset="subheader">
                Inline code
            </PaperText>
            <PaperText preset="body">
                When the <PaperCode>block</PaperCode> prop is omitted, <PaperCode>PaperCode</PaperCode> renders as an inline HTML <PaperCode>&lt;code&gt;</PaperCode> element with compact padding and a rounded border. Its content is also passed through Prism highlighting, so inline fragments receive the same token colors as blocks.
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperText preset="body">
    Configure the option using <PaperCode>theme="dark"</PaperCode> on initialization.
</PaperText>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperText preset="body">
                        Configure the option using <PaperCode>theme="dark"</PaperCode> on initialization.
                    </PaperText>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="block-code" preset="subheader">
                Block code and copy button
            </PaperText>
            <PaperText preset="body">
                Setting <PaperCode>block</PaperCode> to <PaperCode>true</PaperCode> renders a multi-line <PaperCode>&lt;pre&gt;</PaperCode> container. By default, block mode includes a clipboard copy button positioned in its top-right corner:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperCode block language="tsx">
    {\`import { PaperButton } from "@paperboard-dev/paperui";

function Example() {
    return <PaperButton variant="brand">Click Me</PaperButton>;
}\`}
</PaperCode>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="half">
                    <PaperCode block language="tsx">
                        {`import { PaperButton } from "@paperboard-dev/paperui";

function Example() {
    return <PaperButton variant="brand">Click Me</PaperButton>;
}`}
                    </PaperCode>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="supported-languages" preset="subheader">
                Supported grammars
            </PaperText>
            <PaperText preset="body">
                PaperCode includes built-in Prism grammars for the following identifiers via the <PaperCode>language</PaperCode> prop:
            </PaperText>
            <PaperTextList>
                <PaperText preset="body"><PaperCode>"tsx"</PaperCode> / <PaperCode>"jsx"</PaperCode> (TypeScript and React/Solid JSX syntax)</PaperText>
                <PaperText preset="body"><PaperCode>"typescript"</PaperCode> / <PaperCode>"javascript"</PaperCode></PaperText>
                <PaperText preset="body"><PaperCode>"json"</PaperCode> (JSON payloads and configuration files)</PaperText>
                <PaperText preset="body"><PaperCode>"bash"</PaperCode> (Shell and terminal commands)</PaperText>
                <PaperText preset="body"><PaperCode>"css"</PaperCode> (Style declarations and tokens)</PaperText>
            </PaperTextList>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical Specification
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>block</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Renders code in a multi-line block container with horizontal overflow scrolling.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>language</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"tsx"</PaperCode></td>
                        <td>Prism syntax grammar identifier. When neither this prop nor <PaperCode>lang</PaperCode> is provided, the grammar falls back to tsx.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>lang</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Alias for the <PaperCode>language</PaperCode> prop; either value selects the grammar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>copyable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true (if block)</PaperCode></td>
                        <td>Enables the floating clipboard copy button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>string | string[]</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Raw code string or token array to highlight and render.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperkbd">PaperKbd</PaperLink> — Keyboard accelerator chip primitive.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/typography">Typography and Fonts</PaperLink> — Information regarding the SUSE Mono font family.
                </PaperText>
            </PaperTextList>
        </>
    );
}
