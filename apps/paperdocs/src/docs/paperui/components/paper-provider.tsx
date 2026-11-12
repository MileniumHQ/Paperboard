import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperProviderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperProvider</PaperText>
            <PaperText preset="body" as="p">
                PaperProvider is the root of every PaperUI interface: it applies the theme, scopes the PaperUI styles, and sets up touch gestures.
                Wrap a panel's whole interface in one, once, at the entry point.
                The theme colors are keyed to the attribute the provider sets, so components outside one lose them.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Import the stylesheet once, then render the provider around the panel.
                <PaperCode>fullWidth</PaperCode> and <PaperCode>fullHeight</PaperCode> make it fill the panel's frame.
            </PaperText>
            <PaperCode block language="tsx">
{`import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import App from "./App";

render(
    () => (
        <PaperProvider fullWidth fullHeight>
            <App />
        </PaperProvider>
    ),
    document.getElementById("root")!,
);`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A panel that shows one screen through <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> or <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink> needs nothing else around them.
                Each widget of a panel gets its own provider, as the gameserver panel's widget entry does.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperProviderProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the root <PaperCode>div</PaperCode>, which has the class <PaperCode>paperui-root</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>theme</PaperCode></td>
                        <td><PaperCode>ThemeMode</PaperCode></td>
                        <td>No default (follow the host)</td>
                        <td><PaperCode>"light"</PaperCode>, <PaperCode>"dark"</PaperCode>, or <PaperCode>"system"</PaperCode>. See Theme.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullScreen</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Sizes the root to the viewport, 100vw by 100vh.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Sizes the root to the viewport's width.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Sizes the root to the viewport's height.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>scrollable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Scrolls the root vertically. Combined with <PaperCode>fullScreen</PaperCode> or <PaperCode>fullHeight</PaperCode>, the root is at least the viewport tall and grows with its content.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unselectable</PaperCode>, <PaperCode>noSelect</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Stops text selection across the interface, like a native app. Code, <PaperCode>pre</PaperCode>, <PaperCode>kbd</PaperCode>, and elements with the class <PaperCode>selectable</PaperCode> stay selectable. The two props are aliases.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>styleBody</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Copies the resolved theme to the page's <PaperCode>body</PaperCode>, and the unselectable setting too, so content outside the provider matches. The attributes are not removed when the provider unmounts.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root, after <PaperCode>paperui-root</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="ts">
{`type ThemeMode = "light" | "dark" | "system";`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="theme">Theme</PaperText>
            <PaperText preset="body" as="p">
                The root carries the result as <PaperCode>data-paperui-theme</PaperCode>, <PaperCode>"light"</PaperCode> or <PaperCode>"dark"</PaperCode>, and the tokens follow it.
                The result is picked in this order:
            </PaperText>
            <PaperTextList ordered>
                <li>An explicit <PaperCode>"light"</PaperCode> or <PaperCode>"dark"</PaperCode> in <PaperCode>theme</PaperCode>.</li>
                <li>With no <PaperCode>theme</PaperCode> prop, the host's choice: Paperboard writes <PaperCode>data-paperui-theme</PaperCode> on the panel document's root element, so a panel always matches its window. The provider follows later changes.</li>
                <li>Otherwise the operating system's color scheme, kept up to date as it changes. An explicit <PaperCode>theme="system"</PaperCode> skips the host and goes straight here.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Leave <PaperCode>theme</PaperCode> unset in a panel. Set it only when the interface must stay in one mode.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="use-paper">usePaper</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>usePaper()</PaperCode> reads the provider from a component inside it.
                It returns <PaperCode>undefined</PaperCode> outside a provider.
            </PaperText>
            <PaperCode block language="ts">
{`import { usePaper, type ThemeMode } from "@mileniumhq/paperui";

const paper = usePaper();
paper?.theme(); // ThemeMode: the mode, "system" included, not the resolved light or dark
paper?.setTheme("dark"); // ThemeMode => void`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>setTheme</PaperCode> sets the provider's own mode, which is used only while the <PaperCode>theme</PaperCode> prop is unset. A <PaperCode>theme</PaperCode> prop always wins.
                The provider starts in <PaperCode>"system"</PaperCode>, which then defers to the host.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="icon-font">Icon font</PaperText>
            <PaperTextList>
                <li>Icons are glyphs in a font. The provider keeps the interface invisible, though still focusable, until the font has loaded, so icons never paint blank and shift their rows.</li>
                <li>Rendering a provider without the stylesheet throws <PaperCode>--paper-icon-font-family is not set: import @mileniumhq/paperui/style.css</PaperCode>. Import <PaperCode>@mileniumhq/paperui/style.css</PaperCode> before rendering.</li>
                <li>If the font fails to load, the interface is shown anyway and an error saying <PaperCode>PaperUI's icon font failed to load</PaperCode>, with the reason, is thrown.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="touch">Touch gestures</PaperText>
            <PaperText preset="body" as="p">
                A provider installs two gestures for touch screens and removes them when it unmounts.
                Dragging an open page to the right goes back, like the iOS back swipe, unless the touch started on something with a horizontal gesture of its own, or on an element with <PaperCode>data-paper-no-swipe-back</PaperCode>.
                Holding a finger still for half a second fires a <PaperCode>contextmenu</PaperCode> event at it, as a right click does, so the same handlers work on touch.
                Taps don't flash the browser's grey highlight inside the root; components show their own pressed state.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="scrollable">A scrolling document</PaperText>
            <PaperText preset="body" as="p">
                A long page that scrolls as a whole, with selection off like an app:
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperProvider, PaperText } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";

export function Document() {
    return (
        <PaperProvider fullScreen scrollable unselectable>
            <PaperText preset="body" as="p">Content that can run past the viewport.</PaperText>
        </PaperProvider>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="switch-theme">A theme switch</PaperText>
            <PaperText preset="body" as="p">
                Read and set the mode with <PaperCode>usePaper</PaperCode>.
                It takes effect while the provider has no <PaperCode>theme</PaperCode> prop.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, usePaper } from "@mileniumhq/paperui";

export function DarkToggle() {
    const paper = usePaper();
    if (!paper) throw new Error("DarkToggle must be rendered inside a PaperProvider");

    return (
        <PaperButton onClick={() => paper.setTheme(paper.theme() === "dark" ? "light" : "dark")}>
            Switch theme
        </PaperButton>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
