import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperInterfaceGroupDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperInterfaceGroup</PaperText>
            <PaperText preset="body" as="p">
                PaperInterfaceGroup shows one of several screens, chosen by a value.
                Its PaperInterfaceItem children are the screens, and only the item whose value matches renders.
                Pair it with a <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> in a <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink>, or use it alone to switch steps or tabs.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Keep the active value in a signal.
                The same value drives the menu and the group, and each item declares which value it answers to.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuItem,
    PaperPageHeader,
    PaperPanel,
    PaperText,
} from "@mileniumhq/paperui";

export function Example() {
    const [tab, setTab] = createSignal("overview");

    return (
        <PaperPanel>
            <PaperMenu name="example-menu" value={tab()} onValueChange={(value) => setTab(String(value))}>
                <PaperMenuItem value="overview" icon="home">Overview</PaperMenuItem>
                <PaperMenuItem value="logs" icon="terminal">Logs</PaperMenuItem>
            </PaperMenu>

            <PaperInterfaceGroup value={tab()}>
                <PaperInterfaceItem value="overview">
                    <PaperPageHeader icon="home" title="Overview" />
                    <PaperCard padding="full">
                        <PaperText>Overview content.</PaperText>
                    </PaperCard>
                </PaperInterfaceItem>
                <PaperInterfaceItem value="logs" variant="fill">
                    <PaperPageHeader icon="terminal" title="Logs" />
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="group-props">PaperInterfaceGroup</PaperText>
            <PaperText preset="body" as="p">
                PaperInterfaceGroupProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
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
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>Required</td>
                        <td>The value of the item to show. A value that matches no item shows nothing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the group's element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperInterfaceItem</PaperText>
            <PaperText preset="body" as="p">
                PaperInterfaceItemProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.{" "}
                <PaperCode>PaperInterfaceStep</PaperCode> is the same component under a second name, for steps.
                An item must sit inside a group.
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
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>Required</td>
                        <td>The group value this item answers to. Compared with <PaperCode>===</PaperCode>, so <PaperCode>"1"</PaperCode> and <PaperCode>1</PaperCode> differ.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>PaperInterfaceItemVariant</PaperCode></td>
                        <td><PaperCode>"page"</PaperCode></td>
                        <td>How the active item hosts its content. See Variants.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>width</PaperCode></td>
                        <td><PaperCode>"standard" | "wide" | "full"</PaperCode></td>
                        <td>No default (standard)</td>
                        <td>The page column's width for the <PaperCode>page</PaperCode> and <PaperCode>fill</PaperCode> variants. See <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the item's element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="variants">Variants</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>PaperInterfaceItemVariant</PaperCode> is <PaperCode>"page" | "fill" | "full" | "centered" | "plain"</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variant</th>
                        <th>The item</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>page</PaperCode></td>
                        <td>Wraps its content in a <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink> column and scrolls vertically.</td>
                        <td>Settings, dashboards, forms. The default.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fill</PaperCode></td>
                        <td>Wraps its content in a PaperPage column at the item's full height. The item does not scroll, so the content takes the space and scrolls itself.</td>
                        <td>A console, a chat, a file browser.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>full</PaperCode></td>
                        <td>Edge to edge, no padding, clipped.</td>
                        <td>A canvas or an embedded view.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>centered</PaperCode></td>
                        <td>Centers its content, with a gap of padding, and scrolls.</td>
                        <td>An empty state, a sign-in prompt.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>plain</PaperCode></td>
                        <td>A raw box that scrolls. You compose everything.</td>
                        <td>A layout none of the above fit.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Only the matching item is mounted. Switching away unmounts its content and drops its state, so keep state that has to survive in a signal outside the item.</li>
                <li>Inside a PaperPanel the group takes the space beside the menu, and the active item owns the scrolling. Outside a panel it fills its parent.</li>
                <li>On a phone-width panel the group is the page that slides in over the menu. Its title and icon come from the menu entry whose value matches. See <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink>.</li>
                <li>The group renders no navigation. Drive <PaperCode>value</PaperCode> from a <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink>, a <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink>, or any signal.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="steps">Steps driven by a signal</PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInterfaceGroup,
    PaperInterfaceStep,
    PaperText,
} from "@mileniumhq/paperui";

export function Steps() {
    const [step, setStep] = createSignal(1);

    return (
        <PaperFlex direction="column" gap="full" fullWidth>
            <PaperInterfaceGroup value={step()}>
                <PaperInterfaceStep value={1} variant="centered">
                    <PaperText preset="title" as="h2">First</PaperText>
                </PaperInterfaceStep>
                <PaperInterfaceStep value={2} variant="centered">
                    <PaperText preset="title" as="h2">Second</PaperText>
                </PaperInterfaceStep>
            </PaperInterfaceGroup>
            <PaperButton onClick={() => setStep(step() === 1 ? 2 : 1)}>Switch</PaperButton>
        </PaperFlex>
    );
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                For a form that collects data across steps with Back and Next, use <PaperLink href="/docs/paperui/paperwizard/">PaperWizard</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
