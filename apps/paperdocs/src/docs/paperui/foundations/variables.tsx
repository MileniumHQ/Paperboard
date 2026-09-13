import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    const gapScale = [
        { token: "--paper-uigap-onefourth", value: "3px", desc: "Minimal spacing, tight icon paddings, and dense tag padding." },
        { token: "--paper-uigap-half", value: "6px", desc: "Sub-item padding, inline badge gaps, and small button gutters." },
        { token: "--paper-uigap-threefourths", value: "9px", desc: "Intermediate padding for compact form fields and toolbars." },
        { token: "--paper-uigap", value: "12px", desc: "Base unit for standard element gutters, card paddings, and form gaps." },
        { token: "--paper-uigap-sixfourths", value: "18px", desc: "Expanded sectional spacing and modal internal offsets." },
        { token: "--paper-uigap-double", value: "24px", desc: "Major component separation, large container paddings, and dialog gaps." },
        { token: "--paper-uigap-triple", value: "36px", desc: "Sectional padding for documentation bodies and wide desktop layouts." },
        { token: "--paper-uigap-quadruple", value: "48px", desc: "Hero section gutters and primary page margins." },
    ];

    const radiiTokens = [
        { token: "--paper-border-radius", value: "12px", desc: "Standard container, button, modal, and selector corner radius." },
        { token: "--paper-border-radius-half", value: "6px", desc: "Small chips, sub-badges, inner elements, and scrollbar thumbs." },
    ];

    const dimensionTokens = [
        { token: "--paper-sidebar-width", value: "190px", desc: "Standard fixed width for navigation sidebar menus." },
        { token: "--paper-centered-width-small", value: "420px", desc: "Width for small centered dialog templates." },
        { token: "--paper-centered-height-small", value: "300px", desc: "Height for small centered dialog templates." },
        { token: "--paper-centered-width-medium / --paper-centered-width", value: "600px", desc: "Default width constraint for PaperCenteredInterface containers." },
        { token: "--paper-centered-height-medium / --paper-centered-height", value: "400px", desc: "Default height constraint for centered dialog templates." },
        { token: "--paper-centered-width-large", value: "760px", desc: "Width for large centered dialog templates." },
        { token: "--paper-centered-height-large", value: "520px", desc: "Height for large centered dialog templates." },
        { token: "--paper-centered-width-wide", value: "920px", desc: "Width for wide centered dialog templates." },
        { token: "--paper-centered-height-wide", value: "580px", desc: "Height for wide centered dialog templates." },
        { token: "--paper-loader-width", value: "400px", desc: "Standard horizontal width for PaperLoader progress bars." },
    ];

    return (
        <>
            <PaperText preset="header">Variables and spacing</PaperText>
            <PaperText preset="body">
                Specifications for the PaperUI geometric spacing scale, corner radii, border widths, elevation shadows, and standard component dimension constants.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperUI spacing</strong> is calculated proportionally from a single baseline constant, <PaperCode>--paper-uigap</PaperCode> (12 pixels). Derived fractions and multiples of this base token keep layout proportions consistent between components.
            </PaperText>

            <PaperSeparator />

            <PaperText id="gap-scale" preset="subheader">
                UI gap and spacing multipliers
            </PaperText>
            <PaperText preset="body">
                Components such as <PaperLink href="/paperui/paperflex"><PaperCode>PaperFlex</PaperCode></PaperLink> accept named string literals (e.g. <PaperCode>gap="full"</PaperCode> or <PaperCode>padding="double"</PaperCode>) that map directly to the following scale:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>CSS Custom Property</th>
                        <th>Computed Value</th>
                        <th>Typical Application</th>
                    </tr>
                </thead>
                <tbody>
                    {gapScale.map((g) => (
                        <tr>
                            <td><PaperCode>{g.token}</PaperCode></td>
                            <td><PaperCode>{g.value}</PaperCode></td>
                            <td>{g.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="border-geometry" preset="subheader">
                Border geometry and radii
            </PaperText>
            <PaperText preset="body">
                Interactive surfaces use rounded corners defined by two radius tokens and three border widths:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Property</th>
                        <th>Value</th>
                        <th>Application</th>
                    </tr>
                </thead>
                <tbody>
                    {radiiTokens.map((r) => (
                        <tr>
                            <td><PaperCode>{r.token}</PaperCode></td>
                            <td><PaperCode>{r.value}</PaperCode></td>
                            <td>{r.desc}</td>
                        </tr>
                    ))}
                    <tr>
                        <td><PaperCode>--paper-border-width</PaperCode></td>
                        <td><PaperCode>1px</PaperCode></td>
                        <td>Standard component borders, dividers, and container frames.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-thick-border-width</PaperCode></td>
                        <td><PaperCode>2px</PaperCode></td>
                        <td>Focus rings, active selector outlines, and highlighted states.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-thickest-border-width</PaperCode></td>
                        <td><PaperCode>3px</PaperCode></td>
                        <td>Strongest available outline weight for emphasized states.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="elevation-shadows" preset="subheader">
                Elevation and shadow effects
            </PaperText>
            <PaperText preset="body">
                Drop shadows and backdrop filters provide depth without obscuring contrast:
            </PaperText>

            <PaperTextList>
                <PaperText preset="body">
                    <PaperCode>--paper-element-shadow</PaperCode>: <PaperCode>0 2px 4px rgba(0, 0, 0, 0.05)</PaperCode> — Standard elevation for floating cards and buttons.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>--paper-heavy-element-shadow</PaperCode>: <PaperCode>0 2px 6px 1px rgba(0, 0, 0, 0.2)</PaperCode> — High elevation for context menus and modals.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>--paper-blur-light</PaperCode> (5px), <PaperCode>--paper-blur-medium</PaperCode> (10px), <PaperCode>--paper-blur-heavy</PaperCode> (15px) — Backdrop filter presets for translucent surfaces.
                </PaperText>
            </PaperTextList>

            <PaperSeparator />

            <PaperText id="icon-and-item-sizes" preset="subheader">
                Icon and item sizes
            </PaperText>
            <PaperText preset="body">
                Icons and interactive list items resolve to fixed pixel sizes through the following tokens:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Icon Token</th>
                        <th>Value</th>
                        <th>Item Token</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-icon-size-small</PaperCode></td>
                        <td><PaperCode>18px</PaperCode></td>
                        <td><PaperCode>--paper-item-size-tiny</PaperCode></td>
                        <td><PaperCode>28px</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-icon-size-medium</PaperCode></td>
                        <td><PaperCode>22px</PaperCode></td>
                        <td><PaperCode>--paper-item-size-small</PaperCode></td>
                        <td><PaperCode>36px</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-icon-size-large</PaperCode></td>
                        <td><PaperCode>26px</PaperCode></td>
                        <td><PaperCode>--paper-item-size-medium</PaperCode></td>
                        <td><PaperCode>48px</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-icon-size-xlarge</PaperCode></td>
                        <td><PaperCode>28px</PaperCode></td>
                        <td><PaperCode>--paper-item-size-large</PaperCode></td>
                        <td><PaperCode>64px</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-icon-size-huge</PaperCode></td>
                        <td><PaperCode>30px</PaperCode></td>
                        <td></td>
                        <td></td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="component-dimensions" preset="subheader">
                Standard component dimensions
            </PaperText>
            <PaperText preset="body">
                Structural templates use fixed dimension constants so that dialogs and navigation elements render at consistent sizes:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Constant</th>
                        <th>Value</th>
                        <th>Target Template</th>
                    </tr>
                </thead>
                <tbody>
                    {dimensionTokens.map((d) => (
                        <tr>
                            <td><PaperCode>{d.token}</PaperCode></td>
                            <td><PaperCode>{d.value}</PaperCode></td>
                            <td>{d.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="programmatic-access" preset="subheader">
                Programmatic access and token utilities
            </PaperText>
            <PaperText preset="body">
                JavaScript and TypeScript consumers can read computed CSS variable values dynamically using <PaperCode>getVar()</PaperCode>, generate CSS variable references with <PaperCode>getVarCss()</PaperCode>, or resolve shorthand token names with dedicated resolution helpers:
            </PaperText>

            <PaperCode block language="tsx">
                {`import {
    getVar,
    getVarCss,
    resolveSpacing,
    resolveColor,
    resolveBackground,
    spacingSizes,
    brandColors,
    backgroundSurfaces,
} from "@paperboard-dev/paperui";

// Resolves computed CSS value from DOM at runtime:
const brandBlue = getVar("front-blue"); // e.g. "rgb(41, 129, 229)"
const lightText = getVar("--paper-light-text", "#888888");

// Generates CSS variable wrapper string:
const styleVar = getVarCss("light-text"); // "var(--paper-light-text)"

// Resolves shorthand tokens without needing manual var() or getVar():
const gapVal = resolveSpacing("half"); // "var(--paper-uigap-half)"
const colorVal = resolveColor("front-blue"); // "var(--paper-front-blue)"
const bgVal = resolveBackground("front"); // "var(--paper-background-front, var(--paper-front))"`}
            </PaperCode>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperflex">PaperFlex</PaperLink> — Primary structural layout template consuming the gap scale.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/colors">Colors</PaperLink> — Palette and surface token specifications.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercontainer">PaperContainer</PaperLink> — Structural wrapper utilizing border and shadow tokens.
                </PaperText>
            </PaperTextList>
        </>
    );
}
