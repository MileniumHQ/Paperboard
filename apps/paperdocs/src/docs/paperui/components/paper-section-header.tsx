import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperSectionHeader,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSectionHeaderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSectionHeader</PaperText>
            <PaperText preset="body" as="p">
                PaperSectionHeader is the heading above a group of rows or cards: an icon, a title, a count, and actions at the end.
                Use it to label one list on a page that holds several.
                For the heading of the whole page, use <PaperLink href="/docs/paperui/paperpageheader/">PaperPageHeader</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>title</PaperCode> is the only required prop.
                Children are the actions.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperSectionHeader icon="history" title="Section" count={3}>
                    <PaperButton size="small" variant="text">
                        <PaperIcon>add</PaperIcon>
                        Action
                    </PaperButton>
                </PaperSectionHeader>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperIcon, PaperSectionHeader } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperSectionHeader icon="history" title="Section" count={3}>
            <PaperButton size="small" variant="text">
                <PaperIcon>add</PaperIcon>
                Action
            </PaperButton>
        </PaperSectionHeader>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperSectionHeaderProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Other props land on the header's <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The section's name, in the heading text preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no icon)</td>
                        <td>A leading icon. A string is a Material icon name. An element is placed unchanged.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>count</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (no badge)</td>
                        <td>A count badge after the title. Zero shows a badge reading 0. Pass <PaperCode>undefined</PaperCode> to hide it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default (no actions)</td>
                        <td>Controls at the end of the row, in a row with a half gap.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the header.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The header is a flat row with no border or background. It spans its container and indents by the same inset as text outside a card, so it lines up with card contents.</li>
                <li>The title is a <PaperCode>span</PaperCode>, not a heading element. To put it in the heading outline, pass <PaperCode>role="heading"</PaperCode> and <PaperCode>aria-level</PaperCode> on the header, as the Agents panel's onboarding does.</li>
                <li>The count shows as a monochrome <PaperLink href="/docs/paperui/paperbadge/">PaperBadge</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="count">A list with a count</PaperText>
            <PaperText preset="body" as="p">
                The gameserver panel's backups list passes <PaperCode>undefined</PaperCode> for an empty list, so no badge reads 0.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSectionHeader } from "@mileniumhq/paperui";

export function Backups(props: { backups: unknown[] }) {
    return <PaperSectionHeader icon="history" title="Saved backups" count={props.backups.length || undefined} />;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="heading-role">Part of the heading outline</PaperText>
            <PaperCode block language="tsx">
{`<PaperSectionHeader title="Choose a model" role="heading" aria-level={2} />`}
            </PaperCode>
        </PaperFlex>
    );
}
