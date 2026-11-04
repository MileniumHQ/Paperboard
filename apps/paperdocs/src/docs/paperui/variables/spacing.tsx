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

const gaps: Array<{ token: string; variable: string; value: string; use: string }> = [
    { token: "none", variable: "No variable", value: "0", use: "No space." },
    { token: "onefourth", variable: "--paper-uigap-onefourth", value: "3px", use: "Tight pairs, such as a setting's title and its description." },
    { token: "half", variable: "--paper-uigap-half", value: "6px", use: "Controls in a toolbar, items in a tight row." },
    { token: "threefourths", variable: "--paper-uigap-threefourths", value: "9px", use: "A step between half and full." },
    { token: "full", variable: "--paper-uigap", value: "12px", use: "The standard gap between siblings." },
    { token: "sixfourths", variable: "--paper-uigap-sixfourths", value: "18px", use: "A step between full and double." },
    { token: "double", variable: "--paper-uigap-double", value: "24px", use: "Between groups of content." },
    { token: "triple", variable: "--paper-uigap-triple", value: "36px", use: "Between large sections." },
    { token: "quadruple", variable: "--paper-uigap-quadruple", value: "48px", use: "The largest step." },
    { token: "inset", variable: "--paper-inset", value: "18px (sixfourths)", use: "How far text sits in from a card's edge. Text outside a card indents by the same amount to line up." },
];

const sizeTokens: Array<{ token: string; value: string; use: string }> = [
    { token: "panel", value: "600px", use: "The default dialog or centered-surface width." },
    { token: "panel-height", value: "400px", use: "The matching height." },
    { token: "panel-small", value: "420px", use: "A small dialog's width; PaperModal size small." },
    { token: "panel-height-small", value: "300px", use: "The matching height." },
    { token: "panel-medium", value: "600px", use: "PaperModal size medium." },
    { token: "panel-height-medium", value: "400px", use: "The matching height." },
    { token: "panel-large", value: "760px", use: "PaperModal size large." },
    { token: "panel-height-large", value: "520px", use: "The matching height." },
    { token: "panel-wide", value: "920px", use: "The widest dialog; PaperModal size full." },
    { token: "panel-height-wide", value: "580px", use: "The matching height." },
    { token: "sidebar", value: "190px", use: "A navigation column: PaperMenu and PaperList width." },
    { token: "loader", value: "400px", use: "Used by PaperLoader." },
    { token: "field-small", value: "88px", use: "A narrow field width." },
    { token: "field-medium", value: "120px", use: "A short field." },
    { token: "field", value: "160px", use: "A field width. The minimum width of a select menu." },
    { token: "field-wide", value: "240px", use: "A wide field." },
    { token: "bar", value: "54px", use: "The height of a top bar." },
    { token: "card-min", value: "256px", use: "A minimum card width. PaperAudio's width." },
    { token: "split-side", value: "320px", use: "PaperSplit's side pane." },
    { token: "menu-max", value: "416px", use: "The widest a popup menu grows before its items ellipsize." },
];

export default function SpacingDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Spacing and layout</PaperText>
            <PaperText preset="body" as="p">
                PaperUI measures space in named steps: gaps and padding come from the spacing tokens, and fixed widths and heights come from the size tokens.
                Pass the token name to a component prop.
                A panel never writes pixels or rem values.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="spacing-tokens">Spacing tokens</PaperText>
            <PaperText preset="body" as="p">
                The names are the type <PaperCode>PaperSpacingSize</PaperCode>, and the array <PaperCode>spacingSizes</PaperCode> lists them.
                Every step is a multiple of <PaperCode>--paper-uigap</PaperCode> (12px).
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    {gaps.map((g) => (
                        <tr>
                            <td><PaperCode>{g.token}</PaperCode></td>
                            <td><PaperCode>{g.variable}</PaperCode></td>
                            <td>{g.value}</td>
                            <td>{g.use}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Two smaller steps exist below <PaperCode>onefourth</PaperCode>: <PaperCode>--paper-uigap-sixth</PaperCode> (2px) and <PaperCode>--paper-uigap-third</PaperCode> (4px).
                They are not in <PaperCode>spacingSizes</PaperCode>. A spacing prop accepts them by their variable name without the prefix, as <PaperCode>"uigap-third"</PaperCode>.{" "}
                <PaperCode>--paper-inset-outside</PaperCode> is the inset plus the border width, the same line seen from outside a card.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="using-spacing">Using spacing</PaperText>
            <PaperText preset="body" as="p">
                A prop typed <PaperCode>PaperSpacing</PaperCode> takes a token, a number of pixels, or a CSS length.
                Panels use tokens.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex gap="double">
                    <PaperFlex direction="row" gap="half">
                        <PaperBadge>half</PaperBadge>
                        <PaperBadge>half</PaperBadge>
                        <PaperBadge>half</PaperBadge>
                    </PaperFlex>
                    <PaperFlex direction="row" gap="full">
                        <PaperBadge>full</PaperBadge>
                        <PaperBadge>full</PaperBadge>
                        <PaperBadge>full</PaperBadge>
                    </PaperFlex>
                    <PaperFlex direction="row" gap="triple">
                        <PaperBadge>triple</PaperBadge>
                        <PaperBadge>triple</PaperBadge>
                        <PaperBadge>triple</PaperBadge>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperFlex } from "@mileniumhq/paperui";

<PaperFlex gap="double">
    <PaperFlex direction="row" gap="half">
        <PaperBadge>half</PaperBadge>
        <PaperBadge>half</PaperBadge>
        <PaperBadge>half</PaperBadge>
    </PaperFlex>
    <PaperFlex direction="row" gap="full">
        <PaperBadge>full</PaperBadge>
        <PaperBadge>full</PaperBadge>
        <PaperBadge>full</PaperBadge>
    </PaperFlex>
    <PaperFlex direction="row" gap="triple">
        <PaperBadge>triple</PaperBadge>
        <PaperBadge>triple</PaperBadge>
        <PaperBadge>triple</PaperBadge>
    </PaperFlex>
</PaperFlex>`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Component</th>
                        <th>Props</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink></td>
                        <td><PaperCode>gap</PaperCode>, <PaperCode>padding</PaperCode>, <PaperCode>paddingX</PaperCode>, <PaperCode>paddingY</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink></td>
                        <td><PaperCode>gap</PaperCode>, <PaperCode>padding</PaperCode>, <PaperCode>paddingX</PaperCode>, <PaperCode>paddingY</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink></td>
                        <td><PaperCode>gap</PaperCode> (default <PaperCode>full</PaperCode>), <PaperCode>padding</PaperCode> (default <PaperCode>double</PaperCode>)</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperspacer/">PaperSpacer</PaperLink></td>
                        <td><PaperCode>size</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink></td>
                        <td><PaperCode>spacing</PaperCode>: <PaperCode>true</PaperCode> is <PaperCode>onefourth</PaperCode>, <PaperCode>false</PaperCode> is none</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A spacing value resolves in this order: a number is pixels; a token name becomes its variable; a string starting with <PaperCode>var(</PaperCode> or <PaperCode>calc(</PaperCode>, or ending in <PaperCode>px</PaperCode>, <PaperCode>rem</PaperCode>, or <PaperCode>%</PaperCode>, is used as written; any other string becomes <PaperCode>var(--paper-name)</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="sizes">Size tokens</PaperText>
            <PaperText preset="body" as="p">
                Fixed widths and heights name a footprint instead of a number.
                The names are the type <PaperCode>PaperSize</PaperCode>, and the array <PaperCode>paperSizes</PaperCode> lists them.
                Each is the variable <PaperCode>--paper-size-name</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Value</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    {sizeTokens.map((t) => (
                        <tr>
                            <td><PaperCode>{t.token}</PaperCode></td>
                            <td>{t.value}</td>
                            <td>{t.use}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Props that take a size token:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Component</th>
                        <th>Props</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>PaperFlex, PaperCard (<PaperLink href="/docs/paperui/paperflex/#layout-props">layout props</PaperLink>)</td>
                        <td><PaperCode>width</PaperCode> and <PaperCode>height</PaperCode> take only a size token. <PaperCode>minWidth</PaperCode>, <PaperCode>maxWidth</PaperCode>, <PaperCode>minHeight</PaperCode>, and <PaperCode>maxHeight</PaperCode> take a token, a number, or a CSS length.</td>
                    </tr>
                    <tr>
                        <td>PaperPage</td>
                        <td>The layout props except <PaperCode>width</PaperCode>; its column width is <PaperCode>standard</PaperCode>, <PaperCode>wide</PaperCode>, or <PaperCode>full</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papergrid/">PaperGrid</PaperLink></td>
                        <td><PaperCode>min</PaperCode>: the narrowest column. Defaults to <PaperCode>--paper-grid-min</PaperCode> (200px).</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papermediacard/">PaperMediaCard</PaperLink></td>
                        <td><PaperCode>minCardWidth</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papersplit/">PaperSplit</PaperLink></td>
                        <td><PaperCode>sideWidth</PaperCode> defaults to <PaperCode>split-side</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papercenteredinterface/">PaperCenteredInterface</PaperLink></td>
                        <td>Its presets map onto the <PaperCode>panel-*</PaperCode> tokens.</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink></td>
                        <td><PaperCode>size</PaperCode> small, medium, large, and full set the maximum width to <PaperCode>panel-small</PaperCode>, <PaperCode>panel-medium</PaperCode>, <PaperCode>panel-large</PaperCode>, and <PaperCode>panel-wide</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A size prop resolves a token name to its variable, a number to pixels, and any other string as written.{" "}
                <PaperCode>resolveSize</PaperCode> and <PaperCode>isPaperSize</PaperCode> in <PaperLink href="/docs/paperui/utilities/#theme-helpers">Utilities</PaperLink> do the same for your own components.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex width="panel-small" maxWidth="panel" padding="double" background="surface" align="center">
                    <PaperText preset="hint">Width panel-small</PaperText>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperText } from "@mileniumhq/paperui";

<PaperFlex width="panel-small" maxWidth="panel" padding="double" background="surface" align="center">
    <PaperText preset="hint">Width panel-small</PaperText>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="page-widths">Page widths</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-page-width</PaperCode></td><td>992px</td><td>PaperPage <PaperCode>standard</PaperCode>.</td></tr>
                    <tr><td><PaperCode>--paper-page-width-wide</PaperCode></td><td>1400px</td><td>PaperPage <PaperCode>wide</PaperCode>.</td></tr>
                    <tr><td><PaperCode>--paper-grid-min</PaperCode></td><td>200px</td><td>PaperGrid's default column minimum.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="control-sizes">Control sizes</PaperText>
            <PaperText preset="body" as="p">
                Components size their own controls from these steps. They are the reference when a custom element has to match a neighboring control.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Family</th>
                        <th>Variables and values</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Controls (buttons, loaders)</td>
                        <td><PaperCode>--paper-control-size-tiny</PaperCode> 28px, <PaperCode>-small</PaperCode> 32px, <PaperCode>-medium</PaperCode> 36px, <PaperCode>-large</PaperCode> 48px, <PaperCode>-xlarge</PaperCode> 64px, <PaperCode>-inline</PaperCode> 22px (chips and fields inside a line of text)</td>
                    </tr>
                    <tr>
                        <td>Icons</td>
                        <td><PaperCode>--paper-icon-size-tiny</PaperCode> 16px, <PaperCode>-small</PaperCode> 18px, <PaperCode>-medium</PaperCode> 22px, <PaperCode>-large</PaperCode> 26px, <PaperCode>-xlarge</PaperCode> 28px, <PaperCode>-huge</PaperCode> 30px</td>
                    </tr>
                    <tr>
                        <td>Avatars</td>
                        <td><PaperCode>--paper-avatar-size-small</PaperCode> 24px, <PaperCode>-medium</PaperCode> 32px, <PaperCode>-large</PaperCode> 48px, <PaperCode>-xlarge</PaperCode> 64px</td>
                    </tr>
                    <tr>
                        <td>Swatches</td>
                        <td><PaperCode>--paper-swatch-size-small</PaperCode> 8px, <PaperCode>-medium</PaperCode> 12px, <PaperCode>-large</PaperCode> 16px</td>
                    </tr>
                    <tr>
                        <td>Rail</td>
                        <td><PaperCode>--paper-rail-item-height</PaperCode> 50px, <PaperCode>--paper-rail-icon-size</PaperCode> 24px, <PaperCode>--paper-rail-label-size</PaperCode> 10px</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="safe-areas">Safe areas</PaperText>
            <PaperText preset="body" as="p">
                On a device with a notch or a home indicator, <PaperCode>--paper-safe-area-top</PaperCode>, <PaperCode>-right</PaperCode>, <PaperCode>-bottom</PaperCode>, and <PaperCode>-left</PaperCode> hold the insets, and are <PaperCode>0px</PaperCode> elsewhere.
                Backgrounds fill the viewport, and controls consume the inset at their own boundary, so a panel built from PaperUI components needs no code for them.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="layers">Layers</PaperText>
            <PaperText preset="body" as="p">
                Stacking order has named steps, and each sits above the one before it.
                Local layering inside a component is <PaperCode>--paper-z-raised</PaperCode> plus a small offset.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-z-raised</PaperCode></td><td>1</td></tr>
                    <tr><td><PaperCode>--paper-z-float</PaperCode></td><td>10</td></tr>
                    <tr><td><PaperCode>--paper-z-sticky</PaperCode></td><td>50</td></tr>
                    <tr><td><PaperCode>--paper-z-drag</PaperCode></td><td>100</td></tr>
                    <tr><td><PaperCode>--paper-z-menu</PaperCode></td><td>1000</td></tr>
                    <tr><td><PaperCode>--paper-z-chrome</PaperCode></td><td>2000</td></tr>
                    <tr><td><PaperCode>--paper-z-ghost</PaperCode></td><td>3000</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="rules">Rules</PaperText>
            <PaperTextList>
                <li>Gaps and padding are tokens. A number of pixels in a panel is a defect.</li>
                <li>Fixed sizes are size tokens. Prefer <PaperCode>flex</PaperCode>, <PaperCode>fullWidth</PaperCode>, and <PaperCode>minWidth={"{0}"}</PaperCode> over a fixed width, so a panel works at the smallest window size.</li>
                <li>Read a variable that no prop exposes with <PaperLink href="/docs/paperui/utilities/#getvarcss">getVarCss</PaperLink>, not a hand-written <PaperCode>var()</PaperCode>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
