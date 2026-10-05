import {
    PaperCard,
    PaperCode,
    PaperCopyButton,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperCopyButtonDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperCopyButton</PaperText>
            <PaperText preset="body">
                PaperCopyButton copies a text string to the system clipboard and displays confirmation feedback.
                Reach for PaperCopyButton next to code samples, API keys, identifiers, and share URLs.
                The button switches its icon to a checkmark for two seconds following a successful copy.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass the string to copy into the text prop.
                Provide an optional label to display text alongside the icon.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCopyButton, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperCopyButton text="https://paperboard.dev" />
                <PaperCopyButton text="npm install @mileniumhq/paperui" label="Copy command" />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperCopyButton text="https://paperboard.dev" />
                    <PaperCopyButton text="npm install @mileniumhq/paperui" label="Copy command" />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperCopyButton accepts the following props:
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
                            <td><PaperCode>text</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td>No default</td>
                            <td>The exact text string written to the system clipboard upon click.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Optional text displayed next to the icon. When omitted, renders as an icon-only button.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"Copy"</PaperCode></td>
                            <td>Native title attribute providing tooltip text.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperCopyButton uses the browser navigator clipboard API.
                When clipboard access is denied or unavailable, the button does not trigger the copied state.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Pair PaperCopyButton with an identifier string inside a flex container.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="half" align="center">
    <PaperCode>token_12345678</PaperCode>
    <PaperCopyButton text="token_12345678" />
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperCode>token_12345678</PaperCode>
                    <PaperCopyButton text="token_12345678" />
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
