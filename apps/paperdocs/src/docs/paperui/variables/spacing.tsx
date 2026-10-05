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
        </PaperFlex>
    );
}
