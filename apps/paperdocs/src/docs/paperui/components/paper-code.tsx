import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperCodeDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperCode</PaperText>
            <PaperText preset="body">
                PaperCode renders inline code snippets or syntax-highlighted code blocks with an optional copy action.
                Reach for PaperCode when presenting shell commands, API signatures, JSON payloads, or source files.
                The component highlights syntax using PrismJS and provides clipboard copying.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Render PaperCode with the block prop for multi-line highlighted listings.
                Omit the block prop for inline monospace text.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCode, PaperCard, PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperText preset="body">
                    Run <PaperCode>bun install</PaperCode> to install dependencies.
                </PaperText>
                <PaperCode block language="tsx">
                    {\`const value: number = 42;\`}
                </PaperCode>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="body">
                        Run <PaperCode>bun install</PaperCode> to install dependencies.
                    </PaperText>
                    <PaperCode block language="tsx">
                        {`const value: number = 42;`}
                    </PaperCode>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperCode accepts the following configuration properties:
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
                            <td>Renders a multi-line preformatted code block instead of inline code.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>language</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"tsx"</PaperCode></td>
                            <td>Syntax grammar name: tsx, typescript, javascript, bash, json, css.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>lang</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Alias for the language prop.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>copyable</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>Boolean(block)</PaperCode></td>
                            <td>Displays a copy button in the top corner of the code box.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Clicking the copy button copies the raw string contents of the children to the system clipboard.
                The copy button displays a checkmark indicator for two seconds following successful copying.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Specify bash syntax for terminal installation commands.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperCode block language="bash">
    {\`bun add @mileniumhq/paperui\`}
</PaperCode>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperCode block language="bash">
                    {`bun add @mileniumhq/paperui`}
                </PaperCode>
            </PaperCard>
        </PaperFlex>
    );
}
