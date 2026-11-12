import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSlidePageDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSlidePage</PaperText>
            <PaperText preset="body" as="p">
                PaperSlidePage is the phone layout's drill-down page: what the user picks from a list slides in over the list from the right, with a top bar to go back.
                Use it only for a custom drill-down of your own.
                A panel built with PaperPanel and PaperInterfaceGroup already gets this behavior from its menu, with no PaperSlidePage in your code.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Wrap the page content, say whether the phone layout is on with <PaperCode>enabled</PaperCode>, and whether the page is showing with <PaperCode>open</PaperCode>.
                <PaperCode>onBack</PaperCode> closes it: set <PaperCode>open</PaperCode> to <PaperCode>false</PaperCode> there.
                The page is not demonstrated live here because it needs the phone layout.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperFlex, PaperSlidePage, PaperText } from "@mileniumhq/paperui";

export function Drilldown(props: { phone: boolean }) {
    const [open, setOpen] = createSignal(false);

    return (
        <PaperFlex direction="column" fullWidth fullHeight>
            <PaperButton onClick={() => setOpen(true)}>Open details</PaperButton>
            <PaperSlidePage
                position="fixed"
                enabled={props.phone}
                open={open()}
                title="Details"
                icon="info"
                onBack={() => setOpen(false)}
            >
                <PaperText preset="body" as="p">The page content.</PaperText>
            </PaperSlidePage>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperSlidePageProps has only the props below. It does not pass other attributes to the DOM.
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
                        <td><PaperCode>enabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (required)</td>
                        <td><PaperCode>true</PaperCode> is the phone layout, with the page and its bar. <PaperCode>false</PaperCode> is the wide layout: the page draws nothing of its own and the children lay out as if it were not there.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (required)</td>
                        <td>Whether the page is slid in. Closed, the page stays in the page off-screen, inert, with its state kept.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The text in the top bar. It is also the page's accessible name: the page is a <PaperCode>region</PaperCode> labelled by it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default (no icon)</td>
                        <td>A Material icon name as a string, or an element such as an app's own icon. Hidden from assistive technology.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onBack</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default (required)</td>
                        <td>Called by the back button, the system Back action, and a rightward swipe. It does not close the page itself.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onMore</PaperCode></td>
                        <td><PaperCode>(e: MouseEvent) =&gt; void</PaperCode></td>
                        <td>No default (no button)</td>
                        <td>Adds a three-dot button at the end of the bar and calls this on press. Open a <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink> from the event.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>moreLabel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"More"</PaperCode></td>
                        <td>The more button's accessible name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>position</PaperCode></td>
                        <td><PaperCode>"absolute" | "fixed"</PaperCode></td>
                        <td><PaperCode>"absolute"</PaperCode></td>
                        <td><PaperCode>"absolute"</PaperCode> covers the nearest positioned container, such as a PaperPanel. <PaperCode>"fixed"</PaperCode> covers the whole screen, for an app's top-level page, and pads the bar and content by the device's safe areas.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>crumbs</PaperCode></td>
                        <td><PaperCode>string[]</PaperCode></td>
                        <td>No default</td>
                        <td>Where the person is inside the page, outermost first, drawn after the title: "Title › Crumb › Crumb". The last crumb stays whole and the earlier ones shorten. Paperboard's shell passes the pages a panel has open, so its bar reads "Game Server › My Server › Overview".</td>
                    </tr>
                    <tr>
                        <td><PaperCode>background</PaperCode></td>
                        <td><PaperCode>PaperBackgroundSurface</PaperCode></td>
                        <td><PaperCode>"surface"</PaperCode></td>
                        <td>The page's surface. A fixed page's content stops above the home indicator, and this surface fills that strip, so match what the content shows at its foot.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>footColor</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The page's background</td>
                        <td>A computed color for that strip alone, when the content's foot isn't a surface the app knows. Paperboard's shell passes the color a panel reports along its bottom edge (<PaperCode>FRAME_BACKGROUND_EVENT</PaperCode>, see Utilities), so the strip under a panel is the panel's own.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The page content.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="going-back">Going back</PaperText>
            <PaperTextList>
                <li>The back button in the bar is named "Back".</li>
                <li>The system Back action closes the newest open page or modal first. A page counts only while it is enabled and open.</li>
                <li>A rightward drag goes back. From the top bar or a strip along the page's left edge any pointer can start it. A finger can start it anywhere on the page, unless what it touched has a horizontal gesture of its own, or is marked <PaperCode>data-paper-no-swipe-back</PaperCode>.</li>
                <li>The page follows the pointer while dragged. A released drag goes back when it passed about a third of the page's width, or was a quick flick.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="mounting">Mounting</PaperText>
            <PaperTextList>
                <li>The children are never moved or remounted, whether the layout is wide or phone, open or closed. State inside them, and an iframe's loaded page, survive.</li>
                <li>Closed, the page is <PaperCode>inert</PaperCode>: it takes no focus or clicks.</li>
                <li>Opening and closing animate. Switching between the wide and phone layout does not: a closed page appears off-screen at once.</li>
                <li>In a panel, an open page names itself to Paperboard: the app's top bar shows its title as a crumb after the panel's name, and the page draws no bar of its own. The app's Back goes back through the panel's pages first. Outside Paperboard, or in its desktop layout, the page keeps its own bar.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="more-menu">A page with its own menu</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>onMore</PaperCode> and open a context menu below the button.
            </PaperText>
            <PaperCode block language="tsx">
{`import {
    PaperContextMenu,
    PaperContextMenuItem,
    PaperSlidePage,
    PaperText,
    useContextMenuState,
} from "@mileniumhq/paperui";

export function Details(props: { open: boolean; onBack: () => void; onRename: () => void }) {
    const menu = useContextMenuState();

    return (
        <>
            <PaperSlidePage
                position="fixed"
                enabled
                open={props.open}
                title="Details"
                onBack={props.onBack}
                onMore={(e) => menu.openBelow(e, { align: "right" })}
                moreLabel="Details menu"
            >
                <PaperText preset="body" as="p">The page content.</PaperText>
            </PaperSlidePage>
            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuItem icon="edit" onClick={props.onRename}>Rename</PaperContextMenuItem>
            </PaperContextMenu>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A panel with a menu and pages uses <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> with <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink>, which slide in the same way on phones.</li>
                <li>A dialog over the page is <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>, optionally as a bottom sheet.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
