import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSpacer,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSpacerDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSpacer</PaperText>
            <PaperText preset="body" as="p">
                PaperSpacer is an empty element that takes space in a flex row or column: all the room left over, or a fixed size.
                Use it to push siblings apart inside a <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink>, or to add a gap that the container's own gap does not give.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                With no props the spacer grows to fill the free space along the container's main axis.
                Put it between two groups to pin one to each end.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" align="center" fullWidth>
                    <PaperButton>Start</PaperButton>
                    <PaperSpacer />
                    <PaperButton variant="primary">End</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperFlex, PaperSpacer } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="row" align="center" fullWidth>
            <PaperButton>Start</PaperButton>
            <PaperSpacer />
            <PaperButton variant="primary">End</PaperButton>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperSpacerProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the spacer's <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td>No default</td>
                        <td>The fixed length of the gap. A spacing token (<PaperCode>"half"</PaperCode>, <PaperCode>"full"</PaperCode>, <PaperCode>"double"</PaperCode>, and the others of the spacing scale), a CSS length ending in <PaperCode>px</PaperCode>, <PaperCode>rem</PaperCode>, or <PaperCode>%</PaperCode>, a <PaperCode>var(...)</PaperCode> or <PaperCode>calc(...)</PaperCode> expression, or a number of pixels. It applies only with <PaperCode>direction</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td>No default (grows)</td>
                        <td>Makes the spacer a fixed size: <PaperCode>"horizontal"</PaperCode> sets its width to <PaperCode>size</PaperCode>, <PaperCode>"vertical"</PaperCode> its height. It no longer grows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the spacer. An object <PaperCode>style</PaperCode> is merged after the component's own.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The spacing scale is <PaperCode>none</PaperCode>, <PaperCode>onefourth</PaperCode>, <PaperCode>half</PaperCode>, <PaperCode>threefourths</PaperCode>, <PaperCode>full</PaperCode>, <PaperCode>sixfourths</PaperCode>, <PaperCode>double</PaperCode>, <PaperCode>triple</PaperCode>, <PaperCode>quadruple</PaperCode>, and <PaperCode>inset</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Without <PaperCode>direction</PaperCode> the spacer has <PaperCode>flex: 1 1 auto</PaperCode>. It does nothing in a container that is not a flex container, or that is no larger than its content.</li>
                <li>With <PaperCode>direction</PaperCode> and no <PaperCode>size</PaperCode> the spacer is zero-sized: it has no width or height to apply.</li>
                <li>The spacer is an empty <PaperCode>div</PaperCode> with no role. It does not affect assistive technology.</li>
                <li>For an even gap between all children, set <PaperCode>gap</PaperCode> on the PaperFlex instead of adding spacers.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="fixed">A fixed gap</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" align="center">
                    <PaperButton>One</PaperButton>
                    <PaperSpacer direction="horizontal" size="triple" />
                    <PaperButton>Two</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" align="center">
    <PaperButton>One</PaperButton>
    <PaperSpacer direction="horizontal" size="triple" />
    <PaperButton>Two</PaperButton>
</PaperFlex>`}
            </PaperCode>
        </PaperFlex>
    );
}
