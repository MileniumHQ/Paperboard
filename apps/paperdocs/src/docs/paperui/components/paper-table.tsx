import {
    PaperBadge,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperTableDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperTable</PaperText>
            <PaperText preset="body" as="p">
                PaperTable is a styled HTML table for rows of data that line up in columns, such as a list of players, roles, or settings.
                Write the usual <PaperCode>thead</PaperCode>, <PaperCode>tbody</PaperCode>, <PaperCode>tr</PaperCode>, <PaperCode>th</PaperCode>, and <PaperCode>td</PaperCode> inside it.
                For label and value pairs, use <PaperLink href="/docs/paperui/paperkeyvaluelist/">PaperKeyValueList</PaperLink>, and for rows that act like buttons, <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                The component draws the border, header, and row styling.
                Everything inside is plain table markup.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperTable>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>First</td>
                            <td><PaperBadge variant="success">Online</PaperBadge></td>
                            <td>The text in the last column wraps when it is long.</td>
                        </tr>
                        <tr>
                            <td>Second</td>
                            <td><PaperBadge variant="monochrome">Off</PaperBadge></td>
                            <td>Short note.</td>
                        </tr>
                    </tbody>
                </PaperTable>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperTable } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperTable>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Notes</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>First</td>
                    <td><PaperBadge variant="success">Online</PaperBadge></td>
                    <td>The text in the last column wraps when it is long.</td>
                </tr>
                <tr>
                    <td>Second</td>
                    <td><PaperBadge variant="monochrome">Off</PaperBadge></td>
                    <td>Short note.</td>
                </tr>
            </tbody>
        </PaperTable>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperTableProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLTableElement&gt;</PaperCode> and adds none of its own.
                Other props land on the <PaperCode>table</PaperCode>. <PaperCode>class</PaperCode> and <PaperCode>classList</PaperCode> go on the <PaperCode>table</PaperCode> too, not on the wrapper. Children are the table's content.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="layout">Layout</PaperText>
            <PaperTextList>
                <li>The table sits in a wrapper that has the border, the rounded corners, and the raised surface. The wrapper scrolls sideways when the table is wider than its container.</li>
                <li>Header cells (<PaperCode>th</PaperCode>) are bold, muted, on a darker surface, and never wrap.</li>
                <li>Data cells (<PaperCode>td</PaperCode>) in every column but the last never wrap. The last column wraps its text and is at least as wide as a sidebar. Put the longest text in the last column, and keep short values, badges, and buttons in the earlier ones.</li>
                <li>Cells are vertically centered. Rows have a divider between them, and the last row has none. A row tints slightly under the pointer.</li>
                <li>Text is left-aligned at the small text size. The table has no sorting, selection, or pagination. For paging, add <PaperLink href="/docs/paperui/paperpagination/">PaperPagination</PaperLink> under it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperText preset="body" as="p">
                The markup is a real table, so assistive technology reads rows and columns.
                Use <PaperCode>th</PaperCode> for headers, and <PaperCode>scope="col"</PaperCode> or <PaperCode>scope="row"</PaperCode> where the headers are not obvious.
                Name a table with an <PaperCode>aria-label</PaperCode>, which lands on the <PaperCode>table</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="data-rows">Rows from data</PaperText>
            <PaperText preset="body" as="p">
                Render the body with <PaperCode>For</PaperCode>.
                The Bot panel lists a server's roles this way, with a swatch of the role color in the first column.
            </PaperText>
            <PaperCode block language="tsx">
{`import { For } from "solid-js";
import { PaperSwatch, PaperTable } from "@mileniumhq/paperui";

interface Role {
    id: string;
    name: string;
    color: string;
    members: number;
}

export function Roles(props: { roles: Role[] }) {
    return (
        <PaperTable aria-label="Roles">
            <thead>
                <tr>
                    <th>Role</th>
                    <th>Members</th>
                </tr>
            </thead>
            <tbody>
                <For each={props.roles}>
                    {(role) => (
                        <tr>
                            <td>
                                <PaperSwatch color={role.color} /> {role.name}
                            </td>
                            <td>{role.members}</td>
                        </tr>
                    )}
                </For>
            </tbody>
        </PaperTable>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
