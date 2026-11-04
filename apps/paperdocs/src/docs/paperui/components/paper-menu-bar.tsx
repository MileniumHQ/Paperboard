import {
    PaperCard,
    PaperCode,
    PaperContextMenuItem,
    PaperFlex,
    PaperLink,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperMenuBarDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperMenuBar</PaperText>
            <PaperText preset="body" as="p">
                PaperMenuBar is a row of labels that each open a dropdown of actions, like the File and Edit bar of a desktop app.
                Use it for a panel with many commands, such as an editor, where one toolbar button per command would not fit.
                For a single menu on a button or a right-click, use <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put one <PaperCode>PaperMenuBarMenu</PaperCode> per label inside the bar.
                Its children are the dropdown, built from <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink> parts.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperMenuBar aria-label="Example">
                    <PaperMenuBarMenu label="File">
                        <PaperContextMenuItem icon="add" onClick={() => undefined}>New</PaperContextMenuItem>
                        <PaperContextMenuItem icon="file_open" onClick={() => undefined}>Open</PaperContextMenuItem>
                        <PaperSeparator role="separator" />
                        <PaperContextMenuItem icon="delete" danger onClick={() => undefined}>Delete</PaperContextMenuItem>
                    </PaperMenuBarMenu>
                    <PaperMenuBarMenu label="Edit">
                        <PaperContextMenuItem icon="undo" onClick={() => undefined}>Undo</PaperContextMenuItem>
                        <PaperContextMenuItem icon="redo" disabled>Redo</PaperContextMenuItem>
                    </PaperMenuBarMenu>
                </PaperMenuBar>
            </PaperCard>
            <PaperCode block language="tsx">
{`import {
    PaperContextMenuItem,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperSeparator,
} from "@mileniumhq/paperui";

export function Example(props: { onNew: () => void; onOpen: () => void; onDelete: () => void; onUndo: () => void }) {
    return (
        <PaperMenuBar aria-label="Example">
            <PaperMenuBarMenu label="File">
                <PaperContextMenuItem icon="add" onClick={props.onNew}>New</PaperContextMenuItem>
                <PaperContextMenuItem icon="file_open" onClick={props.onOpen}>Open</PaperContextMenuItem>
                <PaperSeparator role="separator" />
                <PaperContextMenuItem icon="delete" danger onClick={props.onDelete}>Delete</PaperContextMenuItem>
            </PaperMenuBarMenu>
            <PaperMenuBarMenu label="Edit">
                <PaperContextMenuItem icon="undo" onClick={props.onUndo}>Undo</PaperContextMenuItem>
                <PaperContextMenuItem icon="redo" disabled>Redo</PaperContextMenuItem>
            </PaperMenuBarMenu>
        </PaperMenuBar>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="bar-props">PaperMenuBar</PaperText>
            <PaperText preset="body" as="p">
                PaperMenuBarProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> and adds none of its own.
                The element has <PaperCode>role="menubar"</PaperCode> and <PaperCode>aria-orientation="horizontal"</PaperCode>.
                Set <PaperCode>aria-label</PaperCode> to name the bar. <PaperCode>class</PaperCode> and <PaperCode>classList</PaperCode> are added to the bar.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="menu-props">PaperMenuBarMenu</PaperText>
            <PaperText preset="body" as="p">
                PaperMenuBarMenuProps extends <PaperCode>JSX.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;</PaperCode> without <PaperCode>children</PaperCode>.
                The label is a <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink> with the <PaperCode>text</PaperCode> variant. The component sets its role, ARIA state, tab order, and focus, hover, and click handlers itself, so props for those do not take effect.
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
                        <td>No default (required)</td>
                        <td>The text on the bar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The dropdown: <PaperCode>PaperContextMenuItem</PaperCode>, <PaperCode>PaperContextMenuSub</PaperCode>, and <PaperLink href="/docs/paperui/paperseparator/">PaperSeparator</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>PaperButtonSize</PaperCode></td>
                        <td><PaperCode>"small"</PaperCode></td>
                        <td>The label's button size. Use <PaperCode>"tiny"</PaperCode> for a bar under a title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the label. It never opens, by click or hover, and arrow keys skip it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the label button.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="opening">Opening and closing</PaperText>
            <PaperTextList>
                <li>A click opens the label's dropdown below its left edge. A click on the open label closes it.</li>
                <li>While one dropdown is open, moving the pointer onto another label switches to that one. With every dropdown closed, hovering opens nothing. A touch does not switch on pass-over: tap the label.</li>
                <li>Choosing an item runs its <PaperCode>onClick</PaperCode> and closes the dropdown. A disabled item does nothing and leaves it open.</li>
                <li>Escape, or a press outside the dropdown, closes it. The dropdown draws no click-catching overlay, so the rest of the page stays reachable.</li>
                <li>On close, focus goes back to the label, unless it moved into a field you clicked outside the dropdown.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="keyboard">Keyboard</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>State</th>
                        <th>Key</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Focus on a label</td>
                        <td>Tab</td>
                        <td>The bar is one tab stop. It lands on the label that last had focus, or the first.</td>
                    </tr>
                    <tr>
                        <td>Focus on a label</td>
                        <td>Left and Right arrows</td>
                        <td>Move focus to the previous or next label, wrapping at the ends and skipping disabled ones.</td>
                    </tr>
                    <tr>
                        <td>Focus on a label</td>
                        <td>Home and End</td>
                        <td>Focus the first or last label.</td>
                    </tr>
                    <tr>
                        <td>Focus on a label</td>
                        <td>Enter, Space, Down, Up</td>
                        <td>Open the dropdown. Down highlights its first item and Up its last.</td>
                    </tr>
                    <tr>
                        <td>Dropdown open</td>
                        <td>Up, Down, Enter, Escape</td>
                        <td>Handled by the dropdown as in <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td>Dropdown open</td>
                        <td>Left and Right arrows</td>
                        <td>Open the previous or next label's dropdown. On a submenu row, Right opens the submenu instead, and inside a submenu, Left closes it.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperTextList>
                <li>Each label has <PaperCode>role="menuitem"</PaperCode>, <PaperCode>aria-haspopup="menu"</PaperCode>, and <PaperCode>aria-expanded</PaperCode>. The dropdown is named by its label.</li>
                <li>The dropdown mounts only while open.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                A <PaperCode>PaperMenuBarMenu</PaperCode> outside a <PaperCode>PaperMenuBar</PaperCode> throws <PaperCode>PaperMenuBarMenu must be rendered inside a PaperMenuBar</PaperCode> when it renders.
                Handlers on dropdown items are yours: show a failed action to the user in the handler.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="editor-bar">Editor bar under a title</PaperText>
            <PaperText preset="body" as="p">
                The Actions panel puts a tiny bar under the project name, with Project, File, Backup, and Insert menus.
                Dangerous items sit below a separator, in the danger color.
            </PaperText>
            <PaperCode block language="tsx">
{`import {
    PaperContextMenuItem,
    PaperFlex,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperSeparator,
    PaperText,
} from "@mileniumhq/paperui";

export function ProjectHeader(props: {
    name: string;
    onRename: () => void;
    onDelete: () => void;
    onExport: () => void;
}) {
    return (
        <PaperFlex direction="column" align="flex-start" gap="onefourth">
            <PaperText preset="label" as="h2">{props.name}</PaperText>
            <PaperMenuBar aria-label={props.name}>
                <PaperMenuBarMenu label="Project" size="tiny">
                    <PaperContextMenuItem icon="edit" onClick={props.onRename}>Rename</PaperContextMenuItem>
                    <PaperSeparator role="separator" />
                    <PaperContextMenuItem icon="delete" danger onClick={props.onDelete}>Delete</PaperContextMenuItem>
                </PaperMenuBarMenu>
                <PaperMenuBarMenu label="File" size="tiny">
                    <PaperContextMenuItem icon="file_export" onClick={props.onExport}>Export</PaperContextMenuItem>
                </PaperMenuBarMenu>
            </PaperMenuBar>
        </PaperFlex>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
