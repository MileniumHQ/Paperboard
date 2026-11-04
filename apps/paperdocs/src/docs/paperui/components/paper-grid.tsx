import { For } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperGrid,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const cells = ["One", "Two", "Three", "Four", "Five", "Six"];

export default function PaperGridDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperGrid</PaperText>
            <PaperText preset="body" as="p">
                PaperGrid lays children out in a responsive grid of equal columns.
                Use it for a set of cards or tiles, such as stat tiles, player cards, or field groups, that should reflow as the panel resizes.
                It needs no inline styles from you.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                With no props the grid fits as many columns as the width allows, each at least <PaperCode>--paper-grid-min</PaperCode> (200 pixels) wide.
                Columns share the leftover width equally.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperGrid>
                    <For each={cells}>
                        {(cell) => (
                            <PaperCard padding="full" surface="back">
                                <PaperText preset="body" as="p">{cell}</PaperText>
                            </PaperCard>
                        )}
                    </For>
                </PaperGrid>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { For } from "solid-js";
import { PaperCard, PaperGrid, PaperText } from "@mileniumhq/paperui";

const cells = ["One", "Two", "Three", "Four", "Five", "Six"];

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperGrid>
                <For each={cells}>
                    {(cell) => (
                        <PaperCard padding="full" surface="back">
                            <PaperText preset="body" as="p">{cell}</PaperText>
                        </PaperCard>
                    )}
                </For>
            </PaperGrid>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperGridProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the root <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>min</PaperCode></td>
                        <td><PaperCode>PaperSize | string</PaperCode></td>
                        <td><PaperCode>--paper-grid-min</PaperCode> (200 pixels)</td>
                        <td>The minimum column width. A size token such as <PaperCode>"field"</PaperCode> (160 pixels) resolves to its <PaperCode>--paper-size-*</PaperCode> variable. Any other string is used as a CSS length. Ignored when <PaperCode>columns</PaperCode> is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>columns</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (auto-fit by <PaperCode>min</PaperCode>)</td>
                        <td>A fixed number of equal columns that never reflow. Columns can shrink to zero width, so give narrow screens a smaller count yourself.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root. An object <PaperCode>style</PaperCode> is merged after the column definition and can override it.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="size-tokens">Size tokens for min</PaperText>
            <PaperText preset="body" as="p">
                Tokens usable for <PaperCode>min</PaperCode>: <PaperCode>field-small</PaperCode> (88 pixels), <PaperCode>field-medium</PaperCode> (120), <PaperCode>field</PaperCode> (160), <PaperCode>field-wide</PaperCode> (240), <PaperCode>card-min</PaperCode> (256), <PaperCode>sidebar</PaperCode> (190), and the <PaperCode>panel</PaperCode> sizes.
                See <PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink> for the full list.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The grid is a CSS grid with a gap of <PaperCode>--paper-uigap</PaperCode> (12 pixels), full width of its parent, with no padding.</li>
                <li>Auto-fit uses <PaperCode>repeat(auto-fill, minmax(min, 1fr))</PaperCode>. Rows size to their tallest cell, and a short last row leaves empty tracks instead of stretching its cells.</li>
                <li>Children are not wrapped. Put a <PaperCode>PaperCard</PaperCode> or <PaperCode>PaperStatTile</PaperCode> directly inside.</li>
                <li>The grid has no role, no scrolling, and no empty state. Render a <PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink> instead of an empty grid.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="fixed-columns">Fixed columns</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperGrid columns={3}>
                    <For each={cells}>
                        {(cell) => (
                            <PaperCard padding="full" surface="back">
                                <PaperText preset="body" as="p">{cell}</PaperText>
                            </PaperCard>
                        )}
                    </For>
                </PaperGrid>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperGrid columns={3}>
    <For each={cells}>
        {(cell) => (
            <PaperCard padding="full" surface="back">
                <PaperText preset="body" as="p">{cell}</PaperText>
            </PaperCard>
        )}
    </For>
</PaperGrid>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="narrow-columns">Narrower columns with a token</PaperText>
            <PaperText preset="body" as="p">
                The gameserver panel uses <PaperCode>min="field"</PaperCode> for its player and overview tiles, which fits more columns than the default.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperGrid min="field">
    <For each={cells}>
        {(cell) => (
            <PaperCard padding="full" surface="back">
                <PaperText preset="body" as="p">{cell}</PaperText>
            </PaperCard>
        )}
    </For>
</PaperGrid>`}
            </PaperCode>
        </PaperFlex>
    );
}
