import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperCardDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperCard</PaperText>
            <PaperText preset="body">
                PaperCard provides a bordered, rounded container surface for grouping content and controls.
                Reach for PaperCard when building content sections, dialog bodies, or tool panels.
                The card exposes surface tone presets and integrated spacing properties.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap elements in PaperCard to set them off with background luminance and border clipping.
                Adjust internal spacing using the padding and gap props.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperText } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperText preset="title">Card title</PaperText>
            <PaperText color="text-subtle">Card content body</PaperText>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperText preset="title">Card title</PaperText>
                <PaperText color="text-subtle">Card content body</PaperText>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperCard accepts the following surface and layout properties:
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
                            <td><PaperCode>surface</PaperCode></td>
                            <td><PaperCode>"front" | "frontest" | "back" | "element" | "transparent"</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Sets the background surface tone and elevation depth.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>padding</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Internal padding using token sizes: none, half, full, double, triple, quadruple.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>paddingX</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Horizontal padding override.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>paddingY</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Vertical padding override.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>gap</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Flex gap spacing between child elements.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>borderless</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Removes the outer border while keeping the background surface.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>plain</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Rounds corners without applying a background tone.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperCard integrates with the layout context to resolve flex shrinking and expansion.
                When fullWidth or fullHeight are passed, width and height expand to fill available parent space.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Nest cards to establish visual hierarchy between sections and items.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperCard padding="double" surface="back" gap="full">
    <PaperText weight={600}>Outer container</PaperText>
    <PaperCard padding="full" surface="front">
        <PaperText color="text-subtle">Nested item</PaperText>
    </PaperCard>
</PaperCard>`}
            </PaperCode>
            <PaperCard padding="double" surface="back" gap="full">
                <PaperText weight={600}>Outer container</PaperText>
                <PaperCard padding="full" surface="front">
                    <PaperText color="text-subtle">Nested item</PaperText>
                </PaperCard>
            </PaperCard>
        </PaperFlex>
    );
}
