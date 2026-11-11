import {
    PaperBadge,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSwatch,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";
import type { PaperRole } from "@mileniumhq/paperui";

const roles: Array<{ role: PaperRole; light: [string, string]; dark: [string, string]; hue: string; meaning: string }> = [
    { role: "primary", light: ["#217bf4", "#025dc9"], dark: ["#3e89f7", "#1b6ad4"], hue: "Blue", meaning: "The action color: primary buttons, selection, focus rings, the active scrollbar thumb." },
    { role: "brand", light: ["#217bf4", "#025dc9"], dark: ["#3e89f7", "#1b6ad4"], hue: "Blue", meaning: "An alias of primary. It resolves to the primary variable." },
    { role: "success", light: ["#059a46", "#057836"], dark: ["#15a84f", "#06853c"], hue: "Green", meaning: "Healthy, running, completed, created." },
    { role: "danger", light: ["#e6293f", "#ba0329"], dark: ["#ec4a52", "#c82235"], hue: "Red", meaning: "Errors, destructive actions, stopped or failed." },
    { role: "warning", light: ["#e7a203", "#bf8608"], dark: ["#f3b031", "#cf9105"], hue: "Amber", meaning: "Cautions, pending work, things worth a second look." },
    { role: "attention", light: ["#e66006", "#b84b03"], dark: ["#f26f27", "#ca5302"], hue: "Orange", meaning: "A notice that needs the user, stronger than warning." },
    { role: "extra-1", light: ["#039b8c", "#037a6e"], dark: ["#04a999", "#04877a"], hue: "Teal", meaning: "A category color with no fixed meaning." },
    { role: "extra-2", light: ["#8a3feb", "#6e0fc8"], dark: ["#9357ed", "#7634cb"], hue: "Purple", meaning: "A category color with no fixed meaning." },
    { role: "extra-3", light: ["#d82aaf", "#af038c"], dark: ["#df4ab8", "#bc2498"], hue: "Magenta", meaning: "A category color with no fixed meaning." },
];

const textTokens: Array<{ token: string; light: string; dark: string; use: string }> = [
    { token: "text", light: "#0f1319", dark: "#f5f5f5", use: "Body text and titles." },
    { token: "text-muted", light: "#2e3440", dark: "#d4d4d4", use: "Text a step below the body." },
    { token: "text-subtle", light: "#525a68", dark: "#a1a1a1", use: "Hints, descriptions, counts, and section headings." },
    { token: "text-faint", light: "#6e7684", dark: "#858585", use: "The quietest readable text: placeholders and timestamps." },
    { token: "contrast", light: "#000000", dark: "#ffffff", use: "The tone opposite the background, for tints and mixes." },
    { token: "on-color", light: "#ffffff", dark: "#ffffff", use: "Text and icons on a solid role fill." },
];

const osColors: Array<{ name: string; value: string }> = [
    { name: "macos", value: "#ffffff" },
    { name: "windows", value: "#0078d4" },
    { name: "ubuntu", value: "#e95420" },
    { name: "arch", value: "#1793d1" },
    { name: "debian", value: "#a80030" },
    { name: "fedora", value: "#3c6eb4" },
    { name: "linuxmint", value: "#86be43" },
    { name: "zorin", value: "#0cc1e8" },
    { name: "steamos", value: "#1a9fff" },
    { name: "pop", value: "#48b9c7" },
    { name: "manjaro", value: "#35bf5c" },
    { name: "elementary", value: "#64baff" },
    { name: "nixos", value: "#5277c3" },
    { name: "raspbian", value: "#c51a4a" },
    { name: "linux", value: "#fcc624" },
    { name: "unknown", value: "#888888" },
];

export default function ColorsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Colors</PaperText>
            <PaperText preset="body" as="p">
                PaperUI colors are roles, not hues: each one names a meaning, and components pick the shade.
                Reach for a role through a component prop (<PaperCode>variant</PaperCode>, <PaperCode>tone</PaperCode>, <PaperCode>accent</PaperCode>, <PaperCode>color</PaperCode>) and a panel keeps its colors consistent in light and dark without writing a color.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="using-colors">Using colors</PaperText>
            <PaperText preset="body" as="p">
                Every color is a CSS custom property named <PaperCode>--paper-name</PaperCode>, defined on the page by <PaperCode>@mileniumhq/paperui/style.css</PaperCode>.
                A prop that takes a color accepts the name without the prefix.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PaperBadge variant="primary">primary</PaperBadge>
                    <PaperBadge variant="success">success</PaperBadge>
                    <PaperBadge variant="danger">danger</PaperBadge>
                    <PaperText color="text-subtle">text-subtle</PaperText>
                    <PaperSwatch color="warning" size="large" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperFlex, PaperSwatch, PaperText } from "@mileniumhq/paperui";

<PaperFlex direction="row" gap="full" align="center" wrap>
    <PaperBadge variant="primary">primary</PaperBadge>
    <PaperBadge variant="success">success</PaperBadge>
    <PaperBadge variant="danger">danger</PaperBadge>
    <PaperText color="text-subtle">text-subtle</PaperText>
    <PaperSwatch color="warning" size="large" />
</PaperFlex>`}
            </PaperCode>
            <PaperText preset="body" as="p">
                When a value is not a prop, read the variable with <PaperLink href="/docs/paperui/utilities/#getvarcss">getVarCss</PaperLink>: <PaperCode>getVarCss("success")</PaperCode> returns <PaperCode>var(--paper-success)</PaperCode>. Never write the <PaperCode>var()</PaperCode> string or a hex value by hand.
            </PaperText>
            <PaperText preset="body" as="p">
                Props typed <PaperCode>PaperColor</PaperCode> (on PaperText, PaperTextList, PaperSwatch, and PaperChart) take any role, <PaperLink href="/docs/paperui/surfaces/">surface, or border</PaperLink> token and any text token below.
                A value that starts with <PaperCode>#</PaperCode> or looks like a CSS function (<PaperCode>rgb(</PaperCode>, <PaperCode>oklch(</PaperCode>, <PaperCode>color-mix(</PaperCode>, <PaperCode>var(</PaperCode>), or is <PaperCode>currentColor</PaperCode> or <PaperCode>transparent</PaperCode>, is used as written.
                Any other string becomes <PaperCode>var(--paper-name)</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="roles">Color roles</PaperText>
            <PaperText preset="body" as="p">
                The nine roles are the type <PaperCode>PaperRole</PaperCode>, and the array <PaperCode>paperRoles</PaperCode> lists them.
                Each role is built in OKLCH: one perceived lightness for every role (warning sits higher, so it stays yellow) at the most chroma the screen can show.
                Dark mode lifts each role a little and softens it a little, so it doesn't buzz against the dark surfaces.
                Each role also has a deep shade, <PaperCode>--paper-name-deep</PaperCode>: the same hue, darker. Components use it as the edge of the <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink> shadow and for text on a tinted fill.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Sample</th>
                        <th>Light</th>
                        <th>Dark</th>
                        <th>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    {roles.map((r) => (
                        <tr>
                            <td><PaperCode>{r.role}</PaperCode></td>
                            <td><PaperSwatch color={r.role} size="large" /></td>
                            <td><PaperCode>{r.light[0]}</PaperCode>, deep <PaperCode>{r.light[1]}</PaperCode> ({r.hue})</td>
                            <td><PaperCode>{r.dark[0]}</PaperCode>, deep <PaperCode>{r.dark[1]}</PaperCode></td>
                            <td>{r.meaning}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="where-roles-go">Props that take a role</PaperText>
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
                        <td><PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink>, <PaperLink href="/docs/paperui/papercopybutton/">PaperCopyButton</PaperLink></td>
                        <td><PaperCode>variant</PaperCode></td>
                        <td>A role, <PaperCode>"outline"</PaperCode>, or <PaperCode>"text"</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperbadge/">PaperBadge</PaperLink>, <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink></td>
                        <td><PaperCode>variant</PaperCode></td>
                        <td>A role or <PaperCode>"monochrome"</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink>, <PaperLink href="/docs/paperui/paperprogress/">PaperProgress</PaperLink></td>
                        <td><PaperCode>variant</PaperCode></td>
                        <td>A role</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperstattile/">PaperStatTile</PaperLink></td>
                        <td><PaperCode>variant</PaperCode>, <PaperCode>tone</PaperCode></td>
                        <td>A role</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink></td>
                        <td><PaperCode>accent</PaperCode></td>
                        <td>A role: tints the surface and border</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperavatar/">PaperAvatar</PaperLink></td>
                        <td><PaperCode>accent</PaperCode></td>
                        <td>A role</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/paperwidget/">PaperWidget</PaperLink> parts</td>
                        <td><PaperCode>tone</PaperCode></td>
                        <td>A role (and <PaperCode>"none"</PaperCode> on rows and dots)</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink>, <PaperLink href="/docs/paperui/papertextlist/">PaperTextList</PaperLink>, <PaperLink href="/docs/paperui/paperswatch/">PaperSwatch</PaperLink>, <PaperLink href="/docs/paperui/paperchart/">PaperChart</PaperLink></td>
                        <td><PaperCode>color</PaperCode></td>
                        <td>Any <PaperCode>PaperColor</PaperCode></td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="primary-ink">Primary ink</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>--paper-primary-ink</PaperCode> is the action color as text or a glyph on a plain or tinted surface.
                It is the deep blue <PaperCode>#025dc9</PaperCode> in light and a lifted blue <PaperCode>#74acfe</PaperCode> in dark, so it reads in both themes.
                Use it, not the plain role, for blue text. Other roles have no ink token.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="text-colors">Text colors</PaperText>
            <PaperText preset="body" as="p">
                The text tokens are the type <PaperCode>PaperTextColor</PaperCode>.
                Their values differ between light and dark, and a component that sets <PaperCode>color</PaperCode> to one of them follows the theme.
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
                    {textTokens.map((t) => (
                        <tr>
                            <td><PaperCode>{t.token}</PaperCode></td>
                            <td><PaperSwatch color={t.light} /> <PaperCode>{t.light}</PaperCode></td>
                            <td><PaperSwatch color={t.dark} /> <PaperCode>{t.dark}</PaperCode></td>
                            <td>{t.use}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The text presets set these for you: <PaperCode>heading</PaperCode>, <PaperCode>section</PaperCode>, and <PaperCode>hint</PaperCode> use <PaperCode>text-subtle</PaperCode> and <PaperCode>error</PaperCode> uses <PaperCode>danger</PaperCode>.
                See <PaperLink href="/docs/paperui/typography/">Typography</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="overlays">Overlays and selection</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Light</th>
                        <th>Dark</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-scrim</PaperCode></td>
                        <td><PaperCode>rgba(0, 0, 0, 0.45)</PaperCode></td>
                        <td><PaperCode>rgba(0, 0, 0, 0.6)</PaperCode></td>
                        <td>The dimmed layer behind a modal.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-scrim-light</PaperCode></td>
                        <td><PaperCode>rgba(255, 255, 255, 0.7)</PaperCode></td>
                        <td><PaperCode>rgba(255, 255, 255, 0.7)</PaperCode></td>
                        <td>A light veil over a dark surface.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-selection</PaperCode></td>
                        <td><PaperCode>#217bf44d</PaperCode></td>
                        <td><PaperCode>#217bf44d</PaperCode></td>
                        <td>Text selection fill for surfaces the browser's own <PaperCode>::selection</PaperCode> cannot reach, such as terminals and canvases.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="operating-system-colors">Operating system colors</PaperText>
            <PaperText preset="body" as="p">
                An operating system is its color, so these identities stay the same in every theme.
                Read them with <PaperCode>getVarCss("os-ubuntu")</PaperCode> or pass the token to a <PaperCode>color</PaperCode> prop, such as <PaperCode>{'<PaperSwatch color="os-ubuntu" />'}</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Sample</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    {osColors.map((o) => (
                        <tr>
                            <td><PaperCode>{`os-${o.name}`}</PaperCode></td>
                            <td><PaperSwatch color={`os-${o.name}`} size="large" /></td>
                            <td><PaperCode>{o.value}</PaperCode></td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="identity-colors">First-party identity colors</PaperText>
            <PaperText preset="body" as="p">
                A few fixed colors belong to first-party panels and the marketing site.
                They are the same in light and dark and are not meant for other panels.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-panel-gameserver</PaperCode></td><td><PaperCode>#ee3865</PaperCode></td></tr>
                    <tr><td><PaperCode>--paper-panel-ai</PaperCode></td><td><PaperCode>#00f5d4</PaperCode></td></tr>
                    <tr><td><PaperCode>--paper-panel-actions</PaperCode></td><td><PaperCode>#2454bd</PaperCode></td></tr>
                    <tr><td><PaperCode>--paper-panel-botcreator</PaperCode></td><td><PaperCode>#5865f2</PaperCode></td></tr>
                    <tr><td><PaperCode>--paper-panel-agents</PaperCode></td><td><PaperCode>#43bb79</PaperCode></td></tr>
                    <tr><td><PaperCode>--paper-marketing-ink</PaperCode></td><td><PaperCode>#080c12</PaperCode></td></tr>
                    <tr><td><PaperCode>--paper-face-verity</PaperCode></td><td><PaperCode>#ffd60a</PaperCode>, with <PaperCode>--paper-face-verity-ink</PaperCode> <PaperCode>#000000</PaperCode> for its features</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="rules">Rules</PaperText>
            <PaperTextList>
                <li>Pick a role by meaning. Success means healthy, danger means broken or destructive, and a role never carries a second meaning in the same panel.</li>
                <li>Never convey state by color alone. Pair the color with a label or an icon.</li>
                <li>Text on a solid role fill is <PaperCode>on-color</PaperCode>. Components do this for you.</li>
                <li>Never write a hex value. Use a role, or read the variable with <PaperCode>getVarCss()</PaperCode>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
