import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperMenu,
    PaperMenuItem,
    PaperMenuSection,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperMenuDoc() {
    const [page, setPage] = createSignal<string | number>("overview");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperMenu</PaperText>
            <PaperText preset="body" as="p">
                PaperMenu is a standing list of entries where exactly one is current, with icons, descriptions, group labels, and collapsible sections.
                Use it as a panel's sidebar navigation, or as a tab strip when horizontal.
                Use <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink> to pick a setting's value inside a page, <PaperLink href="/docs/paperui/paperselectmenu/">PaperSelectMenu</PaperLink> for a dropdown, and <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink> for a floating menu of actions.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>name</PaperCode> is required and groups the entries.
                Give each <PaperCode>PaperMenuItem</PaperCode> a unique <PaperCode>value</PaperCode>, and keep the current value in a signal.
                Inside a <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> the menu is the sidebar. The demo uses <PaperCode>embedded</PaperCode> to drop the sidebar frame.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperMenu name="docs-menu" embedded value={page()} onValueChange={setPage}>
                    <PaperMenuItem value="overview" icon="home">Overview</PaperMenuItem>
                    <PaperMenuItem value="settings" icon="settings" description="Options for this panel">Settings</PaperMenuItem>
                    <PaperMenuItem value="disabled" icon="lock" disabled>Disabled</PaperMenuItem>
                </PaperMenu>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperMenu, PaperMenuItem } from "@mileniumhq/paperui";

export function Example() {
    const [page, setPage] = createSignal<string | number>("overview");

    return (
        <PaperMenu name="docs-menu" embedded value={page()} onValueChange={setPage}>
            <PaperMenuItem value="overview" icon="home">Overview</PaperMenuItem>
            <PaperMenuItem value="settings" icon="settings" description="Options for this panel">Settings</PaperMenuItem>
            <PaperMenuItem value="disabled" icon="lock" disabled>Disabled</PaperMenuItem>
        </PaperMenu>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="menu-props">PaperMenu</PaperText>
            <PaperText preset="body" as="p">
                PaperMenuProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the menu's <PaperCode>div</PaperCode>, so <PaperCode>aria-label</PaperCode> and <PaperCode>role</PaperCode> work there.
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
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The group name of the entries' hidden radio inputs. Use a distinct name for each menu on a page.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default</td>
                        <td>The current entry's <PaperCode>value</PaperCode>. Setting it makes the menu controlled: it changes only when you change it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (none current)</td>
                        <td>The starting entry of an uncontrolled menu.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(value: string | number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the chosen entry's <PaperCode>value</PaperCode>, even when it was already current.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"vertical"</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode> lays the entries in a row with a bottom divider, as a tab strip.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>horizontal</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Shorthand for <PaperCode>direction="horizontal"</PaperCode>. Handy for switching on a condition, such as a phone layout.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>spacing</PaperCode></td>
                        <td><PaperCode>boolean | PaperSpacing</PaperCode></td>
                        <td>No default (a quarter gap)</td>
                        <td>The gap between entries. <PaperCode>false</PaperCode> packs them with no gap, <PaperCode>true</PaperCode> is a quarter gap, and a spacing token such as <PaperCode>"half"</PaperCode>, a CSS length, or a number of pixels sets it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>embedded</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Drops the menu's own surface, right divider, scrolling, and full height, for a menu inside a container that already has a frame. It also stops the menu from acting as a panel's navigation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the menu. An object <PaperCode>style</PaperCode> is merged after the component's own.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                By default the menu is a sidebar: the width of the <PaperCode>sidebar</PaperCode> size token, full height, a surface background, and a divider on its right.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="item-props">PaperMenuItem</PaperText>
            <PaperText preset="body" as="p">
                PaperMenuItemProps extends <PaperCode>JSX.InputHTMLAttributes&lt;HTMLInputElement&gt;</PaperCode>. The label is the children.
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
                        <td>No default (required)</td>
                        <td>The entry's identity. It is compared with the menu's <PaperCode>value</PaperCode> to mark the entry current. Keep it unique within the menu.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The entry's title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A string is a Material icon name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A second, smaller line under the title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the entry, ignores choosing, and skips it in keyboard navigation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>href</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Renders the entry as a link instead of a radio choice. See Links.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>level</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The enclosing section's depth</td>
                        <td>The indent level, one step per level. Sections set it for their entries, so you rarely pass it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the entry's element.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Any other prop goes to the hidden radio input, not to the visible entry. With <PaperCode>href</PaperCode> they go to the <PaperCode>a</PaperCode>, and its <PaperCode>onClick</PaperCode> runs on a click unless the entry is disabled.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="section-props">PaperMenuSection</PaperText>
            <PaperText preset="body" as="p">
                PaperMenuSection groups entries under a header that can fold them away.
                Its props extend <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Entries inside a section are indented one level per nesting.
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
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The header. A string is drawn as bold small text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A string is a Material icon name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>collapsible</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows a chevron and lets a click or Enter or Space on the header fold the section. <PaperCode>false</PaperCode> makes a plain, always-open header.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultOpen</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Whether the section starts open.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default</td>
                        <td>Forces the section open or closed. It takes priority over the header's folding and there is no change callback, so use <PaperCode>defaultOpen</PaperCode> unless you drive the state yourself.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="label-props">PaperMenuLabel</PaperText>
            <PaperText preset="body" as="p">
                PaperMenuLabel is a non-interactive label between entries, drawn as an uppercase overline.
                It takes <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink>'s props, except that its preset is fixed, and lines up with the entries around it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="selection">Choosing an entry</PaperText>
            <PaperTextList>
                <li>Each entry is a label holding a visually hidden radio input named by the menu's <PaperCode>name</PaperCode>. Clicking it, or pressing Enter or Space on it, calls <PaperCode>onValueChange</PaperCode>.</li>
                <li>Controlled and uncontrolled work as in a form: with <PaperCode>value</PaperCode> set, the current entry changes only when your signal does.</li>
                <li>The current entry is drawn highlighted.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="links">Links</PaperText>
            <PaperTextList>
                <li>With <PaperCode>href</PaperCode> an entry is an <PaperCode>a</PaperCode> that looks like any other. There is no radio input, and choosing it never calls <PaperCode>onValueChange</PaperCode>. The browser or your router navigates.</li>
                <li>The menu's <PaperCode>value</PaperCode> still marks the matching entry, and gives it <PaperCode>aria-current="page"</PaperCode>. Derive <PaperCode>value</PaperCode> from the current location.</li>
                <li>A disabled link loses its <PaperCode>href</PaperCode>, gets <PaperCode>aria-disabled="true"</PaperCode>, and is not focusable.</li>
                <li>Link entries are reached with Tab and the arrow keys, like the other entries.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="keyboard">Keyboard</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Tab</td>
                        <td>Each enabled entry and each collapsible header is a tab stop.</td>
                    </tr>
                    <tr>
                        <td>Down and Right arrows</td>
                        <td>Focus the next entry or collapsible header, wrapping to the first.</td>
                    </tr>
                    <tr>
                        <td>Up and Left arrows</td>
                        <td>Focus the previous one, wrapping to the last.</td>
                    </tr>
                    <tr>
                        <td>Home and End</td>
                        <td>Focus the first and last.</td>
                    </tr>
                    <tr>
                        <td>Enter and Space</td>
                        <td>Choose the focused entry, or fold or unfold the focused section header.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Moving focus does not choose an entry. Disabled entries are skipped.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="sections">Sections</PaperText>
            <PaperTextList>
                <li>A closed section does not render its entries, so they are not in the page, not focusable, and not found by text search.</li>
                <li>Sections nest. Each level indents its entries further.</li>
                <li>The header has no <PaperCode>aria-expanded</PaperCode> and no role. Name sections in text that makes sense without the chevron.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="in-a-panel">In a PaperPanel</PaperText>
            <PaperTextList>
                <li>A vertical, non-embedded menu directly inside a <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> is the panel's navigation. Pair it with a <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink> whose <PaperCode>value</PaperCode> follows the menu's.</li>
                <li>In the panel's compact (phone) layout, choosing an entry, even the current one, opens its page, and the page bar shows the entry's title and icon. While a page is open the menu is inert.</li>
                <li>A horizontal menu, or one with <PaperCode>embedded</PaperCode>, is not the panel's navigation and has none of this.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="sidebar">Sidebar with labels and a back entry</PaperText>
            <PaperText preset="body" as="p">
                The gameserver panel opens with a back entry, then a label with the server's name, then its tabs under group labels.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import {
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperPanel,
    PaperText,
} from "@mileniumhq/paperui";

export function App(props: { onHome: () => void }) {
    const [tab, setTab] = createSignal<string | number>("console");

    return (
        <PaperPanel>
            <PaperMenu
                name="main-menu"
                value={tab()}
                onValueChange={(value) => {
                    if (value === "home") props.onHome();
                    else setTab(value);
                }}
            >
                <PaperMenuItem value="home" icon="arrow_back">All items</PaperMenuItem>
                <PaperMenuLabel>Item name</PaperMenuLabel>
                <PaperMenuItem value="console" icon="terminal">Console</PaperMenuItem>
                <PaperMenuItem value="files" icon="folder">Files</PaperMenuItem>
            </PaperMenu>
            <PaperInterfaceGroup value={tab()}>
                <PaperInterfaceItem value="console">
                    <PaperText preset="body" as="p">Console</PaperText>
                </PaperInterfaceItem>
                <PaperInterfaceItem value="files">
                    <PaperText preset="body" as="p">Files</PaperText>
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="folding-sections">Folding sections</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperMenu name="docs-sections" embedded defaultValue="one">
                    <PaperMenuSection title="Open section" icon="folder_open">
                        <PaperMenuItem value="one">One</PaperMenuItem>
                        <PaperMenuItem value="two">Two</PaperMenuItem>
                    </PaperMenuSection>
                    <PaperMenuSection title="Closed section" icon="folder" defaultOpen={false}>
                        <PaperMenuItem value="three">Three</PaperMenuItem>
                    </PaperMenuSection>
                </PaperMenu>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperMenu, PaperMenuItem, PaperMenuSection } from "@mileniumhq/paperui";

<PaperMenu name="docs-sections" embedded defaultValue="one">
    <PaperMenuSection title="Open section" icon="folder_open">
        <PaperMenuItem value="one">One</PaperMenuItem>
        <PaperMenuItem value="two">Two</PaperMenuItem>
    </PaperMenuSection>
    <PaperMenuSection title="Closed section" icon="folder" defaultOpen={false}>
        <PaperMenuItem value="three">Three</PaperMenuItem>
    </PaperMenuSection>
</PaperMenu>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="tab-strip">Tab strip</PaperText>
            <PaperText preset="body" as="p">
                A horizontal menu is a row of entries with a divider under it.
                The Agent panel switches to one on phones with <PaperCode>horizontal={"{phone()}"}</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperMenu name="docs-tabs" horizontal embedded defaultValue="a">
                    <PaperMenuItem value="a">First</PaperMenuItem>
                    <PaperMenuItem value="b">Second</PaperMenuItem>
                    <PaperMenuItem value="c">Third</PaperMenuItem>
                </PaperMenu>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperMenu name="docs-tabs" horizontal embedded defaultValue="a">
    <PaperMenuItem value="a">First</PaperMenuItem>
    <PaperMenuItem value="b">Second</PaperMenuItem>
    <PaperMenuItem value="c">Third</PaperMenuItem>
</PaperMenu>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="route-links">Entries that are links</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>href</PaperCode> and set the menu's <PaperCode>value</PaperCode> from the route.
                The docs sidebar you are reading is built this way.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperMenu, PaperMenuItem } from "@mileniumhq/paperui";

export function Nav(props: { path: string }) {
    return (
        <PaperMenu name="site-nav" aria-label="Site" value={props.path}>
            <PaperMenuItem value="/" href="/" icon="home">Home</PaperMenuItem>
            <PaperMenuItem value="/docs/" href="/docs/" icon="menu_book">Docs</PaperMenuItem>
        </PaperMenu>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
