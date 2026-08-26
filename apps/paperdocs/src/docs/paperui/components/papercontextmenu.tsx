import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperContextMenuSub,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
    useContextMenuState,
} from "@paperboard-dev/paperui";

export default function f() {
    const buttonMenu = useContextMenuState();
    const cursorMenu = useContextMenuState();

    return (
        <>
            <PaperText preset="header">PaperContextMenu</PaperText>
            <PaperText preset="body">
                <strong>PaperContextMenu</strong> is a portal-rendered contextual floating overlay menu component supporting cursor/element anchor positioning, cascading nested submenus, action headers, keyboard navigation, and reactive state management.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperContextMenu renders floating action sheets and dropdown command menus detached from parent scroll and overflow constraints via SolidJS <PaperCode>&lt;Portal&gt;</PaperCode>. It automatically computes viewport-bounded coordinates from pointer events or HTML DOM elements, avoids screen-edge clipping, manages keyboard navigation (<PaperCode>ArrowUp</PaperCode>, <PaperCode>ArrowDown</PaperCode>, <PaperCode>Enter</PaperCode>, <PaperCode>Space</PaperCode>), and closes upon backdrop clicks, outside scroll events, or <PaperCode>Escape</PaperCode> keypresses.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage-button" preset="subheader">
                Button dropdown menu
            </PaperText>
            <PaperText preset="body">
                Anchor menus beneath buttons or interactive controls using <PaperCode>openBelow(event)</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperContextMenuSub,
    PaperIcon,
    useContextMenuState,
} from "@paperboard-dev/paperui";

function DropdownDemo() {
    const menu = useContextMenuState();

    return (
        <>
            <PaperButton variant="blue" onClick={(e) => menu.openBelow(e)}>
                Actions <PaperIcon zeroHeight>expand_more</PaperIcon>
            </PaperButton>

            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuHeader>Item Operations</PaperContextMenuHeader>
                <PaperContextMenuItem icon={<PaperIcon zeroHeight>content_copy</PaperIcon>}>
                    Duplicate
                </PaperContextMenuItem>
                <PaperContextMenuSub title="Export Options" icon={<PaperIcon zeroHeight>file_download</PaperIcon>}>
                    <PaperContextMenuItem>Export as JSON</PaperContextMenuItem>
                    <PaperContextMenuItem>Export as Markdown</PaperContextMenuItem>
                </PaperContextMenuSub>
                <PaperContextMenuItem danger icon={<PaperIcon zeroHeight>delete</PaperIcon>}>
                    Delete
                </PaperContextMenuItem>
            </PaperContextMenu>
        </>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="double" wrap>
                    <PaperButton
                        variant="blue"
                        onClick={(e) => buttonMenu.openBelow(e)}
                    >
                        Open Dropdown <PaperIcon zeroHeight>expand_more</PaperIcon>
                    </PaperButton>

                    <PaperButton
                        variant="brand"
                        onContextMenu={(e) => {
                            e.preventDefault();
                            cursorMenu.openAtCursor(e);
                        }}
                    >
                        Right-Click for Context Menu
                    </PaperButton>
                </PaperFlex>
            </PaperContainer>

            {/* Dropdown Menu Instance */}
            <PaperContextMenu
                open={buttonMenu.isOpen()}
                target={buttonMenu.target()}
                placement={buttonMenu.placement()}
                onClose={buttonMenu.close}
            >
                <PaperContextMenuHeader>File Operations</PaperContextMenuHeader>
                <PaperContextMenuItem
                    icon={<PaperIcon zeroHeight>content_copy</PaperIcon>}
                    keybind="Ctrl+D"
                    onClick={() => buttonMenu.close()}
                >
                    Duplicate
                </PaperContextMenuItem>
                <PaperContextMenuSub
                    title="Export As"
                    icon={<PaperIcon zeroHeight>file_download</PaperIcon>}
                >
                    <PaperContextMenuItem onClick={() => buttonMenu.close()}>
                        JSON Format
                    </PaperContextMenuItem>
                    <PaperContextMenuItem onClick={() => buttonMenu.close()}>
                        CSV Spreadsheet
                    </PaperContextMenuItem>
                    <PaperContextMenuItem onClick={() => buttonMenu.close()}>
                        Markdown Document
                    </PaperContextMenuItem>
                </PaperContextMenuSub>
                <PaperContextMenuItem
                    danger
                    icon={<PaperIcon zeroHeight>delete</PaperIcon>}
                    keybind="Del"
                    onClick={() => buttonMenu.close()}
                >
                    Delete File
                </PaperContextMenuItem>
            </PaperContextMenu>

            {/* Right-click Cursor Menu Instance */}
            <PaperContextMenu
                open={cursorMenu.isOpen()}
                target={cursorMenu.target()}
                placement={cursorMenu.placement()}
                onClose={cursorMenu.close}
            >
                <PaperContextMenuHeader>Canvas Actions</PaperContextMenuHeader>
                <PaperContextMenuItem
                    icon={<PaperIcon zeroHeight>refresh</PaperIcon>}
                    keybind="Ctrl+R"
                    onClick={() => cursorMenu.close()}
                >
                    Reload Canvas
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    icon={<PaperIcon zeroHeight>zoom_in</PaperIcon>}
                    keybind="Ctrl++"
                    onClick={() => cursorMenu.close()}
                >
                    Zoom to Fit
                </PaperContextMenuItem>
                <PaperContextMenuSub
                    title="Grid Overlay"
                    icon={<PaperIcon zeroHeight>grid_4x4</PaperIcon>}
                >
                    <PaperContextMenuItem onClick={() => cursorMenu.close()}>
                        Isometric Grid
                    </PaperContextMenuItem>
                    <PaperContextMenuItem onClick={() => cursorMenu.close()}>
                        Dot Matrix
                    </PaperContextMenuItem>
                </PaperContextMenuSub>
            </PaperContextMenu>

            <PaperSeparator />

            <PaperText id="state-hook" preset="subheader">
                State hook API (<PaperCode>useContextMenuState</PaperCode>)
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Method / Accessor</th>
                        <th>Type Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>isOpen()</PaperCode></td>
                        <td><PaperCode>() =&gt; boolean</PaperCode></td>
                        <td>Returns true when a target element or coordinates are active.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target()</PaperCode></td>
                        <td><PaperCode>() =&gt; ContextMenuTarget</PaperCode></td>
                        <td>The originating DOM element or pointer coordinate object.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>openBelow(e, options?)</PaperCode></td>
                        <td><PaperCode>(e: MouseEvent | HTMLElement, options?: &#123; align?: "left" | "right" &#125;) =&gt; void</PaperCode></td>
                        <td>Positions the menu below the target element.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>openAbove(e, options?)</PaperCode></td>
                        <td><PaperCode>(e: MouseEvent | HTMLElement, options?: &#123; align?: "left" | "right" &#125;) =&gt; void</PaperCode></td>
                        <td>Positions the menu above the target element.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>openAtCursor(e)</PaperCode> / <PaperCode>openAtMouse(e)</PaperCode></td>
                        <td><PaperCode>(e: MouseEvent) =&gt; void</PaperCode></td>
                        <td>Positions the menu at pointer client coordinates.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>close()</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Closes the menu and resets target coordinates to null.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>

            <PaperText id="props-context-menu" preset="title">
                PaperContextMenu props
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Controls visibility of the floating context menu.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>x</PaperCode> / <PaperCode>y</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Direct viewport coordinates for positioning the menu, bypassing <PaperCode>target</PaperCode> resolution.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target</PaperCode></td>
                        <td><PaperCode>MouseEvent | HTMLElement | object</PaperCode></td>
                        <td><PaperCode>null</PaperCode></td>
                        <td>Anchor target used to calculate viewport coordinates.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>placement</PaperCode></td>
                        <td><PaperCode>"mouse" | "below" | "below-left" | "below-right" | "above" | "above-left" | "above-right"</PaperCode></td>
                        <td><PaperCode>"mouse"</PaperCode></td>
                        <td>Anchor orientation relative to the target. Without an explicit placement, element targets resolve to <PaperCode>"below"</PaperCode> while mouse targets follow the cursor.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback executed upon backdrop dismiss, outside scroll, or Escape.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnEsc</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Enables dismissal upon pressing the Escape key.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeOnClick</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Enables dismissal when clicking an interactive item.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-menu-item" preset="title">
                PaperContextMenuItem props
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Identifier used for keyboard highlight tracking; falls back to the item's text content when omitted.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Leading icon element or Material Symbol glyph name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Secondary text rendered beneath the item label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>keybind</PaperCode> / <PaperCode>shortcut</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Trailing keyboard shortcut badge (e.g. <PaperCode>"Ctrl+C"</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>danger</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Applies destructive red hover styling for deletion actions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Deactivates clicks and renders muted opacity.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papermenu">PaperMenu</PaperLink> — Inline navigation menu component.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papermodal">PaperModal</PaperLink> — Centered modal dialog primitive.
                </PaperText>
            </PaperTextList>
        </>
    );
}
