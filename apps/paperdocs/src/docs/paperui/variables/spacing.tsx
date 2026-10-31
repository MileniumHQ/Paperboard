import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function SpacingDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Spacing and layout</PaperText>
            <PaperText preset="body">
                PaperUI scales spacing, padding, and layout bounds from a base gap unit of 12 pixels.
                Reach for these variables when configuring grid gaps, container gutters, or component footprints.
                Using unified spacing tokens guarantees visual harmony across application views.
            </PaperText>

            <PaperText preset="subheader" id="gap-multipliers">Gap multipliers</PaperText>
            <PaperText preset="body">
                The spacing system scales proportionally from the base gap unit:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>CSS variable</th>
                        <th>Calculated value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>sixth</td>
                        <td><PaperCode>--paper-uigap-sixth</PaperCode></td>
                        <td>2px</td>
                    </tr>
                    <tr>
                        <td>third</td>
                        <td><PaperCode>--paper-uigap-third</PaperCode></td>
                        <td>4px</td>
                    </tr>
                    <tr>
                        <td>onefourth</td>
                        <td><PaperCode>--paper-uigap-onefourth</PaperCode></td>
                        <td>3px</td>
                    </tr>
                    <tr>
                        <td>half</td>
                        <td><PaperCode>--paper-uigap-half</PaperCode></td>
                        <td>6px</td>
                    </tr>
                    <tr>
                        <td>threefourths</td>
                        <td><PaperCode>--paper-uigap-threefourths</PaperCode></td>
                        <td>9px</td>
                    </tr>
                    <tr>
                        <td>full</td>
                        <td><PaperCode>--paper-uigap</PaperCode></td>
                        <td>12px</td>
                    </tr>
                    <tr>
                        <td>sixfourths</td>
                        <td><PaperCode>--paper-uigap-sixfourths</PaperCode></td>
                        <td>18px</td>
                    </tr>
                    <tr>
                        <td>double</td>
                        <td><PaperCode>--paper-uigap-double</PaperCode></td>
                        <td>24px</td>
                    </tr>
                    <tr>
                        <td>triple</td>
                        <td><PaperCode>--paper-uigap-triple</PaperCode></td>
                        <td>36px</td>
                    </tr>
                    <tr>
                        <td>quadruple</td>
                        <td><PaperCode>--paper-uigap-quadruple</PaperCode></td>
                        <td>48px</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="inset">Inset</PaperText>
            <PaperText preset="body">
                The inset is how far text sits in from a card's edge. PaperSettingList rows pad by it, and text outside a card indents by
                the same line so a section header, a hint under a card and the row titles inside it all start at one edge.
                Never pad text by hand to line it up: set inset on PaperText, or padding="inset" on a PaperCard or PaperFlex.
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Used by</th>
                        <th>CSS variable</th>
                        <th>Calculated value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>padding="inset"</td>
                        <td><PaperCode>--paper-inset</PaperCode></td>
                        <td>18px, the padding inside a card</td>
                    </tr>
                    <tr>
                        <td>PaperText inset, PaperSectionHeader</td>
                        <td><PaperCode>--paper-inset-outside</PaperCode></td>
                        <td>19px, the inset plus the card's border, for text outside the card</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="half">
    <PaperSectionHeader icon="lan" title="Ports" />
    <PaperSettingList autoHeight>
        <PaperSettingItem title="Refuse taken ports" />
    </PaperSettingList>
    <PaperText preset="hint" inset>No panel holds a port on this computer.</PaperText>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" id="border-radii">Border radii and widths</PaperText>
            <PaperText preset="body">
                Standard corner curvatures and border strokes:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Application</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-border-radius</PaperCode></td>
                        <td>12px</td>
                        <td>Standard cards, dialog boxes, and input frames</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-border-radius-half</PaperCode></td>
                        <td>6px</td>
                        <td>Compact buttons, keycaps, and inner chips</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-border-radius-pill</PaperCode></td>
                        <td>999px</td>
                        <td>Status badges and pill toggles</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-border-width</PaperCode></td>
                        <td>1px</td>
                        <td>Standard container borders and separators</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-thick-border-width</PaperCode></td>
                        <td>2px</td>
                        <td>Focus rings and emphasized outlines</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="control-and-panel-sizes">Control and panel sizes</PaperText>
            <PaperText preset="body">
                Fixed interactive box dimensions and panel footprints:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Dimension</th>
                        <th>Target element</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-control-size-tiny</PaperCode></td>
                        <td>28px</td>
                        <td>Compact toolbar buttons</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-control-size-small</PaperCode></td>
                        <td>32px</td>
                        <td>Dense table action buttons</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-control-size-medium</PaperCode></td>
                        <td>36px</td>
                        <td>Default button and input height</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-control-size-large</PaperCode></td>
                        <td>48px</td>
                        <td>Hero call-to-action buttons</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-size-panel</PaperCode></td>
                        <td>600px</td>
                        <td>Standard desktop panel width</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-size-sidebar</PaperCode></td>
                        <td>190px</td>
                        <td>Standard sidebar menu width</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-page-width</PaperCode></td>
                        <td>992px</td>
                        <td>Readable document column limit</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-page-width-wide</PaperCode></td>
                        <td>1400px</td>
                        <td>Wide dashboard content boundary</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="size-tokens">Size tokens</PaperText>
            <PaperText preset="body">
                Fixed sizes are never px or rem. Layout props that take a size (width, height, minWidth, maxWidth, minHeight, maxHeight, PaperGrid min, PaperMediaCardGroup minCardWidth) accept these names and resolve them to their variables.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex height="panel-height-small" minHeight={0}>
    <PaperGrid min="field">{fields}</PaperGrid>
</PaperFlex>`}
            </PaperCode>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Variable</th>
                        <th>Dimension</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"panel"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel</PaperCode></td>
                        <td>600px</td>
                        <td>Standard panel width</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-height"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-height</PaperCode></td>
                        <td>400px</td>
                        <td>Standard panel height</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-small"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-small</PaperCode></td>
                        <td>420px</td>
                        <td>Narrow column or dialog body</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-height-small"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-height-small</PaperCode></td>
                        <td>300px</td>
                        <td>Short fixed-height box, such as a picker</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-medium"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-medium</PaperCode></td>
                        <td>600px</td>
                        <td>Medium panel width</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-height-medium"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-height-medium</PaperCode></td>
                        <td>400px</td>
                        <td>Medium panel height</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-large"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-large</PaperCode></td>
                        <td>760px</td>
                        <td>Large panel width</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-height-large"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-height-large</PaperCode></td>
                        <td>520px</td>
                        <td>Large panel height</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-wide"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-wide</PaperCode></td>
                        <td>920px</td>
                        <td>Wide panel width</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"panel-height-wide"</PaperCode></td>
                        <td><PaperCode>--paper-size-panel-height-wide</PaperCode></td>
                        <td>580px</td>
                        <td>Wide panel height</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"sidebar"</PaperCode></td>
                        <td><PaperCode>--paper-size-sidebar</PaperCode></td>
                        <td>190px</td>
                        <td>Sidebar menu width</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"loader"</PaperCode></td>
                        <td><PaperCode>--paper-size-loader</PaperCode></td>
                        <td>400px</td>
                        <td>Loader and progress column</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"field-small"</PaperCode></td>
                        <td><PaperCode>--paper-size-field-small</PaperCode></td>
                        <td>88px</td>
                        <td>Short input, such as a port</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"field-medium"</PaperCode></td>
                        <td><PaperCode>--paper-size-field-medium</PaperCode></td>
                        <td>120px</td>
                        <td>Medium input</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"field"</PaperCode></td>
                        <td><PaperCode>--paper-size-field</PaperCode></td>
                        <td>160px</td>
                        <td>Default input or grid column</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"field-wide"</PaperCode></td>
                        <td><PaperCode>--paper-size-field-wide</PaperCode></td>
                        <td>240px</td>
                        <td>Slider in a settings row</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"bar"</PaperCode></td>
                        <td><PaperCode>--paper-size-bar</PaperCode></td>
                        <td>54px</td>
                        <td>Toolbar height</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"card-min"</PaperCode></td>
                        <td><PaperCode>--paper-size-card-min</PaperCode></td>
                        <td>256px</td>
                        <td>Smallest card in a card grid</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"split-side"</PaperCode></td>
                        <td><PaperCode>--paper-size-split-side</PaperCode></td>
                        <td>320px</td>
                        <td>PaperSplit side pane</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"menu-max"</PaperCode></td>
                        <td><PaperCode>--paper-size-menu-max</PaperCode></td>
                        <td>416px</td>
                        <td>Tallest dropdown menu</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="stacking">Stacking</PaperText>
            <PaperText preset="body">
                Name a layer instead of writing a z-index number. Each step sits above the one before it; layering inside one component is raised plus a small offset.
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Application</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-z-raised</PaperCode></td>
                        <td>1</td>
                        <td>Local stacking within a component</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-z-float</PaperCode></td>
                        <td>10</td>
                        <td>Insertion markers and in-flow overlays</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-z-sticky</PaperCode></td>
                        <td>50</td>
                        <td>Sidebars and pinned controls</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-z-drag</PaperCode></td>
                        <td>100</td>
                        <td>Elements being dragged</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-z-menu</PaperCode></td>
                        <td>1000</td>
                        <td>Menus and popovers</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-z-chrome</PaperCode></td>
                        <td>2000</td>
                        <td>Window chrome such as the title bar</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-z-ghost</PaperCode></td>
                        <td>3000</td>
                        <td>Drag ghosts above everything</td>
                    </tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
