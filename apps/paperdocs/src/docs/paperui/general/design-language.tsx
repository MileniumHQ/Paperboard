import {
    PaperBadge,
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

export default function DesignLanguageDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Design language</PaperText>
            <PaperText preset="body" as="p">
                Paperboard looks like sheets of paper on a desk: flat surfaces stacked by lightness, thin borders, and one hard shadow on the main action.
                This page names the parts of that look and says when to use each.
                Every part is a prop on a PaperUI component, so following the language means choosing the right prop.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="surfaces">Paper surfaces</PaperText>
            <PaperText preset="body" as="p">
                Depth comes from lightness, not from blurred shadows.
                The canvas is the back sheet, a card is a sheet on it, and a raised card or a table is a sheet on that.
                In light the higher sheets are whiter. In dark they are lighter grey, so the order holds in both themes.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="hint">Canvas</PaperText>
                    <PaperCard padding="full" surface="front">
                        <PaperFlex direction="column" gap="full">
                            <PaperText preset="hint">Card</PaperText>
                            <PaperCard padding="full" surface="frontest">
                                <PaperText preset="hint">Raised card</PaperText>
                            </PaperCard>
                            <PaperFlex background="surface-inset" padding="full">
                                <PaperText preset="hint">Inset well</PaperText>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperCard>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperFlex, PaperText } from "@mileniumhq/paperui";

<PaperCard padding="full" surface="front">
    <PaperFlex direction="column" gap="full">
        <PaperText preset="hint">Card</PaperText>
        <PaperCard padding="full" surface="frontest">
            <PaperText preset="hint">Raised card</PaperText>
        </PaperCard>
        <PaperFlex background="surface-inset" padding="full">
            <PaperText preset="hint">Inset well</PaperText>
        </PaperFlex>
    </PaperFlex>
</PaperCard>`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Use</th>
                        <th>Surface</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>The window behind everything</td>
                        <td><PaperCode>surface-app</PaperCode>. PaperProvider paints it.</td>
                    </tr>
                    <tr>
                        <td>A section of a page</td>
                        <td><PaperCode>PaperCard</PaperCode> with no <PaperCode>surface</PaperCode> (<PaperCode>front</PaperCode>)</td>
                    </tr>
                    <tr>
                        <td>A table, list or form inside a card, or a card that must stand out</td>
                        <td><PaperCode>surface="frontest"</PaperCode> (<PaperCode>surface-raised</PaperCode>)</td>
                    </tr>
                    <tr>
                        <td>Chrome, code and secondary blocks that sit back</td>
                        <td><PaperCode>surface="back"</PaperCode> (<PaperCode>surface-sunken</PaperCode>)</td>
                    </tr>
                    <tr>
                        <td>A field or a well that content is entered or dropped into</td>
                        <td><PaperCode>surface-inset</PaperCode> through <PaperCode>PaperFlex background</PaperCode>, or PaperInput, which draws its own</td>
                    </tr>
                    <tr>
                        <td>A filled element, such as an avatar tile</td>
                        <td><PaperCode>surface="element"</PaperCode></td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The values and the full ramp are in <PaperLink href="/docs/paperui/surfaces/">Surfaces and borders</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="borders">Borders and corners</PaperText>
            <PaperText preset="body" as="p">
                Surfaces are separated by a 1px border and rounded by a 12px radius.
                Components set these, so a panel that uses PaperCard never specifies either.
            </PaperText>
            <PaperTextList>
                <li><PaperCode>border-subtle</PaperCode> divides rows inside a card, <PaperCode>border</PaperCode> is a card's edge, <PaperCode>border-strong</PaperCode> and <PaperCode>border-emphasis</PaperCode> mark drop targets and table rules.</li>
                <li>Smaller pieces inside a card, such as a row, take the half radius (6px). Pills and dots take the full round.</li>
                <li><PaperCode>borderless</PaperCode> on a PaperCard drops the edge when the card sits flush in another container.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="roles">Color roles</PaperText>
            <PaperText preset="body" as="p">
                Color carries meaning, so the same role means the same thing in every panel.
                Neutral surfaces take the rest of the screen, and a role is spent only where something needs to be noticed.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Role</th>
                        <th>Say it when</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>primary</PaperCode></td><td>This is the action to take, or the selected thing.</td></tr>
                    <tr><td><PaperCode>success</PaperCode></td><td>Something is running, finished, or healthy. Also the confirm of a creation, such as New or Create.</td></tr>
                    <tr><td><PaperCode>danger</PaperCode></td><td>Something failed, stopped, or will be destroyed.</td></tr>
                    <tr><td><PaperCode>warning</PaperCode></td><td>Something needs care but works.</td></tr>
                    <tr><td><PaperCode>attention</PaperCode></td><td>Something should be looked at soon.</td></tr>
                    <tr><td><PaperCode>extra-1</PaperCode>, <PaperCode>extra-2</PaperCode>, <PaperCode>extra-3</PaperCode></td><td>Categories with no built-in meaning, such as chart series.</td></tr>
                </tbody>
            </PaperTable>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="row" gap="full" align="center" wrap>
                        <PaperBadge variant="success">Running</PaperBadge>
                        <PaperBadge variant="warning">Degraded</PaperBadge>
                        <PaperBadge variant="danger">Stopped</PaperBadge>
                        <PaperBadge variant="monochrome">Unknown</PaperBadge>
                    </PaperFlex>
                    <PaperCard accent="danger" padding="full">
                        <PaperText preset="label">Danger zone</PaperText>
                        <PaperText preset="hint">A role-tinted card for what cannot be undone.</PaperText>
                    </PaperCard>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperCard, PaperFlex, PaperText } from "@mileniumhq/paperui";

<PaperFlex direction="column" gap="full">
    <PaperFlex direction="row" gap="full" align="center" wrap>
        <PaperBadge variant="success">Running</PaperBadge>
        <PaperBadge variant="warning">Degraded</PaperBadge>
        <PaperBadge variant="danger">Stopped</PaperBadge>
        <PaperBadge variant="monochrome">Unknown</PaperBadge>
    </PaperFlex>
    <PaperCard accent="danger" padding="full">
        <PaperText preset="label">Danger zone</PaperText>
        <PaperText preset="hint">A role-tinted card for what cannot be undone.</PaperText>
    </PaperCard>
</PaperFlex>`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Never rely on color alone: pair a color with words or an icon, as the badges do.
                Values and the props that take a role are in <PaperLink href="/docs/paperui/colors/">Colors</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="paper-effect">The paper shadow</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink> draws a solid shadow offset down and right behind its child, in the deep tone of a role.
                Hovering lifts the child toward the corner and pressing pushes it flat onto the shadow, like pressing a sheet into the desk.
                It marks the one action a screen exists for, with the same role on the effect and the button.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="double" align="center" wrap>
                    <PaperEffect variant="success">
                        <PaperButton variant="success">
                            <PaperIcon>add</PaperIcon>
                            New item
                        </PaperButton>
                    </PaperEffect>
                    <PaperButton>Other action</PaperButton>
                    <PaperButton variant="text">Quiet action</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperEffect, PaperFlex, PaperIcon } from "@mileniumhq/paperui";

<PaperFlex direction="row" gap="double" align="center" wrap>
    <PaperEffect variant="success">
        <PaperButton variant="success">
            <PaperIcon>add</PaperIcon>
            New item
        </PaperButton>
    </PaperEffect>
    <PaperButton>Other action</PaperButton>
    <PaperButton variant="text">Quiet action</PaperButton>
</PaperFlex>`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Buttons otherwise step down in weight: a filled role is the main choice, a plain button is a normal one, <PaperCode>outline</PaperCode> and <PaperCode>text</PaperCode> are quiet.
                One filled button per group keeps the choice clear.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="type-and-rhythm">Type and rhythm</PaperText>
            <PaperTextList>
                <li>Text steps down from <PaperCode>header</PaperCode> (the page) to <PaperCode>subheader</PaperCode> (a section), <PaperCode>label</PaperCode> (one card or row), <PaperCode>body</PaperCode> (reading) and <PaperCode>hint</PaperCode> (support). Each preset also carries its color. See <PaperLink href="/docs/paperui/typography/">Typography</PaperLink>.</li>
                <li>Spacing repeats a small set of steps. Cards pad by <PaperCode>double</PaperCode> or <PaperCode>full</PaperCode> and space their children by <PaperCode>full</PaperCode> or <PaperCode>half</PaperCode>. A page pads by <PaperCode>double</PaperCode> and spaces its blocks by <PaperCode>full</PaperCode>. See <PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink>.</li>
                <li>Text outside a card lines up with text inside it. Give outside text <PaperCode>inset</PaperCode> so it keeps the same edge.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="motion">Motion</PaperText>
            <PaperText preset="body" as="p">
                Motion is short and follows the same curves everywhere, and it turns off for reduced motion.
                Use components that animate for you, such as <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> and <PaperLink href="/docs/paperui/paperpresence/">PaperPresence</PaperLink>, rather than writing transitions.
                Details are in <PaperLink href="/docs/paperui/motion/">Motion and effects</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="light-and-dark">Light and dark</PaperText>
            <PaperText preset="body" as="p">
                Both themes use the same token names, so a panel built from tokens needs nothing extra for dark.
                The theme comes from the window the panel opens in, with the OS setting as the fallback.
                Hard-coded colors are the one thing that breaks: a literal hex stays the same in both themes.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/guides/ui/">Building a good panel UI</PaperLink> applies this language to a whole panel.
            </PaperText>
        </PaperFlex>
    );
}
