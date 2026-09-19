import {
    PaperCode,
    PaperFlex,
    PaperSwatch,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function ColorsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Colors</PaperText>
            <PaperText preset="body">
                PaperUI organizes colors into semantic functional roles rather than static color names.
                Reach for these variables when styling custom action buttons, status labels, or SVG charts.
                Each color role exposes a standard value and a deep tone configured for text contrast on tinted fills.
            </PaperText>

            <PaperText preset="subheader" id="color-roles">Color roles</PaperText>
            <PaperText preset="body">
                Functional roles represent meanings across all components:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Deep variable</th>
                        <th>Role meaning</th>
                        <th>Sample</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-primary</PaperCode></td>
                        <td><PaperCode>--paper-primary-deep</PaperCode></td>
                        <td>Primary interaction and focus accent</td>
                        <td><PaperSwatch color="var(--paper-primary)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-brand</PaperCode></td>
                        <td><PaperCode>--paper-brand-deep</PaperCode></td>
                        <td>Brand identity color (alias of primary)</td>
                        <td><PaperSwatch color="var(--paper-brand)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-success</PaperCode></td>
                        <td><PaperCode>--paper-success-deep</PaperCode></td>
                        <td>Operational health and completed state</td>
                        <td><PaperSwatch color="var(--paper-success)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-danger</PaperCode></td>
                        <td><PaperCode>--paper-danger-deep</PaperCode></td>
                        <td>Errors, critical alerts, and destructive actions</td>
                        <td><PaperSwatch color="var(--paper-danger)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-warning</PaperCode></td>
                        <td><PaperCode>--paper-warning-deep</PaperCode></td>
                        <td>Cautionary warnings and pending operations</td>
                        <td><PaperSwatch color="var(--paper-warning)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-attention</PaperCode></td>
                        <td><PaperCode>--paper-attention-deep</PaperCode></td>
                        <td>High-priority notices and attention indicators</td>
                        <td><PaperSwatch color="var(--paper-attention)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-extra-1</PaperCode></td>
                        <td><PaperCode>--paper-extra-1-deep</PaperCode></td>
                        <td>Supplemental category palette role 1 (teal)</td>
                        <td><PaperSwatch color="var(--paper-extra-1)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-extra-2</PaperCode></td>
                        <td><PaperCode>--paper-extra-2-deep</PaperCode></td>
                        <td>Supplemental category palette role 2 (purple)</td>
                        <td><PaperSwatch color="var(--paper-extra-2)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-extra-3</PaperCode></td>
                        <td><PaperCode>--paper-extra-3-deep</PaperCode></td>
                        <td>Supplemental category palette role 3 (magenta)</td>
                        <td><PaperSwatch color="var(--paper-extra-3)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-on-color</PaperCode></td>
                        <td><PaperCode>#ffffff</PaperCode></td>
                        <td>Text and icon color drawn over solid color fills</td>
                        <td><PaperSwatch color="var(--paper-on-color)" /></td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="operating-system-colors">Operating system colors</PaperText>
            <PaperText preset="body">
                PaperUI defines fixed brand colors for operating systems to render host distribution tags accurately:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Target OS</th>
                        <th>Hex code</th>
                        <th>Sample</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-os-macos</PaperCode></td>
                        <td>macOS</td>
                        <td>#ffffff</td>
                        <td><PaperSwatch color="var(--paper-os-macos)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-os-windows</PaperCode></td>
                        <td>Windows</td>
                        <td>#0078d4</td>
                        <td><PaperSwatch color="var(--paper-os-windows)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-os-ubuntu</PaperCode></td>
                        <td>Ubuntu</td>
                        <td>#e95420</td>
                        <td><PaperSwatch color="var(--paper-os-ubuntu)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-os-arch</PaperCode></td>
                        <td>Arch Linux</td>
                        <td>#1793d1</td>
                        <td><PaperSwatch color="var(--paper-os-arch)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-os-debian</PaperCode></td>
                        <td>Debian</td>
                        <td>#a80030</td>
                        <td><PaperSwatch color="var(--paper-os-debian)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-os-fedora</PaperCode></td>
                        <td>Fedora</td>
                        <td>#3c6eb4</td>
                        <td><PaperSwatch color="var(--paper-os-fedora)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-os-nixos</PaperCode></td>
                        <td>NixOS</td>
                        <td>#5277c3</td>
                        <td><PaperSwatch color="var(--paper-os-nixos)" /></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-os-linux</PaperCode></td>
                        <td>Generic Linux</td>
                        <td>#fcc624</td>
                        <td><PaperSwatch color="var(--paper-os-linux)" /></td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="scrim-and-contrast">Scrim and contrast</PaperText>
            <PaperText preset="body">
                Modal backdrops use scrim tokens configured for backdrop readability:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Purpose</th>
                        <th>Default resolution</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-contrast</PaperCode></td>
                        <td>Tone opposite the theme background for tints</td>
                        <td>#000000 in light, #ffffff in dark</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-scrim</PaperCode></td>
                        <td>Darkened backdrop fill behind modals and drawers</td>
                        <td>rgba(0, 0, 0, 0.45) light, rgba(0, 0, 0, 0.6) dark</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-scrim-light</PaperCode></td>
                        <td>Inverted highlight scrim for dark surfaces</td>
                        <td>rgba(255, 255, 255, 0.7)</td>
                    </tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
