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

export default function PaperEffectDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperEffect</PaperText>
            <PaperText preset="body" as="p">
                PaperEffect wraps a control in a colored paper shadow that lifts on hover and presses flat on click.
                Use it on the one main action of a screen, such as a New button or a primary call to action.
                It adds the motion only: the wrapped control keeps its own click handler and look.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Wrap one <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink> and give both the same <PaperCode>variant</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="double" align="center" wrap>
                    <PaperEffect variant="primary">
                        <PaperButton variant="primary">Primary</PaperButton>
                    </PaperEffect>
                    <PaperEffect variant="success">
                        <PaperButton variant="success">
                            <PaperIcon>add</PaperIcon>
                            New item
                        </PaperButton>
                    </PaperEffect>
                    <PaperEffect colorless>
                        <PaperButton>Colorless</PaperButton>
                    </PaperEffect>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperCard, PaperEffect, PaperFlex, PaperIcon } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="double" align="center" wrap>
                <PaperEffect variant="primary">
                    <PaperButton variant="primary">Primary</PaperButton>
                </PaperEffect>
                <PaperEffect variant="success">
                    <PaperButton variant="success">
                        <PaperIcon>add</PaperIcon>
                        New item
                    </PaperButton>
                </PaperEffect>
                <PaperEffect colorless>
                    <PaperButton>Colorless</PaperButton>
                </PaperEffect>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperEffectProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the root <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td>No default (primary)</td>
                        <td>The role whose deep color is the shadow: <PaperCode>primary</PaperCode>, <PaperCode>brand</PaperCode>, <PaperCode>success</PaperCode>, <PaperCode>danger</PaperCode>, <PaperCode>warning</PaperCode>, <PaperCode>attention</PaperCode>, <PaperCode>extra-1</PaperCode>, <PaperCode>extra-2</PaperCode>, <PaperCode>extra-3</PaperCode>. It also picks the touch haptic: <PaperCode>danger</PaperCode> feels heavier.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>colorless</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Uses a neutral border-colored shadow instead of the role color. Use it around a neutral button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Makes the shadow neutral, stops the hover and press motion, and drops the pointer cursor. It does not disable the wrapped control: set <PaperCode>disabled</PaperCode> on both.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The control to lift, usually one PaperButton.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root. An object <PaperCode>style</PaperCode> is merged after the role colors from <PaperCode>variant</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The root is an inline-flex <PaperCode>div</PaperCode> sized to its content. It reserves a small margin on its bottom and right for the shadow, so the shadow does not overlap the next element.</li>
                <li>On hover the control lifts up and left and the shadow grows. On press it moves down to meet the shadow. The effect runs only on devices with hover, apart from the press.</li>
                <li>It switches itself to the neutral shadow when the wrapped control is disabled, or when it is a <PaperCode>variant="text"</PaperCode> button. A text button gets a shadow only on hover and none at rest.</li>
                <li>On touch, lifting a finger where it pressed plays a haptic. A press that became a scroll plays nothing, and neither does a disabled control.</li>
                <li>With reduced motion on, by the system setting or Paperboard's motion setting, the effect stops moving the control and leaves the shadow in place.</li>
                <li>PaperEffect is not interactive. Focus, keyboard, and click all belong to the wrapped control.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="empty-state-action">An action in an empty state</PaperText>
            <PaperText preset="body" as="p">
                The terminal panel offers a lifted New Tab button when no tab is open.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperEffect, PaperEmptyState, PaperIcon } from "@mileniumhq/paperui";

export function NoTabs(props: { addTab: () => void }) {
    return (
        <PaperEmptyState icon="terminal" title="No tabs" description="Open a new tab to start a shell.">
            <PaperEffect variant="primary">
                <PaperButton variant="primary" onClick={props.addTab}>
                    <PaperIcon>add</PaperIcon>
                    New Tab
                </PaperButton>
            </PaperEffect>
        </PaperEmptyState>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="working">While work is running</PaperText>
            <PaperText preset="body" as="p">
                Disable both together so the shadow stops moving while the control is unavailable.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperEffect } from "@mileniumhq/paperui";

export function Save(props: { working: boolean; save: () => void }) {
    return (
        <PaperEffect variant="success" disabled={props.working}>
            <PaperButton variant="success" disabled={props.working} onClick={props.save}>
                Save
            </PaperButton>
        </PaperEffect>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
