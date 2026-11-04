import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperProgress,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperProgressDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperProgress</PaperText>
            <PaperText preset="body" as="p">
                PaperProgress is a thin bar that shows how far along something is, or that it is still working.
                Use it for a meter inside a row or a card, such as a download, a disk, or a quota.
                For a task that owns the screen, or a list of steps with a status each, use <PaperLink href="/docs/paperui/paperloader/">PaperLoader</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>value</PaperCode> for a known amount.
                Leave it out for a bar that sweeps until the work ends.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperProgress value={60} aria-label="Known amount" />
                    <PaperProgress aria-label="Unknown amount" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperProgress } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="column" gap="full">
            <PaperProgress value={60} aria-label="Known amount" />
            <PaperProgress aria-label="Unknown amount" />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperProgressProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the bar's <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (indeterminate)</td>
                        <td>How much is done, from 0 to <PaperCode>max</PaperCode>. The fill is clamped to the track, so a value outside the range fills nothing or everything. Leaving it out draws a sweeping bar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>max</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>100</PaperCode></td>
                        <td>The value that fills the bar. A <PaperCode>max</PaperCode> of 0 or less is read as 100.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td>No default (primary)</td>
                        <td>The fill color: <PaperCode>"primary"</PaperCode>, <PaperCode>"brand"</PaperCode>, <PaperCode>"success"</PaperCode>, <PaperCode>"danger"</PaperCode>, <PaperCode>"warning"</PaperCode>, <PaperCode>"attention"</PaperCode>, <PaperCode>"extra-1"</PaperCode>, <PaperCode>"extra-2"</PaperCode>, or <PaperCode>"extra-3"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the track. An object <PaperCode>style</PaperCode> is merged after the component's own.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="states">States</PaperText>
            <PaperTextList>
                <li>With a <PaperCode>value</PaperCode> the fill grows from the left and animates between values.</li>
                <li>Without one, a segment about a third of the track long sweeps across it, repeating. Under reduced motion the sweep stops.</li>
                <li>The bar fills the width of its container. Set the width on the container.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperTextList>
                <li>The track has <PaperCode>role="progressbar"</PaperCode>, <PaperCode>aria-valuemin</PaperCode> of 0, and <PaperCode>aria-valuemax</PaperCode> of <PaperCode>max</PaperCode>.</li>
                <li>With a <PaperCode>value</PaperCode>, <PaperCode>aria-valuenow</PaperCode> is the value and <PaperCode>aria-valuetext</PaperCode> is the rounded percentage, such as <PaperCode>60%</PaperCode>. Indeterminate has neither.</li>
                <li>The bar has no text name. Set <PaperCode>aria-label</PaperCode>, or put a visible label beside it and point <PaperCode>aria-labelledby</PaperCode> at it.</li>
                <li>The bar shows no number. Add the amount as text next to it, such as "1.2 GB of 11.8 GB".</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="variants">Color roles</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperProgress value={70} variant="success" aria-label="Success" />
                    <PaperProgress value={50} variant="warning" aria-label="Warning" />
                    <PaperProgress value={90} variant="danger" aria-label="Danger" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="full">
    <PaperProgress value={70} variant="success" aria-label="Success" />
    <PaperProgress value={50} variant="warning" aria-label="Warning" />
    <PaperProgress value={90} variant="danger" aria-label="Danger" />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="custom-max">A count against a total</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>max</PaperCode> to the total and <PaperCode>value</PaperCode> to the count, with the numbers as text.
                Switch the color when the meter nears its limit.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperProgress, PaperText } from "@mileniumhq/paperui";

export function Players(props: { online: number; capacity: number }) {
    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperText preset="hint" as="p">{props.online} of {props.capacity} players</PaperText>
            <PaperProgress
                value={props.online}
                max={props.capacity}
                variant={props.online >= props.capacity ? "danger" : "primary"}
                aria-label="Players online"
            />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="in-a-card">Under a card's description</PaperText>
            <PaperText preset="body" as="p">
                A <PaperLink href="/docs/paperui/papermediacard/">PaperMediaCard</PaperLink> takes a meter in <PaperCode>descriptionExtra</PaperCode>, which is never cut off and lines up across a row of cards.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMediaCard
    icon="dns"
    title="Server"
    description="Click the card to open it."
    descriptionExtra={<PaperProgress value={60} aria-label="Disk used" />}
    onClick={() => undefined}
/>`}
            </PaperCode>
        </PaperFlex>
    );
}
