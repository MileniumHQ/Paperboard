import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "paperui";

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
        { token: "--paper-sidebar-width", value: "250px", desc: "Standard fixed width for navigation sidebar menus." },
        { token: "--paper-centered-width", value: "600px", desc: "Default width constraint for PaperCenteredInterface containers." },
        { token: "--paper-centered-height", value: "400px", desc: "Default min-height constraint for centered dialog templates." },
        { token: "--paper-loader-width", value: "400px", desc: "Standard horizontal width for PaperLoader progress bars." },
    ];

    return (
        <>
            <PaperText preset="header">Variables & Spacing</PaperText>
            <PaperText preset="body">
                Specifications for the PaperUI geometric spacing scale, corner radii, border widths, elevation shadows, and standard component dimension constants.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperUI spacing</strong> is calculated proportionally from a single baseline constant, <PaperCode>--paper-uigap</PaperCode> (12 pixels). By referencing derived mathematical fractions and multiples of this base token, layouts maintain consistent proportions across various viewport resolutions.
            </PaperText>

            <PaperSeparator />

            <PaperText id="gap-scale" preset="subheader">
                UI Gap & Spacing Multipliers
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
                Border Geometry & Radii
            </PaperText>
            <PaperText preset="body">
                PaperUI employs subtle rounded corners to preserve a soft, modern aesthetic across all interactive surfaces:
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
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="elevation-shadows" preset="subheader">
                Elevation and Shadow Effects
            </PaperText>
            <PaperText preset="body">
                Subtle drop shadows and backdrop filters provide depth without obscuring contrast:
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

            <PaperText id="component-dimensions" preset="subheader">
                Standard Component Dimensions
            </PaperText>
            <PaperText preset="body">
                Key structural templates enforce standard dimensions to guarantee layout predictability:
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
                Programmatic Access & Token Utilities
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
} from "paperui";

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
                See Also
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
