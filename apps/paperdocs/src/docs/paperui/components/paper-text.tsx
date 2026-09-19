import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperTextDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperText</PaperText>
            <PaperText preset="body">
                PaperText renders typographic elements with standardized scales, weights, color tokens, and heading presets.
                Reach for PaperText for all labels, headings, captions, and body copy across your interface.
                The component supports truncation, word breaking, custom HTML tag rendering, and anchor link buttons.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass preset strings like "header", "title", or "body" for standard typographic sizing.
                Set color to a semantic token to adjust text contrast.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperText, PaperCard, PaperFlex } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="half">
                <PaperText preset="header">Header text</PaperText>
                <PaperText preset="title">Title text</PaperText>
                <PaperText preset="body">Body copy text</PaperText>
                <PaperText color="text-subtle">Subtle caption text</PaperText>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="header">Header text</PaperText>
                    <PaperText preset="title">Title text</PaperText>
                    <PaperText preset="body">Body copy text</PaperText>
                    <PaperText color="text-subtle">Subtle caption text</PaperText>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperText accepts the following typography properties:
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
                            <td><PaperCode>preset</PaperCode></td>
                            <td><PaperCode>"headline" | "header" | "subheader" | "title" | "subtitle" | "section" | "body" | "caption"</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Typography preset defining font size and weight.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>4</PaperCode></td>
                            <td>Direct size index from 0 (0px) through 17 (82px).</td>
                        </tr>
                        <tr>
                            <td><PaperCode>weight</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>400</PaperCode></td>
                            <td>Numeric font-weight (100 to 900).</td>
                        </tr>
                        <tr>
                            <td><PaperCode>as</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"span"</PaperCode></td>
                            <td>HTML element tag name rendered in the DOM: h1, h2, p, label, span, div.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>color</PaperCode></td>
                            <td><PaperCode>PaperColor</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Semantic color token: text, text-muted, text-subtle, text-faint, primary, danger.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>truncate</PaperCode></td>
                            <td><PaperCode>boolean | number</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Truncates overflowing text with an ellipsis. Pass a number for multi-line clamping.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When an id prop is provided, PaperText renders a copyable anchor link button next to the text.
                Clicking the anchor icon copies the URL fragment to the clipboard.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Clamp long descriptions to two lines using numeric truncation.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperText truncate={2}>
    Multi-line text content that is clamped after reaching the second visible line.
</PaperText>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperText truncate={2}>
                    Multi-line text content that is clamped after reaching the second visible line.
                </PaperText>
            </PaperCard>
        </PaperFlex>
    );
}
