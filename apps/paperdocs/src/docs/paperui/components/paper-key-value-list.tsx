import {
    PaperBadge,
    PaperCard,
    PaperCode,
    PaperCopyButton,
    PaperFlex,
    PaperKeyValue,
    PaperKeyValueList,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperKeyValueListDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperKeyValueList</PaperText>
            <PaperText preset="body" as="p">
                PaperKeyValueList shows read-only label and value rows, with the label on the left and the value on the right.
                Use it for health readouts, server details, and the facts about one item.
                Use <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink> instead when the user picks one of the rows.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put one PaperKeyValue per row inside a PaperKeyValueList.
                The row's children are the value.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperKeyValueList>
                    <PaperKeyValue label="Status">
                        <PaperBadge variant="success">Online</PaperBadge>
                    </PaperKeyValue>
                    <PaperKeyValue label="Players">3 of 20</PaperKeyValue>
                    <PaperKeyValue label="Version">1.21.4</PaperKeyValue>
                </PaperKeyValueList>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperCard, PaperKeyValue, PaperKeyValueList } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperKeyValueList>
                <PaperKeyValue label="Status">
                    <PaperBadge variant="success">Online</PaperBadge>
                </PaperKeyValue>
                <PaperKeyValue label="Players">3 of 20</PaperKeyValue>
                <PaperKeyValue label="Version">1.21.4</PaperKeyValue>
            </PaperKeyValueList>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="list-props">PaperKeyValueList</PaperText>
            <PaperText preset="body" as="p">
                PaperKeyValueListProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDListElement&gt;</PaperCode> and adds nothing.
                It renders a <PaperCode>dl</PaperCode>, full width, as a column with a small gap between rows.
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
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The rows, usually PaperKeyValue.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the <PaperCode>dl</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="row-props">PaperKeyValue</PaperText>
            <PaperText preset="body" as="p">
                PaperKeyValueProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                It renders a <PaperCode>div</PaperCode> holding a <PaperCode>dt</PaperCode> for the label and a <PaperCode>dd</PaperCode> for the value.
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
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The row's name, drawn in the subtle text color.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The value. It is right-aligned and breaks anywhere in a long word, so a long ID wraps instead of overflowing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the row.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The markup is a description list: each <PaperCode>dt</PaperCode> and <PaperCode>dd</PaperCode> pair sits in a <PaperCode>div</PaperCode>, which HTML allows inside a <PaperCode>dl</PaperCode>. Assistive technology reads the pairs as terms and details.</li>
                <li>A row lays out the label and value on one line with the baselines aligned, and the gap between them keeps both readable when the line is narrow.</li>
                <li>The value can be any element: a badge, a link, a copy button. Values do not truncate.</li>
                <li>The list is static. It has no selection, hover, or empty state: render a PaperEmptyState when there are no rows.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="rich-values">Rich values</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperKeyValueList>
                    <PaperKeyValue label="Address">
                        <PaperFlex direction="row" gap="half" align="center">
                            <PaperCode>play.example.net</PaperCode>
                            <PaperCopyButton text="play.example.net" title="Copy address" />
                        </PaperFlex>
                    </PaperKeyValue>
                    <PaperKeyValue label="Docs">
                        <PaperLink href="/docs/paperui/paperlink/">PaperLink</PaperLink>
                    </PaperKeyValue>
                </PaperKeyValueList>
            </PaperCard>
            <PaperCode block language="tsx">
{`import {
    PaperCode,
    PaperCopyButton,
    PaperFlex,
    PaperKeyValue,
    PaperKeyValueList,
    PaperLink,
} from "@mileniumhq/paperui";

<PaperKeyValueList>
    <PaperKeyValue label="Address">
        <PaperFlex direction="row" gap="half" align="center">
            <PaperCode>play.example.net</PaperCode>
            <PaperCopyButton text="play.example.net" title="Copy address" />
        </PaperFlex>
    </PaperKeyValue>
    <PaperKeyValue label="Docs">
        <PaperLink href="/docs/paperui/paperlink/">PaperLink</PaperLink>
    </PaperKeyValue>
</PaperKeyValueList>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="from-data">Rows from data</PaperText>
            <PaperCode block language="tsx">
{`import { For } from "solid-js";
import { PaperKeyValue, PaperKeyValueList } from "@mileniumhq/paperui";

export function Facts(props: { facts: { label: string; value: string }[] }) {
    return (
        <PaperKeyValueList>
            <For each={props.facts}>
                {(fact) => <PaperKeyValue label={fact.label}>{fact.value}</PaperKeyValue>}
            </For>
        </PaperKeyValueList>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
