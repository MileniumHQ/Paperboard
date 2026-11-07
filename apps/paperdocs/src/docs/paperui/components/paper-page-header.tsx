import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperPageHeader,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperPageHeaderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPageHeader</PaperText>
            <PaperText preset="body" as="p">
                PaperPageHeader is the bar at the top of a page or tab: an icon chip, a title, a subtitle, and the page's actions on the right.
                Use it once per page body, above its content.
                For a heading inside a group of rows, use <PaperLink href="/docs/paperui/papersectionheader/">PaperSectionHeader</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>title</PaperCode> is the only required prop.
                Children become the actions, in a row on the right.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperPageHeader icon="folder" title="Title" subtitle="A line about this page">
                    <PaperButton variant="primary">
                        <PaperIcon>add</PaperIcon>
                        Action
                    </PaperButton>
                </PaperPageHeader>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperIcon, PaperPageHeader } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperPageHeader icon="folder" title="Title" subtitle="A line about this page">
            <PaperButton variant="primary">
                <PaperIcon>add</PaperIcon>
                Action
            </PaperButton>
        </PaperPageHeader>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperPageHeaderProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
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
                        <td>The page's name, in the title text preset. A long unbroken word wraps.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>subtitle</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A line of subdued text under the title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no chip)</td>
                        <td>The leading chip. A string is a Material icon name, drawn in a tinted square. An element is placed in the square unchanged.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default (no actions area)</td>
                        <td>The page's actions, laid out in a wrapping row with a half gap between them.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>centerWhenStacked</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>When the actions wrap under the heading, centers both rows. Without it they stay at the leading edge.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>ref</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to, and a reference to, the header's <PaperCode>div</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The header is flat: a raised surface with a border and no shadow, so it sits at the same depth as the page below it.</li>
                <li>The header fills the width of its container, such as the column of a <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink>.</li>
                <li>The heading takes the room it needs first. When the row is too narrow for the title and the actions side by side, the actions wrap under it.</li>
                <li><PaperCode>centerWhenStacked</PaperCode> measures the row with a resize observer. Where the browser has none, the header never centers.</li>
                <li>The title is a <PaperCode>span</PaperCode>, not a heading element, so it does not appear in the page's heading outline. Add a heading element yourself where assistive technology needs one.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="title-only">Title with an optional action</PaperText>
            <PaperText preset="body" as="p">
                The Actions panel shows its New project button only when there are projects, because an empty page offers it in the empty state instead.
            </PaperText>
            <PaperCode block language="tsx">
{`import { Show } from "solid-js";
import { PaperButton, PaperIcon, PaperPageHeader } from "@mileniumhq/paperui";

export function Projects(props: { count: number; onNew: () => void }) {
    return (
        <PaperPageHeader icon="account_tree" title="Projects">
            <Show when={props.count > 0}>
                <PaperButton variant="success" onClick={props.onNew}>
                    <PaperIcon>add</PaperIcon>
                    New project
                </PaperButton>
            </Show>
        </PaperPageHeader>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="custom-icon">Custom leading element</PaperText>
            <PaperText preset="body" as="p">
                Pass an element as <PaperCode>icon</PaperCode> for art that is not a glyph, such as an avatar.
                The Agent panel's chat header shows its agent's face this way, with <PaperCode>centerWhenStacked</PaperCode> on.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperAvatar, PaperButton, PaperPageHeader } from "@mileniumhq/paperui";

<PaperPageHeader
    icon={<PaperAvatar src="/agent.png" />}
    title="Agent"
    subtitle="Online"
    centerWhenStacked
>
    <PaperButton>Settings</PaperButton>
</PaperPageHeader>`}
            </PaperCode>
        </PaperFlex>
    );
}
