import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuHeader,
    PaperFlex,
    PaperTable,
    PaperText,
    useContextMenuState,
} from "@paperboard-dev/paperui";

export default function PaperContextMenuDoc() {
    const menu = useContextMenuState();

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperContextMenu</PaperText>
            <PaperText preset="body">
                PaperContextMenu displays floating action menus anchored to cursor coordinates or trigger elements.
                Reach for PaperContextMenu when implementing right-click popups, item action dropdowns, or nested tool menus.
                The menu renders in a portal overlay and manages boundary collision detection.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Manage open and positioning state using the useContextMenuState hook.
                Attach the trigger to an element and render menu items within PaperContextMenu.
            </PaperText>
            <PaperCode block language="tsx">
{`import {
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuHeader,
    PaperButton,
    PaperCard,
    useContextMenuState,
} from "@paperboard-dev/paperui";

export function Example() {
    const menu = useContextMenuState();

    return (
        <PaperCard padding="double" surface="front">
            <PaperButton
                onClick={(e) => menu.openBelow(e.currentTarget)}
            >
                Open menu
            </PaperButton>

            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuHeader>Actions</PaperContextMenuHeader>
                <PaperContextMenuItem icon="edit">Edit</PaperContextMenuItem>
                <PaperContextMenuItem icon="content_copy">Duplicate</PaperContextMenuItem>
                <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
            </PaperContextMenu>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperButton
                    onClick={(e) => menu.openBelow(e.currentTarget)}
                >
                    Open menu
                </PaperButton>

                <PaperContextMenu
                    open={menu.isOpen()}
                    target={menu.target()}
                    placement={menu.placement()}
                    onClose={menu.close}
                >
                    <PaperContextMenuHeader>Actions</PaperContextMenuHeader>
                    <PaperContextMenuItem icon="edit">Edit</PaperContextMenuItem>
                    <PaperContextMenuItem icon="content_copy">Duplicate</PaperContextMenuItem>
                    <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
                </PaperContextMenu>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperContextMenu accepts positioning and dismissal controls:
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
                            <td>Controls visibility of the context menu portal.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>target</PaperCode></td>
                            <td><PaperCode>ContextMenuTarget</PaperCode></td>
                            <td><PaperCode>null</PaperCode></td>
                            <td>Anchor reference: MouseEvent, PointerEvent, HTMLElement, or coordinate pair.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>placement</PaperCode></td>
                            <td><PaperCode>ContextMenuPlacement</PaperCode></td>
                            <td><PaperCode>"mouse"</PaperCode></td>
                            <td>Where the menu opens. <PaperCode>"mouse"</PaperCode> opens at the pointer. <PaperCode>"below"</PaperCode> and <PaperCode>"below-left"</PaperCode> open under the target with left edges aligned, and <PaperCode>"below-right"</PaperCode> with right edges aligned. The <PaperCode>"above"</PaperCode> variants use the same edges from the target's top edge. A menu that would leave the viewport on the right anchors to the target's right edge instead.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onClose</PaperCode></td>
                            <td><PaperCode>() =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Callback executed when clicking outside the menu or pressing Escape.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>closeOnEsc</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Closes the menu when the user presses Escape.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>closeOnClick</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Closes the menu when any non-disabled item is clicked.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The menu clamps its coordinate offsets to prevent spilling past viewport borders.
                ArrowUp, ArrowDown, Home, and End move the highlight. Enter or Space picks the highlighted item.
            </PaperText>
            <PaperText preset="body">
                A <PaperCode>PaperContextMenuSub</PaperCode> row is a menu item with its own list.
                ArrowRight, Enter, or Space opens it and highlights its first item. The arrows then move within the submenu only.
                ArrowLeft or Escape closes the submenu and returns the highlight to its row. Escape at the top level closes the menu.
                Pointer users open a submenu by hovering or clicking its row.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Add keyboard shortcuts and descriptions to items.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperContextMenuItem icon="save" keybind="Ctrl+S" description="Save current state">
    Save
</PaperContextMenuItem>`}
            </PaperCode>
        </PaperFlex>
    );
}
