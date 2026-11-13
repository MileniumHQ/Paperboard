import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    useContextMenuState,
} from "@mileniumhq/paperui";

export default function PaperContextMenuDoc() {
    const menu = useContextMenuState();
    const compactMenu = useContextMenuState();

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperContextMenu</PaperText>
            <PaperText preset="body" as="p">
                PaperContextMenu is a floating menu of actions that opens at the pointer or below a button.
                Use it for a right-click menu, a row's more-actions button, or a split-button's extra choices.
                Use <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> for a standing navigation list, and <PaperLink href="/docs/paperui/paperselectmenu/">PaperSelectMenu</PaperLink> for choosing a value.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                The menu does not own its open state.
                Call <PaperCode>useContextMenuState()</PaperCode> for a state object, open it from an event, and pass its <PaperCode>isOpen()</PaperCode>, <PaperCode>target()</PaperCode>, <PaperCode>placement()</PaperCode>, and <PaperCode>close</PaperCode> to the menu.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperButton onClick={(e) => menu.openBelow(e)}>Actions</PaperButton>
                <PaperContextMenu
                    open={menu.isOpen()}
                    target={menu.target()}
                    placement={menu.placement()}
                    onClose={menu.close}
                >
                    <PaperContextMenuHeader>Item</PaperContextMenuHeader>
                    <PaperContextMenuItem icon="edit" keybind="F2">Rename</PaperContextMenuItem>
                    <PaperContextMenuItem icon="content_copy">Copy</PaperContextMenuItem>
                    <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
                </PaperContextMenu>
            </PaperCard>
            <PaperCode block language="tsx">
{`import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    useContextMenuState,
} from "@mileniumhq/paperui";

export function Example() {
    const menu = useContextMenuState();

    return (
        <>
            <PaperButton onClick={(e) => menu.openBelow(e)}>Actions</PaperButton>
            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuHeader>Item</PaperContextMenuHeader>
                <PaperContextMenuItem icon="edit" keybind="F2">Rename</PaperContextMenuItem>
                <PaperContextMenuItem icon="content_copy">Copy</PaperContextMenuItem>
                <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
            </PaperContextMenu>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="compact">Compact</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>compact</PaperCode> for a denser menu: tighter padding, small text and small icons.
                Use it where the menu sits over dense content, like a canvas's right-click menu or a toolbar's dropdowns. Its submenus open compact too.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperButton onClick={(e) => compactMenu.openBelow(e)}>Block</PaperButton>
                <PaperContextMenu
                    compact
                    open={compactMenu.isOpen()}
                    target={compactMenu.target()}
                    placement={compactMenu.placement()}
                    onClose={compactMenu.close}
                >
                    <PaperContextMenuItem icon="content_copy" keybind="D">Duplicate</PaperContextMenuItem>
                    <PaperContextMenuItem icon="comment">Add comment</PaperContextMenuItem>
                    <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
                </PaperContextMenu>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperContextMenu
    compact
    open={menu.isOpen()}
    target={menu.target()}
    placement={menu.placement()}
    onClose={menu.close}
>
    <PaperContextMenuItem icon="content_copy" keybind="D">Duplicate</PaperContextMenuItem>
    <PaperContextMenuItem icon="comment">Add comment</PaperContextMenuItem>
    <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
</PaperContextMenu>`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="menu-props">PaperContextMenu</PaperText>
            <PaperText preset="body" as="p">
                PaperContextMenuProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the menu's <PaperCode>div</PaperCode>, after <PaperCode>role="menu"</PaperCode>, so you can override it.
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
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (closed)</td>
                        <td>Shows the menu. A closed menu renders nothing unless <PaperCode>keepMounted</PaperCode> is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called whenever the menu asks to close. Set <PaperCode>open</PaperCode> to <PaperCode>false</PaperCode> in it, or the menu stays open. See Behavior for what triggers it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target</PaperCode></td>
                        <td><PaperCode>ContextMenuTarget</PaperCode></td>
                        <td>No default</td>
                        <td>What the menu is anchored to: a mouse or pointer event, an <PaperCode>HTMLElement</PaperCode>, an event whose element to use, <PaperCode>{"{ clientX, clientY }"}</PaperCode>, <PaperCode>{"{ x, y }"}</PaperCode>, or <PaperCode>null</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>placement</PaperCode></td>
                        <td><PaperCode>ContextMenuPlacement</PaperCode></td>
                        <td>No default (see below)</td>
                        <td><PaperCode>"mouse"</PaperCode> opens at the pointer. <PaperCode>"below"</PaperCode> and <PaperCode>"below-left"</PaperCode> open under the target's left edge, <PaperCode>"below-right"</PaperCode> under its right edge, and the <PaperCode>"above"</PaperCode> forms mirror them over the top. Without it, a plain <PaperCode>{"{ clientX, clientY }"}</PaperCode> target uses <PaperCode>"mouse"</PaperCode> and any other target uses <PaperCode>"below"</PaperCode>. Pass <PaperCode>menu.placement()</PaperCode> from the state object.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>x</PaperCode>, <PaperCode>y</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default</td>
                        <td>A fixed viewport position, in pixels. Used only when both are set; they replace <PaperCode>target</PaperCode> for position.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnEsc</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Escape asks the menu to close (from the top level; inside a submenu it first climbs out).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnClick</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Choosing an item asks the menu to close. <PaperCode>false</PaperCode> keeps it open after a choice.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>overlay</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Covers the page with a transparent click catcher while open. Outside presses dismiss either way; turn it off only where other controls must stay reachable.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>compact</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Smaller items: tighter padding, small text and icons. Submenus follow it. See <PaperLink href="#compact">Compact</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>keepMounted</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Keeps the menu in the page, hidden, while closed. Needed when items register themselves with a parent, as dropdown options do.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>matchTargetWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Makes the menu at least as wide as its target element (160 pixels at minimum). It still grows for wider items.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>initialHighlight</PaperCode></td>
                        <td><PaperCode>string | number | null</PaperCode></td>
                        <td>No default</td>
                        <td>The <PaperCode>value</PaperCode> of the item highlighted when the menu opens, scrolled into view.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the menu panel.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperContextMenuItem</PaperText>
            <PaperText preset="body" as="p">
                PaperContextMenuItemProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
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
                        <td>The item's label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>The children, when they are text</td>
                        <td>The item's identity for keyboard highlight and <PaperCode>initialHighlight</PaperCode>. It is also part of the element id. Keep it unique within the menu. An item whose label is not text and has no <PaperCode>value</PaperCode> gets a generated one, which <PaperCode>initialHighlight</PaperCode> cannot name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClick</PaperCode></td>
                        <td>Click handler</td>
                        <td>No default</td>
                        <td>Runs on choose, then the menu asks to close (unless <PaperCode>closeOnClick</PaperCode> is <PaperCode>false</PaperCode>). Not called when the item is disabled.</td>
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
                        <td>Secondary text under the label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>keybind</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A shortcut hint drawn at the end of the row. It only displays: register the key yourself.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>shortcut</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Alias of <PaperCode>keybind</PaperCode>. <PaperCode>keybind</PaperCode> wins when both are set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>danger</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws the item in the danger color, for destructive actions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the item, ignores clicks, and skips it in keyboard navigation. A disabled item can still carry a <PaperCode>description</PaperCode> that explains why.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>checked</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws a trailing check mark, for menus that choose a current value. Setting it, even to <PaperCode>false</PaperCode>, makes the item a <PaperCode>menuitemcheckbox</PaperCode> with <PaperCode>aria-checked</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="sub-props">PaperContextMenuSub</PaperText>
            <PaperText preset="body" as="p">
                PaperContextMenuSub is a row that opens a nested menu of its children. Its props extend <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
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
                        <td>No default</td>
                        <td>The row's text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Used as the text when <PaperCode>label</PaperCode> is not set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A string is a Material icon name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The nested items, usually <PaperCode>PaperContextMenuItem</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="header-props">PaperContextMenuHeader</PaperText>
            <PaperText preset="body" as="p">
                PaperContextMenuHeader is a non-interactive section label. It takes <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> and children, and keyboard navigation skips it.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="state-hook">useContextMenuState</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>useContextMenuState(initialPlacement?)</PaperCode> returns the state to wire into a menu.
                <PaperCode>initialPlacement</PaperCode> is a <PaperCode>ContextMenuPlacement</PaperCode> and defaults to <PaperCode>"mouse"</PaperCode>.
            </PaperText>
            <PaperCode block language="ts">
{`const menu = useContextMenuState(initialPlacement?: ContextMenuPlacement);

menu.isOpen(): boolean;
menu.target(): ContextMenuTarget;
menu.placement(): ContextMenuPlacement;
menu.openAtMouse(e: MouseEvent | PointerEvent): void;
menu.openAtCursor(e: MouseEvent | PointerEvent): void;
menu.openBelow(e: MouseEvent | PointerEvent | HTMLElement | Event, options?: { align?: "left" | "right" }): void;
menu.openAbove(e: MouseEvent | PointerEvent | HTMLElement | Event, options?: { align?: "left" | "right" }): void;
menu.close(): void;
menu.setTarget(target: ContextMenuTarget): void;
menu.setPlacement(placement: ContextMenuPlacement): void;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>isOpen</PaperCode></td>
                        <td>True while a target is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target</PaperCode>, <PaperCode>placement</PaperCode></td>
                        <td>Pass these to the menu's <PaperCode>target</PaperCode> and <PaperCode>placement</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>openAtMouse</PaperCode></td>
                        <td>Calls <PaperCode>preventDefault()</PaperCode> on the event, so the browser's menu does not show, and opens at the pointer. Use it as an <PaperCode>onContextMenu</PaperCode> handler. <PaperCode>openAtCursor</PaperCode> is an alias.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>openBelow</PaperCode></td>
                        <td>Opens under the event's element. <PaperCode>align: "right"</PaperCode> lines the menu's right edge up with the element's.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>openAbove</PaperCode></td>
                        <td>Opens over the element's top edge, with the same options as <PaperCode>openBelow</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>close</PaperCode></td>
                        <td>Clears the target. Pass it as <PaperCode>onClose</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setTarget</PaperCode>, <PaperCode>setPlacement</PaperCode></td>
                        <td>Set the target or the placement directly.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="placement">Placement</PaperText>
            <PaperTextList>
                <li>The menu renders in a portal on the page, fixed to the viewport, so a clipping ancestor such as a PaperCard cannot cut it off.</li>
                <li>Position is measured on the frame after it opens. A menu that would run past the bottom edge flips above its target, or moves up to fit; one that would run past the right edge anchors by its right edge to the target. It keeps at least 12 pixels from every viewport edge.</li>
                <li>The bottom edge is the top of a phone's on-screen keyboard while one is up. The menu moves when the keyboard comes or goes and when its own height changes, such as a select's search filtering it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="dismissal">Dismissal</PaperText>
            <PaperText preset="body" as="p">
                The menu calls <PaperCode>onClose</PaperCode> on any of these:
            </PaperText>
            <PaperTextList>
                <li>Escape, unless <PaperCode>closeOnEsc</PaperCode> is <PaperCode>false</PaperCode>.</li>
                <li>A press anywhere outside the menu and its submenus. A press on the target element, when the target is an element, does not count as outside, so the trigger's own click decides whether to reopen or close.</li>
                <li>A scroll of anything except the menu itself. While a text field in the menu has focus, such as a select's search, a scroll of the page moves the menu instead: a phone scrolls the page to make room for its keyboard.</li>
                <li>Choosing an item, unless <PaperCode>closeOnClick</PaperCode> is <PaperCode>false</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="keyboard">Keyboard and accessibility</PaperText>
            <PaperText preset="body" as="p">
                Keys are handled on the window while the menu is open. Focus does not move into the menu: the panel has <PaperCode>role="menu"</PaperCode> and exposes the highlighted row through <PaperCode>aria-activedescendant</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Down and Up arrows</td>
                        <td>Move the highlight within the current level, wrapping at the ends.</td>
                    </tr>
                    <tr>
                        <td>Home and End</td>
                        <td>Highlight the first and last item of the level.</td>
                    </tr>
                    <tr>
                        <td>Enter and Space</td>
                        <td>Choose the highlighted item, or open it when it is a submenu.</td>
                    </tr>
                    <tr>
                        <td>Right arrow</td>
                        <td>Open the highlighted submenu and highlight its first item.</td>
                    </tr>
                    <tr>
                        <td>Left arrow and Escape</td>
                        <td>Inside a submenu, close it and return to its row. Escape on the top level closes the menu.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li>Items have <PaperCode>role="menuitem"</PaperCode>, and an item with <PaperCode>checked</PaperCode> has <PaperCode>role="menuitemcheckbox"</PaperCode> and <PaperCode>aria-checked</PaperCode>. A submenu row has <PaperCode>aria-haspopup="menu"</PaperCode> and <PaperCode>aria-expanded</PaperCode>. A closed, kept-mounted menu has <PaperCode>aria-hidden</PaperCode>.</li>
                <li>Pointer hover highlights an item. Pressing and dragging across items highlights as you move, so a menu opened on press can be released over an item.</li>
                <li>A text field inside the menu keeps its own Space, Home, End, Left, and Right keys.</li>
                <li>A submenu opens on hover, on tap, or with the Right arrow. It flips to the left or upward when it has no room.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="right-click">Right-click menu</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperCode>openAtMouse</PaperCode> as the handler.
                The terminal panel does this for its copy and paste menu.
            </PaperText>
            <PaperCode block language="tsx">
{`import {
    PaperCard,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperText,
    useContextMenuState,
} from "@mileniumhq/paperui";

export function Surface(props: { copy: () => void; paste: () => void }) {
    const menu = useContextMenuState();

    return (
        <>
            <PaperCard padding="double" onContextMenu={menu.openAtMouse}>
                <PaperText preset="body" as="p">Right-click here.</PaperText>
            </PaperCard>
            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuItem icon="content_copy" onClick={props.copy}>Copy</PaperContextMenuItem>
                <PaperContextMenuItem icon="content_paste" onClick={props.paste}>Paste</PaperContextMenuItem>
            </PaperContextMenu>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="submenu">Submenu with a current value</PaperText>
            <PaperText preset="body" as="p">
                Nest items in <PaperCode>PaperContextMenuSub</PaperCode> and mark the current choice with <PaperCode>checked</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, For } from "solid-js";
import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuSub,
    useContextMenuState,
} from "@mileniumhq/paperui";

const sizes = ["Small", "Medium", "Large"];

export function ViewMenu() {
    const menu = useContextMenuState();
    const [size, setSize] = createSignal("Medium");

    return (
        <>
            <PaperButton icon title="View options" onClick={(e) => menu.openBelow(e, { align: "right" })}>
                more_vert
            </PaperButton>
            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuSub label="Size" icon="format_size">
                    <For each={sizes}>
                        {(option) => (
                            <PaperContextMenuItem checked={size() === option} onClick={() => setSize(option)}>
                                {option}
                            </PaperContextMenuItem>
                        )}
                    </For>
                </PaperContextMenuSub>
            </PaperContextMenu>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="disabled-reason">Explain an unavailable action</PaperText>
            <PaperText preset="body" as="p">
                A disabled item with a <PaperCode>description</PaperCode> tells the user why instead of vanishing, as the terminal panel does when its saved commands cannot be read.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperContextMenuItem icon="error" disabled description="The file could not be read">
    Saved commands unavailable
</PaperContextMenuItem>`}
            </PaperCode>
        </PaperFlex>
    );
}
