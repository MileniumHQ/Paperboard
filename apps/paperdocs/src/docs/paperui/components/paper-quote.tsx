import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperQuote,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperQuoteDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperQuote</PaperText>
            <PaperText preset="body">
                PaperQuote renders callout callouts and informational blockquotes with decorative borders, icons, and titles.
                Reach for PaperQuote when highlighting warnings, tip advisories, deprecation notices, or system remarks.
                The callout pairs left border accents with semantic role color treatments.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Supply title and icon props to describe the nature of the message.
                Pass a semantic variant to tint the accent border and icon.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperQuote, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperQuote variant="primary" icon="info" title="Information">
                    System maintenance scheduled for tonight.
                </PaperQuote>
                <PaperQuote variant="danger" icon="warning" title="Warning">
                    Unsaved configuration changes will be lost.
                </PaperQuote>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperQuote variant="primary" icon="info" title="Information">
                        System maintenance scheduled for tonight.
                    </PaperQuote>
                    <PaperQuote variant="danger" icon="warning" title="Warning">
                        Unsaved configuration changes will be lost.
                    </PaperQuote>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperQuote accepts the following styling properties:
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
                            <td><PaperCode>variant</PaperCode></td>
                            <td><PaperCode>"monochrome" | PaperRole</PaperCode></td>
                            <td><PaperCode>"monochrome"</PaperCode></td>
                            <td>Color role: monochrome, primary, brand, success, danger, warning, attention.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Leading icon name or custom element displayed beside the callout body.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Bold summary title above the quote text.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperQuote renders an indented container with an accent border along its leading edge.
                Text within the callout preserves line breaks and wraps responsively.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Render success notes after completing asynchronous tasks.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperQuote variant="success" icon="check_circle" title="Success">
    Release archive published successfully.
</PaperQuote>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperQuote variant="success" icon="check_circle" title="Success">
                    Release archive published successfully.
                </PaperQuote>
            </PaperCard>
        </PaperFlex>
    );
}
