import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperFlexDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperFlex</PaperText>
            <PaperText preset="body">
                PaperFlex provides a flexbox layout container configured through design tokens and layout context.
                Reach for PaperFlex when arranging rows of controls, vertical stacks, or resizable sidebar columns.
                The container handles token-based gaps, padding, alignment shortcuts, and resize handles.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Set direction to "row" or "column" to establish the layout axis.
                Use the gap and padding props with standard spacing tokens.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperButton, PaperCard } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center" justify="space-between">
                <PaperButton>Left</PaperButton>
                <PaperButton variant="primary">Right</PaperButton>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" justify="space-between">
                    <PaperButton>Left</PaperButton>
                    <PaperButton variant="primary">Right</PaperButton>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperFlex accepts the following configuration properties:
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
                            <td><PaperCode>direction</PaperCode></td>
                            <td><PaperCode>"row" | "column" | "row-reverse" | "column-reverse"</PaperCode></td>
                            <td><PaperCode>"column"</PaperCode></td>
                            <td>Flex layout direction axis.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>gap</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Spacing between direct children using token names: half, full, double, triple.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>padding</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Uniform container padding.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>align</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>CSS align-items property.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>justify</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>CSS justify-content property.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>center</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Shortcuts align and justify to center.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>wrap</PaperCode></td>
                            <td><PaperCode>boolean | string</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Flex wrap mode. Boolean true maps to wrap.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>resizable</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Renders an interactive drag handle on the container edge.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>width / height</PaperCode></td>
                            <td><PaperCode>PaperSize</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>A fixed width or height, always a size token such as "field" or "panel-height-small".</td>
                        </tr>
                        <tr>
                            <td><PaperCode>minWidth / maxWidth / minHeight / maxHeight</PaperCode></td>
                            <td><PaperCode>PaperSize | 0</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Size bounds as size tokens. 0 lets a flex child shrink below its content, so its own content scrolls or wraps.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>fullWidth / fullHeight</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>true fills the parent. false sizes to content, overriding a component that fills by default, such as PaperCard.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>flex</PaperCode></td>
                            <td><PaperCode>boolean | number</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Takes the remaining space along the parent's axis.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>hidden</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Hides the container while keeping it and its children mounted.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperFlex provides a layout context that allows nested children to inherit flex parent awareness.
                When resizable is active, dragging the handle updates dimensions and triggers onResize.
                PaperFlex sets its display inline, so a class can't hide it: use hidden for a layer that stays mounted while another one shows, such as an open iframe that should come back as it was left.
                PaperCard and PaperPage take the same sizing props. Layout is set through these props, never a style tag; see the size tokens under Spacing.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Build vertical forms with consistent gap increments.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="full">
    <PaperText weight={600}>Form header</PaperText>
    <PaperButton variant="primary">Submit</PaperButton>
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText weight={600}>Form header</PaperText>
                    <PaperButton variant="primary">Submit</PaperButton>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
