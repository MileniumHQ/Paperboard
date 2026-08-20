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
    const frontColors = [
        {
            name: "--paper-front-blue",
            label: "Blue Surface",
            hex: "#1677ff",
            desc: "Interactive primary brand accent.",
        },
        {
            name: "--paper-front-green",
            label: "Green Surface",
            hex: "#0d9d0d",
            desc: "Success indicator, affirmative actions, and completion badges.",
        },
        {
            name: "--paper-front-yellow",
            label: "Yellow Surface",
            hex: "#d7a51d",
            desc: "Warning notifications, pending states, and attention highlights.",
        },
        {
            name: "--paper-front-red",
            label: "Red Surface",
            hex: "#e73648",
            desc: "Danger actions, destructive alerts, and fatal error states.",
        },
    ];

    const backColors = [
        {
            name: "--paper-back-blue",
            label: "Blue Depth",
            hex: "#0f63c8",
            desc: "Tactile depth counterpart for blue elements.",
        },
        {
            name: "--paper-back-green",
            label: "Green Depth",
            hex: "#0b720b",
            desc: "Tactile depth counterpart for green elements.",
        },
        {
            name: "--paper-back-yellow",
            label: "Yellow Depth",
            hex: "#a17e0d",
            desc: "Tactile depth counterpart for yellow elements.",
        },
        {
            name: "--paper-back-red",
            label: "Red Depth",
            hex: "#ae1414",
            desc: "Tactile depth counterpart for red elements.",
        },
    ];

    const surfaceTokens = [
        {
            token: "--paper-background-frontest",
            light: "#ffffff",
            dark: "#232323",
            desc: "Elevated surfaces, dialog modals, dropdown menus, and popovers.",
        },
        {
            token: "--paper-background-front",
            light: "#efefef",
            dark: "#1d1d1d",
            desc: "Container surfaces, cards, and primary grouped panels.",
        },
        {
            token: "--paper-background-back",
            light: "#e4e4e4",
            dark: "#2a2a2a",
            desc: "Intermediate recess level and grouped list items.",
        },
        {
            token: "--paper-background-backest",
            light: "#e1e1e1",
            dark: "#303030",
            desc: "Application baseline canvas and viewport background.",
        },
        {
            token: "--paper-background-definition",
            light: "#eaeaea",
            dark: "#171717",
            desc: "Subtle sectional contrast surfaces and header tracks.",
        },
        {
            token: "--paper-background-element",
            light: "#bababa",
            dark: "#404040",
            desc: "Disabled states, scrollbar tracks, and low-contrast borders.",
        },
    ];

    return (
        <>
            <PaperText preset="header">Colors</PaperText>
            <PaperText preset="body">
                The color architecture of PaperUI, specifying brand accents,
                adaptive surface layers, typography contrast tokens, and
                automatic dark scheme inversion.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperUI colors</strong> are defined using CSS Custom
                Properties attached to the <PaperCode>:root</PaperCode> selector
                and dynamically modified via the{" "}
                <PaperCode>data-paperui-theme</PaperCode> attribute. The color
                system distinguishes between <em>chromatic brand tokens</em>{" "}
                (which maintain semantic consistency across themes) and{" "}
                <em>achromatic surface tokens</em> (which invert based on theme
                polarity).
            </PaperText>

            <PaperSeparator />

            <PaperText id="brand-palette" preset="subheader">
                Brand Palette
            </PaperText>
            <PaperText preset="body">
                Each chromatic hue provides a paired{" "}
                <PaperCode>front</PaperCode> token (surface fill) and{" "}
                <PaperCode>back</PaperCode> token (used to create tactile depth
                and dimensional drop borders via{" "}
                <PaperLink href="/paperui/papereffect">
                    <PaperCode>PaperEffect</PaperCode>
                </PaperLink>
                ).
            </PaperText>

            <PaperContainer>
                <div
                    style={{
                        padding: "var(--paper-uigap)",
                        display: "flex",
                        "flex-direction": "column",
                        gap: "var(--paper-uigap-half)",
                    }}
                >
                    <div
                        style={{
                            display: "grid",
                            "grid-template-columns":
                                "repeat(4, minmax(0, 1fr))",
                            gap: "var(--paper-uigap-half)",
                        }}
                    >
                        {frontColors.map((c) => (
                            <PaperFlex
                                padding="half"
                                gap="onefourth"
                                style={{
                                    background:
                                        "var(--paper-background-frontest)",
                                    "border-radius":
                                        "var(--paper-border-radius)",
                                    border: "1px solid var(--paper-medium-border)",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        height: "40px",
                                        "border-radius":
                                            "var(--paper-border-radius-half)",
                                        background: `var(${c.name})`,
                                    }}
                                />
                                <PaperText
                                    size={2}
                                    weight={700}
                                    style={{
                                        "white-space": "nowrap",
                                        overflow: "hidden",
                                        "text-overflow": "ellipsis",
                                    }}
                                >
                                    {c.name}
                                </PaperText>
                                <PaperText
                                    size={1}
                                    color="var(--paper-light-text)"
                                >
                                    {c.hex}
                                </PaperText>
                            </PaperFlex>
                        ))}
                    </div>

                    <div
                        style={{
                            display: "grid",
                            "grid-template-columns":
                                "repeat(4, minmax(0, 1fr))",
                            gap: "var(--paper-uigap-half)",
                        }}
                    >
                        {backColors.map((c) => (
                            <PaperFlex
                                padding="half"
                                gap="onefourth"
                                style={{
                                    background:
                                        "var(--paper-background-frontest)",
                                    "border-radius":
                                        "var(--paper-border-radius)",
                                    border: "1px solid var(--paper-medium-border)",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        height: "40px",
                                        "border-radius":
                                            "var(--paper-border-radius-half)",
                                        background: `var(${c.name})`,
                                    }}
                                />
                                <PaperText
                                    size={2}
                                    weight={700}
                                    style={{
                                        "white-space": "nowrap",
                                        overflow: "hidden",
                                        "text-overflow": "ellipsis",
                                    }}
                                >
                                    {c.name}
                                </PaperText>
                                <PaperText
                                    size={1}
                                    color="var(--paper-light-text)"
                                >
                                    {c.hex}
                                </PaperText>
                            </PaperFlex>
                        ))}
                    </div>
                </div>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="surface-tokens" preset="subheader">
                Surface and Background Tokens
            </PaperText>
            <PaperText preset="body">
                PaperUI employs an inverted elevation hierarchy:{" "}
                <PaperCode>frontest</PaperCode> represents the highest elevation
                layer toward the user, whereas <PaperCode>backest</PaperCode>{" "}
                represents the deepest viewport canvas level.
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Light Value</th>
                        <th>Dark Value</th>
                        <th>Application</th>
                    </tr>
                </thead>
                <tbody>
                    {surfaceTokens.map((s) => (
                        <tr>
                            <td>
                                <PaperCode>{s.token}</PaperCode>
                            </td>
                            <td>
                                <PaperCode>{s.light}</PaperCode>
                            </td>
                            <td>
                                <PaperCode>{s.dark}</PaperCode>
                            </td>
                            <td>{s.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="typography-colors" preset="subheader">
                Typography Contrast Hierarchy
            </PaperText>
            <PaperText preset="body">
                Text color tokens provide accessible contrast ratios across both
                light and dark modes:
            </PaperText>

            <PaperTextList>
                <PaperText preset="body">
                    <PaperCode>--paper-main-text</PaperCode> — Primary
                    high-contrast text for headers, titles, and body content.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>--paper-lightish-text</PaperCode> — Secondary
                    text for subheadings and active metadata.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>--paper-light-text</PaperCode> — Muted text for
                    descriptive labels, placeholders, and captions.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>--paper-lightest-text</PaperCode> — Low-emphasis
                    text for inactive icons and disabled hints.
                </PaperText>
                <PaperText preset="body">
                    <PaperCode>--paper-anti-background</PaperCode> — Contrast
                    inversion token (pure black in light mode, pure white in
                    dark mode).
                </PaperText>
            </PaperTextList>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/theming">Theming</PaperLink> —
                    Theme resolution mechanics and switching APIs.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papereffect">
                        PaperEffect
                    </PaperLink>{" "}
                    — Tactile shadow implementation using brand color tokens.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink>{" "}
                    — Color variant mapping for status indicators.
                </PaperText>
            </PaperTextList>
        </>
    );
}
