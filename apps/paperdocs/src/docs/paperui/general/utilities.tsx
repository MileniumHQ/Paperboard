import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function UtilitiesDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Utilities</PaperText>
            <PaperText preset="body" as="p">
                PaperUI exports helper functions, two contexts, and two stylesheet entry points besides its components.
                Reach for them when a panel needs a design token in code, a clipboard call that reports failure, bounded polling, or the layout and panel state that components share.
                Everything on this page imports from <PaperCode>@mileniumhq/paperui</PaperCode> except the stylesheets.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="entry-points">Stylesheet entry points</PaperText>
            <PaperText preset="body" as="p">
                The package has two stylesheets. A panel imports both in its entry file, once, before it renders.
            </PaperText>
            <PaperCode block language="tsx">
{`import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Import</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>@mileniumhq/paperui/style.css</PaperCode></td>
                        <td>Defines every <PaperCode>--paper-*</PaperCode> token for light and dark, loads the fonts (Nunito Sans, Nunito, SUSE Mono, and the icon font), and styles every component. Its rules are scoped to <PaperCode>.paperui-root</PaperCode> and <PaperCode>[data-paperui-theme]</PaperCode>, so they never restyle the host page. Without it, <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink> throws an error saying to import it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>@mileniumhq/paperui/panel.css</PaperCode></td>
                        <td>The document reset for a panel, which is its own page. It gives <PaperCode>html</PaperCode>, <PaperCode>body</PaperCode>, and <PaperCode>#app</PaperCode> zero margin and padding, 100% width and height, hidden overflow, the canvas background (<PaperCode>--paper-surface-app</PaperCode>), the text color, and the body font. The panel's mount element must have the id <PaperCode>app</PaperCode>. With it, a panel writes no CSS. Pages scroll inside PaperUI components, not on the body.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="theme-helpers">Theme helpers</PaperText>
            <PaperText preset="subheader" as="h3" id="getvarcss">getVarCss</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>getVarCss(name: string, fallback?: string): string</PaperCode> returns a <PaperCode>var()</PaperCode> expression for a design token.
                Use it wherever a value is a token and no prop takes it, instead of writing <PaperCode>var(--paper-...)</PaperCode> by hand.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Call</th>
                        <th>Returns</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>getVarCss("success")</PaperCode></td><td><PaperCode>var(--paper-success)</PaperCode></td></tr>
                    <tr><td><PaperCode>getVarCss("paper-success")</PaperCode></td><td><PaperCode>var(--paper-success)</PaperCode></td></tr>
                    <tr><td><PaperCode>getVarCss("--paper-success")</PaperCode></td><td><PaperCode>var(--paper-success)</PaperCode></td></tr>
                    <tr><td><PaperCode>getVarCss("size-field", "10rem")</PaperCode></td><td><PaperCode>var(--paper-size-field, 10rem)</PaperCode></td></tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`import { getVarCss } from "@mileniumhq/paperui";

const accent = getVarCss("extra-2");
const width = getVarCss("size-panel-small");`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="getvar">getVar</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>getVar(name: string, fallback?: string): string</PaperCode> reads a token's current computed value, such as <PaperCode>#2981e5</PaperCode>, from the root element (then the body).
                The name takes the same three forms as getVarCss.
                It returns the fallback, or an empty string when none is given, when the token is not set or when there is no document.
                Use it for code that needs a real color, such as a canvas.
                The value changes with the theme, so read it again when the theme changes.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="resolvers">Resolvers</PaperText>
            <PaperText preset="body" as="p">
                The resolvers turn a prop value into CSS. Components call them, and you call them in your own components so their props behave the same.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>resolveSpacing(value?: PaperSpacing): string | undefined</PaperCode></td>
                        <td>Undefined stays undefined. A number is pixels. A spacing token (<PaperCode>"none"</PaperCode>, <PaperCode>"half"</PaperCode>, <PaperCode>"double"</PaperCode>, and the rest) becomes its variable. A string that starts with <PaperCode>var(</PaperCode> or <PaperCode>calc(</PaperCode>, or ends in <PaperCode>px</PaperCode>, <PaperCode>rem</PaperCode>, or <PaperCode>%</PaperCode>, is returned unchanged. Anything else becomes <PaperCode>var(--paper-value)</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resolveSize(value: string | number): string</PaperCode></td>
                        <td>A number is pixels. A size token (<PaperCode>"field"</PaperCode>, <PaperCode>"panel-small"</PaperCode>) becomes <PaperCode>var(--paper-size-name)</PaperCode>. Any other string is returned unchanged.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isPaperSize(value: unknown): value is PaperSize</PaperCode></td>
                        <td>Whether the value is one of the size token names.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resolveColor(value?: PaperColor | string): string | undefined</PaperCode></td>
                        <td>Undefined or an empty string gives undefined. A string that starts with <PaperCode>#</PaperCode>, looks like a CSS function (<PaperCode>rgb(</PaperCode>, <PaperCode>color-mix(</PaperCode>, <PaperCode>var(</PaperCode>), or is <PaperCode>currentColor</PaperCode> or <PaperCode>transparent</PaperCode>, is returned unchanged. Anything else becomes <PaperCode>var(--paper-value)</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resolveBackground(value?: PaperBackgroundSurface | string): string | undefined</PaperCode></td>
                        <td>Undefined or an empty string gives undefined. A <PaperCode>var(</PaperCode> string, a hex value, an <PaperCode>rgb</PaperCode> or <PaperCode>hsl</PaperCode> string, or <PaperCode>"transparent"</PaperCode> is returned unchanged. Anything else becomes <PaperCode>var(--paper-value)</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>SPACING_MAP: Record&lt;string, string&gt;</PaperCode></td>
                        <td>The spacing tokens mapped to their variables: <PaperCode>none</PaperCode> to <PaperCode>"0"</PaperCode>, the others to <PaperCode>var(--paper-uigap-*)</PaperCode>, and <PaperCode>inset</PaperCode> to <PaperCode>var(--paper-inset)</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="cx">cx</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>cx(...parts: Array&lt;string | false | null | undefined&gt;): string</PaperCode> joins the strings with spaces and drops falsy parts.
                Use it to build a <PaperCode>class</PaperCode> from conditions.
            </PaperText>
            <PaperCode block language="tsx">
{`import { cx } from "@mileniumhq/paperui";

const className = cx("card", props.active && "active", props.class);`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="clipboard">Clipboard</PaperText>
            <PaperText preset="body" as="p">
                Both functions use the async clipboard API first and fall back to a temporary <PaperCode>textarea</PaperCode> with <PaperCode>document.execCommand</PaperCode>.
                Neither throws and neither lies: they return a failure value and log the reason, so the caller must show the failure.{" "}
                <PaperLink href="/docs/paperui/papercopybutton/">PaperCopyButton</PaperLink> does this for a copy button.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Returns</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>copyText(text: string): Promise&lt;boolean&gt;</PaperCode></td>
                        <td><PaperCode>true</PaperCode> when the text was copied, <PaperCode>false</PaperCode> when both paths failed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pasteText(): Promise&lt;string | null&gt;</PaperCode></td>
                        <td>The clipboard text, or <PaperCode>null</PaperCode> when both paths failed. An empty string means the clipboard is empty, not unavailable.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { copyText, PaperButton, PaperText } from "@mileniumhq/paperui";

export function CopyAddress(props: { address: string }) {
    const [failed, setFailed] = createSignal(false);

    const copy = async () => {
        setFailed(!(await copyText(props.address)));
    };

    return (
        <>
            <PaperButton onClick={() => void copy()}>Copy address</PaperButton>
            <Show when={failed()}>
                <PaperText preset="error">The address could not be copied.</PaperText>
            </Show>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="polling">createPolling</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>createPolling(fn: () =&gt; void | Promise&lt;void&gt;, intervalMs: number, options?: CreatePollingOptions): () =&gt; void</PaperCode> runs a function on an interval inside a Solid component or root.
                The interval is cleared when the owner is disposed, and the returned function stops it earlier.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Parameter</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>fn</PaperCode></td>
                        <td><PaperCode>() =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>Required</td>
                        <td>Called on every tick. A throw or a rejection is logged with <PaperCode>console.error</PaperCode> and the next tick still runs. It is not shown in the interface: catch inside <PaperCode>fn</PaperCode> to show a failure.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>intervalMs</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>Required</td>
                        <td>Milliseconds between ticks. Must be a finite number above zero, or it throws <PaperCode>createPolling needs a positive interval</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>options.immediate</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Runs <PaperCode>fn</PaperCode> once immediately, before the first interval.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Ticks do not wait for the previous call to finish, so keep <PaperCode>fn</PaperCode> fast or guard against overlap.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { createPolling, PaperText } from "@mileniumhq/paperui";

export function Clock() {
    const [now, setNow] = createSignal(new Date().toLocaleTimeString());

    createPolling(() => setNow(new Date().toLocaleTimeString()), 1000);

    return <PaperText preset="label">{now()}</PaperText>;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="ansi">ANSI text</PaperText>
            <PaperText preset="body" as="p">
                These parse terminal output.{" "}
                <PaperLink href="/docs/paperui/paperconsole/">PaperConsole</PaperLink> uses them, so you need them only to build your own terminal view.
                Each treats a carriage return as an overwrite and keeps the text after the last one in a line.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Returns</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>cleanTerminalLine(rawLine: string): string</PaperCode></td>
                        <td>The line after its last carriage return.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>stripAnsi(input: string): string</PaperCode></td>
                        <td>The text with every ANSI escape sequence removed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>parseAnsiToSegments(input: string): AnsiSegment[]</PaperCode></td>
                        <td>Runs of text with their style. <PaperCode>AnsiSegment</PaperCode> is <PaperCode>{"{ text: string; style: JSX.CSSProperties }"}</PaperCode>. The style carries <PaperCode>color</PaperCode> and <PaperCode>background</PaperCode> as <PaperCode>rgb()</PaperCode> values, <PaperCode>font-weight: 700</PaperCode> for bold, <PaperCode>font-style: italic</PaperCode>, and <PaperCode>text-decoration: underline</PaperCode>. Empty segments are dropped.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="haptics">Haptics</PaperText>
            <PaperText preset="body" as="p">
                A haptic is a short vibration for a touch device.
                Components ask for one by kind when a switch flips, a slider crosses a step, or a press lifts: <PaperLink href="/docs/paperui/papertoggle/">PaperToggle</PaperLink>, <PaperLink href="/docs/paperui/papercheckbox/">PaperCheckbox</PaperLink>, <PaperLink href="/docs/paperui/paperrange/">PaperRange</PaperLink>, <PaperLink href="/docs/paperui/papercopybutton/">PaperCopyButton</PaperLink>, and <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink>.
                A panel that builds only from components already has them.
            </PaperText>
            <PaperText preset="body" as="p">
                Browsers refuse to vibrate inside a cross-origin frame, and every panel is one.
                So <PaperCode>haptic(kind)</PaperCode> in a panel does not vibrate itself.
                It dispatches a <PaperCode>paperui:haptic</PaperCode> event on <PaperCode>window</PaperCode>, <PaperCode>@mileniumhq/paperapi</PaperCode> forwards the kind to the Paperboard window, and the window plays it.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Signature</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>haptic</PaperCode></td>
                        <td><PaperCode>(kind: HapticKind) =&gt; void</PaperCode></td>
                        <td>Asks for a haptic. At the top of a document it plays; in a frame it reports the kind on <PaperCode>window</PaperCode>. It does nothing without a window.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>playHaptic</PaperCode></td>
                        <td><PaperCode>(kind: unknown) =&gt; boolean</PaperCode></td>
                        <td>Plays a kind on this document's device: through the player set with <PaperCode>setHapticPlayer</PaperCode> when there is one, else with <PaperCode>navigator.vibrate</PaperCode>. Returns whether a vibration started. A value that is not a known kind returns <PaperCode>false</PaperCode>. A new pattern replaces one still playing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setHapticPlayer</PaperCode></td>
                        <td><PaperCode>(next: HapticPlayer | null) =&gt; void</PaperCode></td>
                        <td>Sets a native host's own feedback, <PaperCode>HapticPlayer</PaperCode> being <PaperCode>(kind: HapticKind) =&gt; boolean</PaperCode>. Pass <PaperCode>null</PaperCode> to use the vibrator again. For app shells, not panels.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isHapticKind</PaperCode></td>
                        <td><PaperCode>(value: unknown) =&gt; value is HapticKind</PaperCode></td>
                        <td>Whether the value is a known kind.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>HAPTIC_EVENT</PaperCode></td>
                        <td><PaperCode>"paperui:haptic"</PaperCode></td>
                        <td>The event name. Its <PaperCode>detail</PaperCode> is <PaperCode>HapticDetail</PaperCode>, <PaperCode>{"{ kind: HapticKind }"}</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The kinds, with their vibration patterns in milliseconds (vibrate, pause, vibrate):
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Kind</th>
                        <th>Pattern</th>
                        <th>Feels like</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>selection</PaperCode></td><td>5</td><td>A value stepped.</td></tr>
                    <tr><td><PaperCode>light</PaperCode></td><td>10</td><td>A light tap.</td></tr>
                    <tr><td><PaperCode>medium</PaperCode></td><td>18</td><td>A firmer tap.</td></tr>
                    <tr><td><PaperCode>heavy</PaperCode></td><td>30</td><td>The strongest single tap.</td></tr>
                    <tr><td><PaperCode>success</PaperCode></td><td>12, 70, 20</td><td>Something finished.</td></tr>
                    <tr><td><PaperCode>warning</PaperCode></td><td>25, 90, 25</td><td>Something needs care.</td></tr>
                    <tr><td><PaperCode>error</PaperCode></td><td>35, 60, 35, 60, 35</td><td>Something failed.</td></tr>
                    <tr><td><PaperCode>paper</PaperCode></td><td>12, 45, 5</td><td>Paper pressed into its shadow, then springing back.</td></tr>
                    <tr><td><PaperCode>thud</PaperCode></td><td>24, 35, 10</td><td>A danger-colored press: heavier, with an echo.</td></tr>
                    <tr><td><PaperCode>lift</PaperCode></td><td>8, 30, 16</td><td>Something held lifts off the page.</td></tr>
                    <tr><td><PaperCode>land</PaperCode></td><td>16, 40, 6</td><td>Something carried is set down.</td></tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`import { haptic, PaperButton } from "@mileniumhq/paperui";

export function Done() {
    return <PaperButton onClick={() => haptic("success")}>Done</PaperButton>;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="swipe-back">Swipe back</PaperText>
            <PaperText preset="body" as="p">
                On a phone layout an open page goes back when it is dragged to the right, like the iOS back swipe.{" "}
                <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink> installs the touch handling and <PaperLink href="/docs/paperui/paperslidepage/">PaperSlidePage</PaperLink> uses the drag, so a panel built from PaperPanel and PaperMenu needs nothing from this section.
            </PaperText>
            <PaperTextList>
                <li>A finger can start the swipe anywhere on the page, unless what it touched has a sideways gesture of its own: a text field, a select, an editable element, a slider, a scrolled carousel, an element whose <PaperCode>touch-action</PaperCode> keeps horizontal panning for itself, a modal, or an element marked <PaperCode>data-paper-no-swipe-back</PaperCode>. Mark your own horizontally draggable element with that attribute.</li>
                <li>A page's top bar and a strip along its left edge are drag handles for any pointer.</li>
                <li>A page goes back when released past 35% of its width, or when released at 0.5 pixels per millisecond or faster.</li>
                <li>A document with no open page to go back from reports the swipe as <PaperCode>paperui:swipe-back</PaperCode> on <PaperCode>window</PaperCode>. <PaperCode>@mileniumhq/paperapi</PaperCode> forwards it to the Paperboard window, which drives the page that holds the panel.</li>
                <li>The system Back action of a host arrives as a cancelable <PaperCode>paperboard:back</PaperCode> event on <PaperCode>window</PaperCode>. The most recently opened page or modal closes first.</li>
            </PaperTextList>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Type</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>SWIPE_SLOP</PaperCode>, <PaperCode>SWIPE_DISTANCE</PaperCode>, <PaperCode>SWIPE_FLICK</PaperCode></td>
                        <td><PaperCode>8</PaperCode>, <PaperCode>0.35</PaperCode>, <PaperCode>0.5</PaperCode></td>
                        <td>Pixels of movement before a press counts as a drag, the share of the page width past which a release goes back, and the flick speed in pixels per millisecond.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>swipeGoesBack</PaperCode></td>
                        <td><PaperCode>(dx: number, velocity: number, width: number) =&gt; boolean</PaperCode></td>
                        <td>Whether a drag released at <PaperCode>dx</PaperCode> pixels and <PaperCode>velocity</PaperCode> goes back. False at or below <PaperCode>SWIPE_SLOP</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>createSwipeBack</PaperCode></td>
                        <td><PaperCode>(opts: {"{ width: () => number; onBack: () => void; el?: () => HTMLElement | undefined; active?: () => boolean }"}) =&gt; {"{ offset: () => number | null; onPointerDown: (e: PointerEvent) => void }"}</PaperCode></td>
                        <td>Drag-to-go-back for one page of your own. Spread <PaperCode>onPointerDown</PaperCode> on each drag handle and translate the page by <PaperCode>offset()</PaperCode> (null when not dragged). With <PaperCode>el</PaperCode> and <PaperCode>active</PaperCode> a touch anywhere on the page can swipe it. Call it inside a Solid owner: cleanup is registered on it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>installSwipeBack</PaperCode></td>
                        <td><PaperCode>() =&gt; () =&gt; void</PaperCode></td>
                        <td>Installs the document's touch listeners and returns the uninstall. PaperProvider calls it, and the listeners are shared and removed with the last caller.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>parseSwipeBack</PaperCode>, <PaperCode>swipeFromFrame</PaperCode></td>
                        <td><PaperCode>(data: unknown) =&gt; SwipeBackDetail | null</PaperCode>, <PaperCode>(frame: Element, data: unknown) =&gt; boolean</PaperCode></td>
                        <td>For a host shell: validate a swipe message from a panel frame, and drive the open page that holds the frame. Returns whether a page took it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>SWIPE_BACK_EVENT</PaperCode></td>
                        <td><PaperCode>"paperui:swipe-back"</PaperCode></td>
                        <td>The event name. Its <PaperCode>detail</PaperCode> is <PaperCode>SwipeBackDetail</PaperCode>: <PaperCode>{'{ phase: "move" | "end" | "cancel"; dx: number; velocity: number }'}</PaperCode>, with <PaperCode>dx</PaperCode> never negative.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="layout-context">Layout context</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink> tells its children which way it lays out.
                Build a component that takes the shared layout props with these.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>PaperLayoutProps</PaperCode></td>
                        <td>The prop interface PaperFlex, PaperCard, and PaperPage share: <PaperCode>flex</PaperCode>, <PaperCode>shrink</PaperCode>, <PaperCode>grow</PaperCode>, <PaperCode>minWidth</PaperCode>, <PaperCode>minHeight</PaperCode>, <PaperCode>maxWidth</PaperCode>, <PaperCode>maxHeight</PaperCode>, <PaperCode>width</PaperCode>, <PaperCode>height</PaperCode>, <PaperCode>fullWidth</PaperCode>, <PaperCode>fullHeight</PaperCode>, <PaperCode>scrollable</PaperCode>, <PaperCode>overflow</PaperCode>, <PaperCode>overflowX</PaperCode>, <PaperCode>overflowY</PaperCode>. Described in <PaperLink href="/docs/paperui/paperflex/#layout-props">PaperFlex</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperLayoutContext</PaperCode>, <PaperCode>usePaperLayout()</PaperCode></td>
                        <td>The context and its reader. The value is <PaperCode>PaperLayoutContextValue</PaperCode>: <PaperCode>{'{ direction?: "row" | "column" | "row-reverse" | "column-reverse"; parentIsFlex?: boolean }'}</PaperCode>. <PaperCode>usePaperLayout()</PaperCode> returns <PaperCode>undefined</PaperCode> outside a PaperFlex.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resolveLayoutStyles(props)</PaperCode></td>
                        <td>Turns layout props into a <PaperCode>JSX.CSSProperties</PaperCode> object, the way PaperFlex does. The same props give the same styles in any parent.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="panel-context">Panel context</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> provides the panel's state so the menu and interface group adapt to it.{" "}
                <PaperCode>usePaperPanel()</PaperCode> returns <PaperCode>PaperPanelContextValue</PaperCode>, or <PaperCode>undefined</PaperCode> outside a PaperPanel.
                A custom component reads it to follow the phone layout.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>inPanel</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td>Always <PaperCode>true</PaperCode> when the context exists.</td></tr>
                    <tr><td><PaperCode>compact</PaperCode></td><td><PaperCode>() =&gt; boolean</PaperCode></td><td>Whether the panel is in the phone layout.</td></tr>
                    <tr><td><PaperCode>pageOpen</PaperCode></td><td><PaperCode>() =&gt; boolean</PaperCode></td><td>Compact only: whether the interface page is showing over the menu.</td></tr>
                    <tr><td><PaperCode>openPage</PaperCode>, <PaperCode>closePage</PaperCode></td><td><PaperCode>() =&gt; void</PaperCode></td><td>Show or hide that page.</td></tr>
                    <tr><td><PaperCode>registerEntry</PaperCode></td><td><PaperCode>(value, entry: PaperPanelEntry) =&gt; () =&gt; void</PaperCode></td><td>A menu entry announces its title and icon for the page bar, and gets back a function that removes it. <PaperCode>PaperPanelEntry</PaperCode> is <PaperCode>{"{ title: () => string; icon?: string }"}</PaperCode>.</td></tr>
                    <tr><td><PaperCode>entry</PaperCode></td><td><PaperCode>(value) =&gt; PaperPanelEntry | undefined</PaperCode></td><td>The registered entry for a value.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Every field but <PaperCode>inPanel</PaperCode> is optional in the type, so call them with <PaperCode>?.</PaperCode>.
                The <PaperCode>value</PaperCode> argument of <PaperCode>registerEntry</PaperCode> and <PaperCode>entry</PaperCode> is a <PaperCode>string | number</PaperCode>, the menu entry's value.
            </PaperText>
            <PaperCode block language="tsx">
{`import { Show } from "solid-js";
import { PaperText, usePaperPanel } from "@mileniumhq/paperui";

export function PhoneHint() {
    const panel = usePaperPanel();

    return (
        <Show when={panel?.compact?.()}>
            <PaperText preset="hint">Tap an entry to open it.</PaperText>
        </Show>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="setting-list-context">Setting list context</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/papersettinglist/">PaperSettingList</PaperLink> provides its record to the controls inside it, which is how its <PaperCode>value</PaperCode> and <PaperCode>defaultValue</PaperCode> fill them.
                A custom control reads the record the same way.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>useSettingListValue(name)</PaperCode></td>
                        <td>Takes <PaperCode>{"() => string | undefined"}</PaperCode>, the control's name, and returns <PaperCode>{"() => unknown"}</PaperCode>: the record's value for that name. It is <PaperCode>undefined</PaperCode> outside a list, without a name, and when the record has no value (or <PaperCode>null</PaperCode>) for it. Check the type yourself.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperSettingListContext</PaperCode></td>
                        <td>The context itself. Its value is <PaperCode>PaperSettingListContextValue</PaperCode>: <PaperCode>{"{ valueOf: (name: string) => unknown }"}</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The list hears a change through the bubbling <PaperCode>input</PaperCode> and <PaperCode>change</PaperCode> events of a named native control. Give your control one, as PaperToggle gives its hidden checkbox, and dispatch those events when it changes.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, useSettingListValue } from "@mileniumhq/paperui";

export function Level(props: { name: string }) {
    const level = useSettingListValue(() => props.name);
    let input: HTMLInputElement | undefined;

    const raise = () => {
        if (!input) return;
        input.value = String(Number(level() ?? 0) + 1);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    return (
        <>
            <input ref={input} type="hidden" name={props.name} value={String(level() ?? 0)} />
            <PaperButton onClick={raise}>Level {String(level() ?? 0)}</PaperButton>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="token-lists">Token lists and types</PaperText>
            <PaperText preset="body" as="p">
                The package also exports the arrays behind its prop types, so code can iterate them or check a value, and the types derived from them.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Array</th>
                        <th>Type</th>
                        <th>Documented on</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>spacingSizes</PaperCode></td><td><PaperCode>PaperSpacingSize</PaperCode> (and <PaperCode>PaperSpacing</PaperCode>, which also allows any string or a number)</td><td><PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink></td></tr>
                    <tr><td><PaperCode>paperSizes</PaperCode></td><td><PaperCode>PaperSize</PaperCode></td><td><PaperLink href="/docs/paperui/spacing/#sizes">Spacing and layout</PaperLink></td></tr>
                    <tr><td><PaperCode>paperRoles</PaperCode></td><td><PaperCode>PaperRole</PaperCode></td><td><PaperLink href="/docs/paperui/colors/">Colors</PaperLink></td></tr>
                    <tr><td><PaperCode>backgroundSurfaces</PaperCode>, <PaperCode>borderColors</PaperCode></td><td><PaperCode>PaperBackgroundSurface</PaperCode>, <PaperCode>PaperBorderColor</PaperCode></td><td><PaperLink href="/docs/paperui/surfaces/">Surfaces and borders</PaperLink></td></tr>
                    <tr><td><PaperCode>textColors</PaperCode>, <PaperCode>paperColors</PaperCode></td><td><PaperCode>PaperTextColor</PaperCode>, <PaperCode>PaperColor</PaperCode> (every token name, or any string)</td><td><PaperLink href="/docs/paperui/colors/">Colors</PaperLink></td></tr>
                    <tr><td><PaperCode>textSizes</PaperCode>, <PaperCode>textPresets</PaperCode></td><td><PaperCode>PaperTextSize</PaperCode>, <PaperCode>PaperTextPreset</PaperCode></td><td><PaperLink href="/docs/paperui/typography/">Typography</PaperLink></td></tr>
                    <tr><td><PaperCode>buttonVariants</PaperCode>, <PaperCode>badgeVariants</PaperCode></td><td><PaperCode>PaperButtonVariant</PaperCode>, <PaperCode>PaperBadgeVariant</PaperCode></td><td><PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink>, <PaperLink href="/docs/paperui/paperbadge/">PaperBadge</PaperLink></td></tr>
                    <tr><td><PaperCode>loaderStatuses</PaperCode>, <PaperCode>selectorStyles</PaperCode></td><td><PaperCode>LoaderStatus</PaperCode>, <PaperCode>SelectorStyle</PaperCode></td><td><PaperLink href="/docs/paperui/paperloader/">PaperLoader</PaperLink>, <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink></td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
