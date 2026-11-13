import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperButtonDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperButton</PaperText>
            <PaperText preset="body" as="p">
                PaperButton runs an action, submits a form, or links somewhere, styled as a button.
                Use it for every clickable action in a panel, in four sizes and a role color per intent.
                With <PaperCode>icon</PaperCode> it becomes a square icon-only control, and with <PaperCode>href</PaperCode> it renders an anchor.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put the label in the children.
                A button with no <PaperCode>variant</PaperCode> is a primary button. <PaperCode>"surface"</PaperCode> is the neutral one.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PaperButton>Button</PaperButton>
                    <PaperButton variant="primary">Primary</PaperButton>
                    <PaperButton variant="danger">Danger</PaperButton>
                    <PaperButton variant="surface">Surface</PaperButton>
                    <PaperButton variant="outline">Outline</PaperButton>
                    <PaperButton variant="text">Text</PaperButton>
                    <PaperButton disabled>Disabled</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center" wrap>
                <PaperButton>Button</PaperButton>
                <PaperButton variant="primary">Primary</PaperButton>
                <PaperButton variant="danger">Danger</PaperButton>
                <PaperButton variant="surface">Surface</PaperButton>
                <PaperButton variant="outline">Outline</PaperButton>
                <PaperButton variant="text">Text</PaperButton>
                <PaperButton disabled>Disabled</PaperButton>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperButtonProps extends <PaperCode>JSX.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;</PaperCode>, so <PaperCode>onClick</PaperCode>, <PaperCode>title</PaperCode>, <PaperCode>aria-*</PaperCode>, <PaperCode>form</PaperCode>, and the rest pass through to the element.
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
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>PaperButtonVariant</PaperCode></td>
                        <td>No default</td>
                        <td>Without it the button is filled with <PaperCode>primary</PaperCode>. A role fills the button: <PaperCode>primary</PaperCode>, <PaperCode>brand</PaperCode>, <PaperCode>success</PaperCode>, <PaperCode>danger</PaperCode>, <PaperCode>warning</PaperCode>, <PaperCode>attention</PaperCode>, <PaperCode>extra-1</PaperCode>, <PaperCode>extra-2</PaperCode>, <PaperCode>extra-3</PaperCode>. <PaperCode>"surface"</PaperCode> fills it with the neutral inset surface and full-contrast text. <PaperCode>"outline"</PaperCode> draws a border with no fill. <PaperCode>"text"</PaperCode> draws no border or fill until hovered.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>PaperButtonSize</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td><PaperCode>"tiny"</PaperCode>, <PaperCode>"small"</PaperCode>, <PaperCode>"medium"</PaperCode>, or <PaperCode>"large"</PaperCode>. <PaperCode>large</PaperCode> is the hero action, <PaperCode>tiny</PaperCode> a low-emphasis control. Every button of a size has the same height, with or without an icon.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws a square control sized to <PaperCode>size</PaperCode>: 28, 32, 36, or 48 pixels from tiny to large. A string child is read as a Material icon name and drawn as the glyph.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Stretches the button across its container, as PaperInput's <PaperCode>fullWidth</PaperCode> does.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>round</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Rounds the ends fully: an icon button becomes a circle, a labelled one a pill. Use it for floating controls over a header or media, like a chat's top bar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Disables the button and dims it. See Behavior for anchors.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>href</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Renders an <PaperCode>a</PaperCode> instead of a <PaperCode>button</PaperCode>, with the same look. An anchor gets no <PaperCode>type</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Passed to the anchor, such as <PaperCode>"_blank"</PaperCode>. Not set for you.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>rel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Passed to the anchor. Not set for you: add <PaperCode>noopener noreferrer</PaperCode> yourself with <PaperCode>target="_blank"</PaperCode>, or use <PaperLink href="/docs/paperui/paperlink/">PaperLink</PaperLink>, which does.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>"button" | "submit" | "reset"</PaperCode></td>
                        <td><PaperCode>"button"</PaperCode></td>
                        <td>A button never submits a form unless you set <PaperCode>type="submit"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ref</PaperCode></td>
                        <td>Solid ref</td>
                        <td>No default</td>
                        <td>An <PaperCode>HTMLButtonElement</PaperCode> variable or a callback that receives the rendered element.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>aria-label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The accessible name. An icon button with no <PaperCode>aria-label</PaperCode> uses its <PaperCode>title</PaperCode>. An icon button's glyph text is a font trick, never its name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element. An object <PaperCode>style</PaperCode> is merged after the component's own.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="icons">Icons</PaperText>
            <PaperText preset="body" as="p">
                An icon button needs a name for assistive technology.
                Set <PaperCode>title</PaperCode>, which shows on hover and becomes the <PaperCode>aria-label</PaperCode>, or set <PaperCode>aria-label</PaperCode> directly.
                A button with a label and an icon takes a <PaperCode>PaperIcon</PaperCode> child beside the text.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="anchors">Anchors</PaperText>
            <PaperText preset="body" as="p">
                With <PaperCode>href</PaperCode> the element is an anchor, and <PaperCode>onClick</PaperCode> still runs on it.
                A disabled anchor drops its <PaperCode>href</PaperCode> and sets <PaperCode>aria-disabled="true"</PaperCode>. It is dimmed, cannot be followed or focused, and its <PaperCode>onClick</PaperCode> does not run.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="states">States</PaperText>
            <PaperTextList>
                <li>A disabled button is dimmed and ignores clicks. Hover and press styling do not apply.</li>
                <li>Keyboard focus shows a focus ring on devices with hover.</li>
                <li>A <PaperCode>tiny</PaperCode> button with <PaperCode>aria-pressed="true"</PaperCode> draws its role fill, so a tiny button can act as a toggle.</li>
                <li>Handlers are your own: PaperButton does not catch errors thrown by <PaperCode>onClick</PaperCode>. Show a failed action to the user in the handler.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="sizes">Sizes</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PaperButton size="tiny">Tiny</PaperButton>
                    <PaperButton size="small">Small</PaperButton>
                    <PaperButton size="medium">Medium</PaperButton>
                    <PaperButton size="large">Large</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center" wrap>
    <PaperButton size="tiny">Tiny</PaperButton>
    <PaperButton size="small">Small</PaperButton>
    <PaperButton size="medium">Medium</PaperButton>
    <PaperButton size="large">Large</PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="icon-buttons">Icon buttons and labelled icons</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PaperButton icon title="Settings">settings</PaperButton>
                    <PaperButton icon variant="primary" size="large" title="Add">add</PaperButton>
                    <PaperButton variant="success">
                        <PaperIcon>add</PaperIcon>
                        New item
                    </PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperFlex, PaperIcon } from "@mileniumhq/paperui";

<PaperFlex direction="row" gap="full" align="center" wrap>
    <PaperButton icon title="Settings">settings</PaperButton>
    <PaperButton icon variant="primary" size="large" title="Add">add</PaperButton>
    <PaperButton variant="success">
        <PaperIcon>add</PaperIcon>
        New item
    </PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="full-width">Full width</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperButton variant="primary" fullWidth>Continue</PaperButton>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperButton variant="primary" fullWidth>Continue</PaperButton>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="link-button">Link styled as a button</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>href</PaperCode> with <PaperCode>target</PaperCode> and <PaperCode>rel</PaperCode> for an external destination.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperButton
                    variant="outline"
                    href="https://paperboard.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open site
                </PaperButton>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperButton
    variant="outline"
    href="https://paperboard.dev"
    target="_blank"
    rel="noopener noreferrer"
>
    Open site
</PaperButton>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="with-effect">Primary action with the paper effect</PaperText>
            <PaperText preset="body" as="p">
                Wrap the main action of a screen in <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink> for the paper-shadow press.
                First-party panels do this for "New project", "New Tab", and the like, with the same role on both.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperEffect variant="success">
                    <PaperButton variant="success">
                        <PaperIcon>add</PaperIcon>
                        New project
                    </PaperButton>
                </PaperEffect>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperEffect, PaperIcon } from "@mileniumhq/paperui";

<PaperEffect variant="success">
    <PaperButton variant="success">
        <PaperIcon>add</PaperIcon>
        New project
    </PaperButton>
</PaperEffect>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>Copy a string to the clipboard with <PaperLink href="/docs/paperui/papercopybutton/">PaperCopyButton</PaperLink>, which handles the copy outcome.</li>
                <li>Filter or switch a view with <PaperLink href="/docs/paperui/paperchip/">PaperChip</PaperLink>, which keeps its own pressed state.</li>
                <li>Navigate in prose with <PaperLink href="/docs/paperui/paperlink/">PaperLink</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
