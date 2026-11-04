import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSwatch,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";
import type { PaperBackgroundSurface, PaperBorderColor } from "@mileniumhq/paperui";

const surfaces: Array<{ token: PaperBackgroundSurface; light: string; dark: string; use: string }> = [
    { token: "surface-app", light: "#eef0f3", dark: "#141517", use: "The canvas behind everything. The provider and panel.css paint it on the document." },
    { token: "surface", light: "#f6f8fa", dark: "#202124", use: "The default card fill: PaperCard surface \"front\"." },
    { token: "surface-raised", light: "#ffffff", dark: "#27282b", use: "A fill above surface: PaperCard surface \"frontest\", and the rows of a settings list, buttons, modals, menus, tables, and quotes." },
    { token: "surface-sunken", light: "#e2e5ea", dark: "#1a1b1e", use: "Quieter areas and the chrome around the canvas: PaperCard surface \"back\", badges, and the top bar of a phone-width page." },
    { token: "surface-inset", light: "#e7eaee", dark: "#0f1011", use: "Recessed wells: the background of a PaperList, parts of PaperInput, and the hover fill of a pressable widget tile." },
    { token: "surface-element", light: "#cdd3db", dark: "#323337", use: "An interactive tile fill: PaperCard surface \"element\", and the fallback tile of PaperAvatar." },
];

const borders: Array<{ token: PaperBorderColor; light: string; dark: string; use: string }> = [
    { token: "border-subtle", light: "#d2d6dd", dark: "#33353a", use: "Separators nested inside a surface, such as the rule between settings rows." },
    { token: "border", light: "#c4c9d2", dark: "#3a3c40", use: "The standard divider and the border of a card." },
    { token: "border-strong", light: "#adb3be", dark: "#4d5055", use: "Emphasized edges." },
    { token: "border-emphasis", light: "#7d8492", dark: "#676a70", use: "Drop targets and table rules." },
];

export default function SurfacesDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Surfaces and borders</PaperText>
            <PaperText preset="body" as="p">
                PaperUI paints a panel with a short ramp of surfaces, from a recessed well up to a raised card, and draws edges with four border strengths.
                Pick a surface by what the area is, and the light and dark values follow.
                Components already choose theirs: you set a surface only on PaperCard and PaperFlex.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="using-surfaces">Using surfaces</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink> takes a <PaperCode>surface</PaperCode> name and <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink> takes a <PaperCode>background</PaperCode> token.
                A card is bordered and rounded; a flex container only fills.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex direction="row" gap="full" wrap>
                    <PaperFlex padding="double" background="surface-app"><PaperText preset="hint">surface-app</PaperText></PaperFlex>
                    <PaperFlex padding="double" background="surface"><PaperText preset="hint">surface</PaperText></PaperFlex>
                    <PaperFlex padding="double" background="surface-raised"><PaperText preset="hint">surface-raised</PaperText></PaperFlex>
                    <PaperFlex padding="double" background="surface-sunken"><PaperText preset="hint">surface-sunken</PaperText></PaperFlex>
                    <PaperFlex padding="double" background="surface-inset"><PaperText preset="hint">surface-inset</PaperText></PaperFlex>
                    <PaperFlex padding="double" background="surface-element"><PaperText preset="hint">surface-element</PaperText></PaperFlex>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperText } from "@mileniumhq/paperui";

<PaperFlex direction="row" gap="full" wrap>
    <PaperFlex padding="double" background="surface-app"><PaperText preset="hint">surface-app</PaperText></PaperFlex>
    <PaperFlex padding="double" background="surface"><PaperText preset="hint">surface</PaperText></PaperFlex>
    <PaperFlex padding="double" background="surface-raised"><PaperText preset="hint">surface-raised</PaperText></PaperFlex>
    <PaperFlex padding="double" background="surface-sunken"><PaperText preset="hint">surface-sunken</PaperText></PaperFlex>
    <PaperFlex padding="double" background="surface-inset"><PaperText preset="hint">surface-inset</PaperText></PaperFlex>
    <PaperFlex padding="double" background="surface-element"><PaperText preset="hint">surface-element</PaperText></PaperFlex>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="surface-tokens">Surface tokens</PaperText>
            <PaperText preset="body" as="p">
                The names are the type <PaperCode>PaperBackgroundSurface</PaperCode>; the array <PaperCode>backgroundSurfaces</PaperCode> lists them.
                Each is the variable <PaperCode>--paper-name</PaperCode>.
                Light is a pale sheet with white cards lifting off it, and the chrome around it sinks one shade greyer.
                Dark reverses the luminance: elevation comes from lighter surfaces, not from shadow.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Light</th>
                        <th>Dark</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    {surfaces.map((s) => (
                        <tr>
                            <td><PaperCode>{s.token}</PaperCode></td>
                            <td><PaperSwatch color={s.light} /> <PaperCode>{s.light}</PaperCode></td>
                            <td><PaperSwatch color={s.dark} /> <PaperCode>{s.dark}</PaperCode></td>
                            <td>{s.use}</td>
                        </tr>
                    ))}
                    <tr>
                        <td><PaperCode>field</PaperCode></td>
                        <td><PaperSwatch color="#ffffff" /> <PaperCode>#ffffff</PaperCode></td>
                        <td><PaperSwatch color="#1a1b1e" /> <PaperCode>#1a1b1e</PaperCode></td>
                        <td>A text field's fill: a white sheet on light, a recessed well on dark. PaperInput paints with it.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>--paper-field-well</PaperCode> (<PaperCode>rgba(0, 0, 0, 0.06)</PaperCode>) is a translucent shade for a recessed area that has to read on any surface.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="card-surfaces">PaperCard surfaces</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th><PaperCode>surface</PaperCode></th>
                        <th>Fill</th>
                        <th>Choose it for</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"front"</PaperCode></td>
                        <td><PaperCode>surface</PaperCode></td>
                        <td>The default card on the canvas.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"frontest"</PaperCode></td>
                        <td><PaperCode>surface-raised</PaperCode></td>
                        <td>A card inside a card, or a card that should stand above its neighbors.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"back"</PaperCode></td>
                        <td><PaperCode>surface-sunken</PaperCode></td>
                        <td>A quieter area, or a card that holds raised cards.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"element"</PaperCode></td>
                        <td><PaperCode>surface-element</PaperCode></td>
                        <td>An interactive tile.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"transparent"</PaperCode></td>
                        <td>None</td>
                        <td>A bordered, rounded frame that shows what is behind it. <PaperCode>plain</PaperCode> drops the border as well, and <PaperCode>borderless</PaperCode> drops only the border.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="which-props">Props that take a surface</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Component</th>
                        <th>Prop</th>
                        <th>Values</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink></td>
                        <td><PaperCode>surface</PaperCode></td>
                        <td><PaperCode>front</PaperCode>, <PaperCode>frontest</PaperCode>, <PaperCode>back</PaperCode>, <PaperCode>element</PaperCode>, <PaperCode>transparent</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink></td>
                        <td><PaperCode>background</PaperCode></td>
                        <td>Any surface token, any other token name, or a CSS color</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink></td>
                        <td><PaperCode>background</PaperCode></td>
                        <td>Any surface token or <PaperCode>"transparent"</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperswatch/">PaperSwatch</PaperLink>, <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink></td>
                        <td><PaperCode>color</PaperCode></td>
                        <td>Any <PaperCode>PaperColor</PaperCode>, which includes the surface tokens</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="borders">Borders</PaperText>
            <PaperText preset="body" as="p">
                Borders are the type <PaperCode>PaperBorderColor</PaperCode>, and the array <PaperCode>borderColors</PaperCode> lists them.
                Components draw their own edges, so there is no border prop to set. Read these tokens when a custom area needs a matching edge.
                Every value is readable against the surfaces it sits on.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Light</th>
                        <th>Dark</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    {borders.map((b) => (
                        <tr>
                            <td><PaperCode>{b.token}</PaperCode></td>
                            <td><PaperSwatch color={b.light} /> <PaperCode>{b.light}</PaperCode></td>
                            <td><PaperSwatch color={b.dark} /> <PaperCode>{b.dark}</PaperCode></td>
                            <td>{b.use}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="widths-radii">Widths and radii</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-border-width</PaperCode></td><td><PaperCode>1px</PaperCode></td><td>Every standard edge.</td></tr>
                    <tr><td><PaperCode>--paper-thick-border-width</PaperCode></td><td><PaperCode>2px</PaperCode></td><td>The focus ring, and the weight of an input's active edge.</td></tr>
                    <tr><td><PaperCode>--paper-thickest-border-width</PaperCode></td><td><PaperCode>3px</PaperCode></td><td>The accent bar of a quote.</td></tr>
                    <tr><td><PaperCode>--paper-border-radius</PaperCode></td><td><PaperCode>12px</PaperCode></td><td>Cards, buttons, modals, and menus.</td></tr>
                    <tr><td><PaperCode>--paper-border-radius-half</PaperCode></td><td><PaperCode>6px</PaperCode></td><td>Small inner shapes, such as code chips.</td></tr>
                    <tr><td><PaperCode>--paper-border-radius-pill</PaperCode></td><td><PaperCode>999px</PaperCode></td><td>Pills: chips, progress dots, and the wizard's step dots.</td></tr>
                    <tr><td><PaperCode>--paper-focus-ring</PaperCode></td><td><PaperCode>2px solid primary</PaperCode></td><td>The outline of keyboard focus, drawn on devices with hover.</td></tr>
                    <tr><td><PaperCode>--paper-focus-offset</PaperCode></td><td><PaperCode>2px</PaperCode></td><td>The gap between an element and its focus ring.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="shadows">Shadows</PaperText>
            <PaperText preset="body" as="p">
                Shadows are few and soft, because dark surfaces show elevation through luminance.
                The tactile offset shadow of a pressed button comes from <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink>, not from these variables.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-element-shadow</PaperCode></td><td><PaperCode>0 2px 4px rgba(0, 0, 0, 0.05)</PaperCode></td><td>A lightly lifted element, such as a modal or a media card.</td></tr>
                    <tr><td><PaperCode>--paper-heavy-element-shadow</PaperCode></td><td><PaperCode>0 2px 6px 1px rgba(0, 0, 0, 0.2)</PaperCode></td><td>Floating surfaces: menus and the page that slides over a phone-width panel.</td></tr>
                    <tr><td><PaperCode>--paper-lifted-shadow</PaperCode></td><td><PaperCode>0 16px 32px rgba(0, 0, 0, 0.55)</PaperCode></td><td>An element lifted off the page mid-drag. It works in <PaperCode>box-shadow</PaperCode> and <PaperCode>drop-shadow()</PaperCode>.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="themes">Light and dark</PaperText>
            <PaperText preset="body" as="p">
                Theme variables are defined three ways, so they resolve in every context.
            </PaperText>
            <PaperTextList>
                <li><PaperCode>:root</PaperCode> holds the light values, and a <PaperCode>prefers-color-scheme: dark</PaperCode> query swaps in the dark ones.</li>
                <li>A <PaperCode>[data-paperui-theme="light"]</PaperCode> or <PaperCode>"dark"</PaperCode> element forces its subtree. <PaperCode>[data-theme="light"]</PaperCode> and <PaperCode>"dark"</PaperCode> work the same.</li>
                <li><PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink> writes <PaperCode>data-paperui-theme</PaperCode> on its root from its <PaperCode>theme</PaperCode> prop. With no prop, it follows the <PaperCode>data-paperui-theme</PaperCode> attribute that the Paperboard window writes on the panel's <PaperCode>html</PaperCode> element, then the operating system.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A panel writes no theme code. Keep every color a token and the panel follows the window.
            </PaperText>
        </PaperFlex>
    );
}
