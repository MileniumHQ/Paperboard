import {
    PaperCard,
    PaperCode,
    PaperContextMenuItem,
    PaperContextMenuSub,
    PaperFlex,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperSeparator,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperMenuBarDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperMenuBar</PaperText>
            <PaperText preset="body">
                PaperMenuBar renders a row of text menus such as File and Edit, each opening a dropdown of actions.
                Reach for PaperMenuBar when a view has more actions than buttons can hold, or when actions group by topic.
                It behaves like a desktop menu bar, so hovering across the labels switches menus and the arrow keys move around.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Put one PaperMenuBarMenu per label inside PaperMenuBar.
                A menu's children are the dropdown: PaperContextMenuItem for actions, PaperContextMenuSub for nested lists and PaperSeparator with <PaperCode>role="separator"</PaperCode> to group them.
                The bar only holds the menus, so a title beside or above it is plain layout.
            </PaperText>
            <PaperCode block language="tsx">
{`import {
    PaperCard,
    PaperContextMenuItem,
    PaperContextMenuSub,
    PaperFlex,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperSeparator,
    PaperText,
} from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="none">
                <PaperText preset="subheader">Title</PaperText>
                <PaperMenuBar aria-label="Project">
                    <PaperMenuBarMenu label="File">
                        <PaperContextMenuItem icon="add" keybind="Ctrl+N">New</PaperContextMenuItem>
                        <PaperContextMenuItem icon="save" keybind="Ctrl+S">Save</PaperContextMenuItem>
                        <PaperContextMenuItem icon="edit" disabled>Rename</PaperContextMenuItem>
                        <PaperSeparator role="separator" />
                        <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
                    </PaperMenuBarMenu>
                    <PaperMenuBarMenu label="Edit">
                        <PaperContextMenuItem icon="undo" keybind="Ctrl+Z">Undo</PaperContextMenuItem>
                        <PaperContextMenuItem icon="redo" keybind="Ctrl+Shift+Z">Redo</PaperContextMenuItem>
                        <PaperContextMenuSub label="Paste as" icon="content_paste">
                            <PaperContextMenuItem>Plain text</PaperContextMenuItem>
                            <PaperContextMenuItem>Formatted</PaperContextMenuItem>
                        </PaperContextMenuSub>
                    </PaperMenuBarMenu>
                </PaperMenuBar>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="none">
                    <PaperText preset="subheader">Title</PaperText>
                    <PaperMenuBar aria-label="Project">
                        <PaperMenuBarMenu label="File">
                            <PaperContextMenuItem icon="add" keybind="Ctrl+N">New</PaperContextMenuItem>
                            <PaperContextMenuItem icon="save" keybind="Ctrl+S">Save</PaperContextMenuItem>
                            <PaperContextMenuItem icon="edit" disabled>Rename</PaperContextMenuItem>
                            <PaperSeparator role="separator" />
                            <PaperContextMenuItem icon="delete" danger>Delete</PaperContextMenuItem>
                        </PaperMenuBarMenu>
                        <PaperMenuBarMenu label="Edit">
                            <PaperContextMenuItem icon="undo" keybind="Ctrl+Z">Undo</PaperContextMenuItem>
                            <PaperContextMenuItem icon="redo" keybind="Ctrl+Shift+Z">Redo</PaperContextMenuItem>
                            <PaperContextMenuSub label="Paste as" icon="content_paste">
                                <PaperContextMenuItem>Plain text</PaperContextMenuItem>
                                <PaperContextMenuItem>Formatted</PaperContextMenuItem>
                            </PaperContextMenuSub>
                        </PaperMenuBarMenu>
                        <PaperMenuBarMenu label="View" disabled>
                            <PaperContextMenuItem>Zoom in</PaperContextMenuItem>
                        </PaperMenuBarMenu>
                    </PaperMenuBar>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperMenuBar is a plain container and accepts the usual div attributes. Give it an <PaperCode>aria-label</PaperCode> that names what the menus act on.
                Each PaperMenuBarMenu takes these props, plus any button prop, which lands on its label:
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
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td>Required</td>
                            <td>The text on the bar. It also names the dropdown for screen readers.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>disabled</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Dims the label and keeps its menu closed. Arrow keys skip it.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>"tiny" | "small" | "medium" | "large"</PaperCode></td>
                            <td><PaperCode>"small"</PaperCode></td>
                            <td>The label's PaperButton size. Use tiny for a bar tucked under a document's title.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>children</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>The dropdown: <PaperCode>PaperContextMenuItem</PaperCode>, <PaperCode>PaperContextMenuSub</PaperCode>, <PaperCode>PaperContextMenuHeader</PaperCode> and <PaperCode>PaperSeparator</PaperCode>. Items take the same <PaperCode>icon</PaperCode>, <PaperCode>keybind</PaperCode>, <PaperCode>description</PaperCode>, <PaperCode>danger</PaperCode>, <PaperCode>disabled</PaperCode> and <PaperCode>checked</PaperCode> props as in PaperContextMenu.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                A click on a label opens its menu, and a click on the open label closes it.
                While one menu is open, moving the pointer onto another label switches to that menu. Touch screens have no hover, so a tap switches instead.
                Choosing an item runs its <PaperCode>onClick</PaperCode> and closes the menu. Escape or a press anywhere outside closes it too.
                Other controls on the page stay reachable while a menu is open.
            </PaperText>
            <PaperText preset="body">
                The bar is a single tab stop. With focus on a label, ArrowLeft and ArrowRight move to the adjacent label, Home and End jump to the first and last, and ArrowDown or ArrowUp open the menu on its first or last item. Enter or Space opens it from the label.
                Once a menu is open, ArrowUp, ArrowDown, Home and End move within it, Enter picks the highlighted item, and ArrowLeft and ArrowRight move to the adjacent menu and keep it open. On a submenu row, ArrowRight opens the submenu and ArrowLeft inside it closes it again.
                When a menu closes by Escape or a pick, focus returns to its label.
            </PaperText>
            <PaperText preset="body">
                The roles follow the ARIA menu bar pattern: the bar is <PaperCode>menubar</PaperCode>, each label is a <PaperCode>menuitem</PaperCode> with <PaperCode>aria-haspopup</PaperCode> and <PaperCode>aria-expanded</PaperCode>, and each dropdown is a <PaperCode>menu</PaperCode> labelled by its label.
                A PaperMenuBarMenu outside a PaperMenuBar throws.
            </PaperText>
        </PaperFlex>
    );
}
