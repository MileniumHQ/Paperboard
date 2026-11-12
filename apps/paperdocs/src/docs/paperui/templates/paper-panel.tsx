import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperPanelDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPanel</PaperText>
            <PaperText preset="body" as="p">
                PaperPanel is the shell of a panel: a navigation menu beside an interface group that fills the rest of the window.
                Every multi-page panel is built on it.
                On a phone-width window it turns the menu into the first screen and opens each page over it, with no code from you.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put a <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> and a <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink> inside it, driven by one signal.
                The panel needs a parent that has a height: mount it inside <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink> with <PaperCode>fullWidth</PaperCode> and <PaperCode>fullHeight</PaperCode>, and import <PaperCode>@mileniumhq/paperui/panel.css</PaperCode>.
                This is the panel template's own shape.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import {
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuItem,
    PaperPageHeader,
    PaperPanel,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";

export default function App() {
    const [tab, setTab] = createSignal("overview");

    return (
        <PaperPanel>
            <PaperMenu name="panel-menu" value={tab()} onValueChange={(value) => setTab(String(value))}>
                <PaperMenuItem value="overview" icon="home">Overview</PaperMenuItem>
                <PaperMenuItem value="settings" icon="settings">Settings</PaperMenuItem>
            </PaperMenu>

            <PaperInterfaceGroup value={tab()}>
                <PaperInterfaceItem value="overview">
                    <PaperPageHeader icon="home" title="Overview" />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="settings">
                    <PaperPageHeader icon="settings" title="Settings" />
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperPanelProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>, so <PaperCode>id</PaperCode>, <PaperCode>aria-*</PaperCode> and event handlers land on the <PaperCode>div</PaperCode>.
                Children are the menu and the interface group.
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
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"row" | "column"</PaperCode></td>
                        <td><PaperCode>"row"</PaperCode></td>
                        <td><PaperCode>"row"</PaperCode> puts the menu beside the interface. <PaperCode>"column"</PaperCode> stacks the menu above it and never takes the phone layout.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The package also exports <PaperCode>PAPER_PANEL_COMPACT_WIDTH</PaperCode>, the number <PaperCode>520</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="layout">Layout</PaperText>
            <PaperTextList>
                <li>The panel fills its parent (<PaperCode>100%</PaperCode> wide and tall), clips overflow, and lays out as a flex row.</li>
                <li>The menu sizes itself. The interface group takes the remaining space, and its active item owns the scrolling. You write no layout styles.</li>
                <li>A row panel that is narrower than 520px takes the phone layout. The width is the panel's own box, measured on mount and on every resize, not the screen. Before it is measured, the panel takes the document's width, so a phone's first paint is already the phone layout.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="phone">Phone layout</PaperText>
            <PaperTextList>
                <li>The menu fills the panel. Picking an entry slides that entry's interface in over it as a page, with a top bar that shows the entry's title and icon and a back button.</li>
                <li>Back is the bar's button, the system Back action, or a rightward swipe. See <PaperLink href="/docs/paperui/utilities/">Utilities</PaperLink> for the swipe rules.</li>
                <li>Opening is by picking an entry, so the page stays closed on first render even when the menu already has a value.</li>
                <li>A closed page stays mounted off-screen and inert, so its state survives going back to the menu.</li>
                <li>Only a vertical <PaperCode>PaperMenu</PaperCode> inside the panel is the navigation. A horizontal menu or one with <PaperCode>embedded</PaperCode> is not.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="context">Context</PaperText>
            <PaperText preset="body" as="p">
                PaperPanel provides <PaperCode>PaperPanelContext</PaperCode>, which PaperMenu and PaperInterfaceGroup read through <PaperCode>usePaperPanel()</PaperCode>.
                The fields are in <PaperLink href="/docs/paperui/utilities/">Utilities</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="column">Menu on top</PaperText>
            <PaperText preset="body" as="p">
                A column panel stacks the menu above the interface.
                Give the menu <PaperCode>horizontal</PaperCode> so its entries run along the top.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperPanel direction="column">
    <PaperMenu name="panel-menu" horizontal value={tab()} onValueChange={(value) => setTab(String(value))}>
        <PaperMenuItem value="overview">Overview</PaperMenuItem>
        <PaperMenuItem value="settings">Settings</PaperMenuItem>
    </PaperMenu>
    <PaperInterfaceGroup value={tab()}>
        <PaperInterfaceItem value="overview">
            <PaperPageHeader icon="home" title="Overview" />
        </PaperInterfaceItem>
        <PaperInterfaceItem value="settings">
            <PaperPageHeader icon="settings" title="Settings" />
        </PaperInterfaceItem>
    </PaperInterfaceGroup>
</PaperPanel>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A panel with one screen and no navigation is a <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink> directly in the provider.</li>
                <li>A list pane beside a detail pane inside one page is <PaperLink href="/docs/paperui/papersplit/">PaperSplit</PaperLink>.</li>
                <li>A fixed-size dialog-like screen in the middle of the window is <PaperLink href="/docs/paperui/papercenteredinterface/">PaperCenteredInterface</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
