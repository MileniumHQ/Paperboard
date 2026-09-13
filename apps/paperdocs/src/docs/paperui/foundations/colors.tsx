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
    const frontColors = [
        {
            name: "--paper-front-blue",
            label: "Blue Surface",
            hex: "#2981e5",
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
            dark: "#222222",
            desc: "Elevated surfaces, dialog modals, dropdown menus, and popovers.",
        },
        {
            token: "--paper-background-front",
            light: "#f6f8fa",
            dark: "#191919",
            desc: "Container surfaces, cards, and primary grouped panels.",
        },
        {
            token: "--paper-background-back",
            light: "#e2e6eb",
            dark: "#2a2a2a",
            desc: "Intermediate recess level and grouped list items.",
        },
        {
            token: "--paper-background-backest",
            light: "#d8dce2",
            dark: "#323232",
            desc: "Application baseline canvas and viewport background.",
        },
        {
            token: "--paper-background-definition",
            light: "#eceff3",
            dark: "#131313",
            desc: "Subtle sectional contrast surfaces and header tracks.",
        },
        {
            token: "--paper-background-element",
            light: "#cdd3db",
            dark: "#3f3f3f",
            desc: "Disabled states, scrollbar tracks, and low-contrast borders.",
        },
    ];

    const borderColors = [
        {
            token: "--paper-medium-border",
            light: "#c4c9d2",
            dark: "#3a3a3a",
            desc: "Standard component borders, dividers, and container frames.",
        },
        {
            token: "--paper-medium-dark-border",
            light: "#adb3be",
            dark: "#4c4c4c",
            desc: "Emphasized borders on hoverable or pressed elements.",
        },
        {
            token: "--paper-dark-border",
            light: "#7d8492",
            dark: "#636363",
            desc: "High-contrast outlines for focused or selected elements.",
        },
    ];

    const textColors = [
        {
            token: "--paper-main-text",
            light: "#0f1319",
            dark: "#f5f5f5",
            desc: "Primary high-contrast text for headers, titles, and body content.",
        },
        {
            token: "--paper-lightish-text",
            light: "#2e3440",
            dark: "#d4d4d4",
            desc: "Secondary text for subheadings and active metadata.",
        },
        {
            token: "--paper-light-text",
            light: "#5b6371",
            dark: "#a1a1a1",
            desc: "Muted text for descriptive labels, placeholders, and captions.",
        },
        {
            token: "--paper-lightest-text",
            light: "#8b93a2",
            dark: "#737373",
            desc: "Low-emphasis text for inactive icons and disabled hints.",
        },
        {
            token: "--paper-anti-background",
            light: "#000000",
            dark: "#ffffff",
            desc: "Contrast inversion token (pure black in light mode, pure white in dark mode).",
        },
        {
            token: "--paper-over-brand",
            light: "#ffffff",
            dark: "#ffffff",
            desc: "Text and icon color placed over brand-colored surfaces (theme-independent white).",
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
                Brand palette
            </PaperText>
            <PaperText preset="body">
                Each chromatic hue provides a paired{" "}
                <PaperCode>front</PaperCode> token (surface fill) and{" "}
                <PaperCode>back</PaperCode> token (used to create tactile depth
                and dimensional drop borders via{" "}
                <PaperLink href="/paperui/papereffect">
                    <PaperCode>PaperEffect</PaperCode>
                </PaperLink>
                ). A theme-independent <PaperCode>--paper-over-brand</PaperCode>{" "}
                token supplies the foreground color used on top of these
                brand-colored surfaces.
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
                Surface and background tokens
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

            <PaperText id="border-colors" preset="subheader">
                Border color tokens
            </PaperText>
            <PaperText preset="body">
                Three border tokens are used across components for outlines,
                dividers, and separators. They invert alongside the surface
                tokens:
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
                    {borderColors.map((b) => (
                        <tr>
                            <td>
                                <PaperCode>{b.token}</PaperCode>
                            </td>
                            <td>
                                <PaperCode>{b.light}</PaperCode>
                            </td>
                            <td>
                                <PaperCode>{b.dark}</PaperCode>
                            </td>
                            <td>{b.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="typography-colors" preset="subheader">
                Typography contrast hierarchy
            </PaperText>
            <PaperText preset="body">
                Text color tokens step from full emphasis to low emphasis in
                both light and dark modes:
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
                    {textColors.map((t) => (
                        <tr>
                            <td>
                                <PaperCode>{t.token}</PaperCode>
                            </td>
                            <td>
                                <PaperCode>{t.light}</PaperCode>
                            </td>
                            <td>
                                <PaperCode>{t.dark}</PaperCode>
                            </td>
                            <td>{t.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
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
