import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function SurfacesDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Surfaces and borders</PaperText>
            <PaperText preset="body">
                PaperUI models interface elevation through surface luminance rather than drop shadows.
                Reach for surface and border tokens when creating custom containers, dialog popups, or divider lines.
                Tokens adjust their luminance across light and dark themes to preserve depth hierarchy.
            </PaperText>

            <PaperText preset="subheader" id="surface-elevation">Surface elevation</PaperText>
            <PaperText preset="body">
                Surfaces stack in order of increasing visual luminance:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Role</th>
                        <th>Light value</th>
                        <th>Dark value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-surface-app</PaperCode></td>
                        <td>Base canvas window background</td>
                        <td>#d8dce2</td>
                        <td>#141517</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-surface-sunken</PaperCode></td>
                        <td>Recessed side navigation or panel background</td>
                        <td>#e2e6eb</td>
                        <td>#1a1b1e</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-surface</PaperCode></td>
                        <td>Standard container and card surface</td>
                        <td>#f6f8fa</td>
                        <td>#202124</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-surface-raised</PaperCode></td>
                        <td>Elevated card or modal dialog background</td>
                        <td>#ffffff</td>
                        <td>#27282b</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-surface-inset</PaperCode></td>
                        <td>Recessed wells beneath canvas depth</td>
                        <td>#eceff3</td>
                        <td>#0f1011</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-surface-element</PaperCode></td>
                        <td>Interactive control fill surface</td>
                        <td>#cdd3db</td>
                        <td>#323337</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="border-contrast">Border contrast</PaperText>
            <PaperText preset="body">
                Borders provide four tiers of edge emphasis:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Usage</th>
                        <th>Light value</th>
                        <th>Dark value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-border-subtle</PaperCode></td>
                        <td>Internal divider lines and quiet separators</td>
                        <td>#d2d6dd</td>
                        <td>#33353a</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-border</PaperCode></td>
                        <td>Standard component and card boundary outline</td>
                        <td>#c4c9d2</td>
                        <td>#3a3c40</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-border-strong</PaperCode></td>
                        <td>Active focus rings and emphasized boundaries</td>
                        <td>#adb3be</td>
                        <td>#4d5055</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-border-emphasis</PaperCode></td>
                        <td>Drop target highlights and heavy outlines</td>
                        <td>#7d8492</td>
                        <td>#676a70</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Apply surface tokens directly in custom card styles:
            </PaperText>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperCard surface="back" padding="full">
                        <PaperText preset="body" color="text-subtle">Surface: back</PaperText>
                    </PaperCard>
                    <PaperCard surface="front" padding="full">
                        <PaperText preset="body" color="text-subtle">Surface: front</PaperText>
                    </PaperCard>
                    <PaperCard surface="frontest" padding="full">
                        <PaperText preset="body" color="text-subtle">Surface: frontest</PaperText>
                    </PaperCard>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
