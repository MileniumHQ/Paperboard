import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function WidgetsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">defineWidgets</PaperText>
            <PaperText preset="body" as="p">
                defineWidgets mounts a panel's Home widgets from its widget page, dist/widget.html, one placed widget per frame.
                The manifest declares each widget's id, name and sizes, and the service can supply the choices made when someone places it.
                Reach for a widget to show one live fact or one action of the panel without opening it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Declare the widget in <PaperCode>manifest.json</PaperCode>:
            </PaperText>
            <PaperCode block language="json">
{`{
    "id": "dev.example.weather",
    "name": "Weather",
    "version": "1.0.0",
    "service": "./dist/service.js",
    "widgets": [
        {
            "id": "forecast",
            "name": "Forecast",
            "description": "Today's high and low for one city",
            "sizes": ["2x1", "2x2"],
            "options": [{ "id": "city", "label": "City" }]
        }
    ]
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Build a second page, <PaperCode>widget.html</PaperCode>, next to <PaperCode>index.html</PaperCode>. With Vite, add both to <PaperCode>build.rollupOptions.input</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">
{`import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    build: {
        rollupOptions: {
            input: { index: "index.html", widget: "widget.html" },
        },
    },
});`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The widget page's script calls <PaperCode>defineWidgets</PaperCode> with one mount function per declared widget id. This one reads the service's state through a <PaperLink href="/docs/paperapi/bridge/">panel bridge</PaperLink> and draws it with <PaperLink href="/docs/paperui/paperwidget/">PaperWidget</PaperLink>:
            </PaperText>
            <PaperCode block language="tsx">
{`import { render } from "solid-js/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { PaperProvider, PaperWidget, PaperWidgetStat } from "@mileniumhq/paperui";
import { createPanelBridge, defineWidgets, type WidgetContext } from "@mileniumhq/paperapi";
import "@mileniumhq/paperui/style.css";

const PANEL_ID = "dev.example.weather";

interface WeatherState {
    forecasts: Record<string, { high: number; low: number }>;
}

function Forecast(props: { widget: WidgetContext }) {
    const city = props.widget.options.city;
    const bridge = createPanelBridge<WeatherState>({ panelId: PANEL_ID, defaultState: { forecasts: {} } });
    const [state, setState] = createSignal(bridge.getState());
    const [error, setError] = createSignal("");
    const off = bridge.onStateChange((_patch, full) => setState({ ...full }));
    bridge.refreshState().then(
        (full) => setState({ ...full }),
        (err) => setError(err instanceof Error ? err.message : String(err)),
    );
    onCleanup(() => {
        off();
        bridge.dispose();
    });

    const forecast = () => (city ? state().forecasts[city] : undefined);

    return (
        <PaperWidget title="Forecast" icon="partly_cloudy_day">
            <Show when={!error()} fallback={<PaperWidgetStat value="Unavailable" caption={error()} tone="danger" role="alert" />}>
                <Show when={forecast()} fallback={<PaperWidgetStat value="No forecast" caption={\`\${city} is no longer in the panel\`} tone="warning" />}>
                    {(today) => <PaperWidgetStat value={\`\${today().high}°\`} caption={\`\${city}, low \${today().low}°\`} />}
                </Show>
            </Show>
        </PaperWidget>
    );
}

defineWidgets({
    forecast: (root, widget) =>
        render(
            () => (
                <PaperProvider fullWidth fullHeight>
                    <Forecast widget={widget} />
                </PaperProvider>
            ),
            root,
        ),
});`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The service supplies the City dropdown that Home's widget gallery shows:
            </PaperText>
            <PaperCode block language="tsx">
{`import { definePanelService } from "@mileniumhq/paperapi";

definePanelService({
    id: "dev.example.weather",
    state: { cities: ["Oslo", "Lima"], forecasts: {} as Record<string, { high: number; low: number }> },
    widgetChoices: {
        forecast: {
            city: (ctx) => ctx.state.cities.map((city) => ({ value: city, label: city })),
        },
    },
});`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="declaration">Manifest declaration</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Rule and effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>widgets</PaperCode></td>
                        <td><PaperCode>WidgetDeclaration[]</PaperCode></td>
                        <td>No default (no widgets)</td>
                        <td>At most 8 per panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>Lowercase letters, digits and <PaperCode>-</PaperCode>, starting with a letter or digit, up to 32 characters. Unique in the panel. The key of its mount function.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>At most 64 characters, not blank. Shown in Home's widget gallery.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>At most 256 characters. Shown in the gallery under the name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>sizes</PaperCode></td>
                        <td><PaperCode>string[]</PaperCode></td>
                        <td>Required</td>
                        <td>1 to 4 sizes in grid cells, written <PaperCode>"WxH"</PaperCode> from <PaperCode>"1x1"</PaperCode> to <PaperCode>"4x4"</PaperCode>, each once. The first is the size a new placement gets.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>options</PaperCode></td>
                        <td><PaperCode>WidgetOptionDeclaration[]</PaperCode></td>
                        <td>No default (nothing to choose)</td>
                        <td>At most 2. Each is <PaperCode>{"{ id, label }"}</PaperCode>: an id with the widget id rule, unique in the widget, and a label of at most 64 characters, not blank. The gallery shows one dropdown per option before the widget is placed.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The daemon and <PaperCode>paperapi pack</PaperCode> check the same rules. A broken declaration makes the daemon refuse the whole manifest with <PaperCode>Invalid widgets in manifest for &lt;id&gt;: &lt;reason&gt;</PaperCode>, such as <PaperCode>{"widget \"forecast\" size \"5x1\" must look like \"2x1\", at most 4x4"}</PaperCode>.
                The packer also refuses widgets when <PaperCode>dist/widget.html</PaperCode> does not exist.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperText preset="body" as="p">
                Context: widget page. Call <PaperCode>defineWidgets</PaperCode> once, at the top level of the widget page's script.
            </PaperText>
            <PaperCode block language="tsx">
{`function defineWidgets(widgets: Record<string, WidgetMount>): void;

type WidgetMount = (root: HTMLElement, widget: WidgetContext) => (() => void) | void;

interface WidgetContext {
    readonly panelId: string;
    /** which declared widget this frame shows */
    readonly widgetId: string;
    /** this placement on Home; two copies of one widget get two ids */
    readonly instanceId: string;
    /** what was chosen in the gallery, by option id; fixed for the frame's life */
    readonly options: Readonly<Record<string, string>>;
    /** current size in grid cells, one of the declared sizes */
    size(): { w: number; h: number };
    /** false while Home is hidden or the widget is scrolled away */
    visible(): boolean;
    onResize(callback: (size: { w: number; h: number }) => void): () => void;
    onVisibilityChange(callback: (visible: boolean) => void): () => void;
    /** asks the shell to open this widget's panel */
    openPanel(): void;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>root</PaperCode></td>
                        <td>A <PaperCode>div</PaperCode> PaperAPI appends to <PaperCode>body</PaperCode>, fixed to fill the frame with overflow hidden. Render into it.</td>
                    </tr>
                    <tr>
                        <td>The mount's return value</td>
                        <td>A cleanup function, called when the page unloads. Solid's <PaperCode>render</PaperCode> returns one.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>options</PaperCode></td>
                        <td>The <PaperCode>value</PaperCode> of each choice made in the gallery. An option nothing was chosen for is absent. A chosen value can stop existing later, such as a deleted city, so handle a value the panel no longer knows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onResize</PaperCode>, <PaperCode>onVisibilityChange</PaperCode></td>
                        <td>Called only when the value changes. Each returns an unsubscribe function. At most 64 listeners of each kind; the next throws <PaperCode>Too many widget listeners; unsubscribe unused ones</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>visible</PaperCode></td>
                        <td>Pause timers and polling while it is false.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="widget-choices">Choices from the service</PaperText>
            <PaperText preset="body" as="p">
                Context: service. <PaperCode>definePanelService</PaperCode>'s <PaperCode>widgetChoices</PaperCode> maps a widget id, then an option id, to a function returning the dropdown's entries. Home asks for them each time the gallery shows the widget, and waits at most 10 seconds.
            </PaperText>
            <PaperCode block language="tsx">
{`interface WidgetChoice {
    /** what the widget gets in options; 1 to 128 characters, unique in the list */
    value: string;
    /** what the dropdown shows; at most 64 characters, not blank */
    label: string;
}

widgetChoices?: Record<string, Record<string, (ctx: ServiceContext<TState>) => WidgetChoice[] | Promise<WidgetChoice[]>>>;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A list holds at most 64 choices. The service checks its answer before it leaves and Home checks it again, so a broken list fails with its reason, such as <PaperCode>{"widget choice \"Oslo\" is offered twice"}</PaperCode>.
                A widget or option the service has no function for fails with <PaperCode>{"This panel's service offers no choices for widget \"<widget>\" option \"<option>\""}</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Home loads <PaperCode>widget.html</PaperCode> from the panel's origin, which serves <PaperCode>dist/widget.html</PaperCode>. Every widget of the panel shares that page, and each frame mounts the one widget the shell names.</li>
                <li>A widget frame goes through the same start-up check as the panel page, plus the mount: the shell keeps it covered until the service answers, the widget is mounted, bridges are hydrated and it has painted. See <PaperLink href="/docs/paperapi/connection/#readiness">Readiness</PaperLink>.</li>
                <li>The widget page holds the same credential as the panel page and can call every API, except the windows the shell opens for a panel page: <PaperCode>fileApi.exportFile</PaperCode> and the imports, and <PaperCode>backupApi.chooseLocation</PaperCode>. Call <PaperCode>openPanel()</PaperCode> for those.</li>
                <li>A back swipe in a widget stays in the widget.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>When</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>defineWidgets can only be called once per page</PaperCode></td><td>A second call.</td></tr>
                    <tr><td><PaperCode>{"\"<key>\" is not a widget id; use lowercase letters, digits and dashes"}</PaperCode></td><td>A key breaks the widget id rule.</td></tr>
                    <tr><td><PaperCode>{"widget \"<id>\" must be a mount function"}</PaperCode></td><td>A value is not a function.</td></tr>
                    <tr><td><PaperCode>{"This panel's widget page does not define \"<id>\""}</PaperCode></td><td>The shell asked for a widget the page has no mount function for. The frame shows this as its failure.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The limits are exported: <PaperCode>MAX_WIDGETS_PER_PANEL</PaperCode>, <PaperCode>MAX_SIZES_PER_WIDGET</PaperCode>, <PaperCode>MAX_OPTIONS_PER_WIDGET</PaperCode>, <PaperCode>WIDGET_MAX_WIDTH</PaperCode>, <PaperCode>WIDGET_MAX_HEIGHT</PaperCode>, <PaperCode>MAX_WIDGET_CHOICES</PaperCode>, with <PaperCode>validateWidgetDeclarations</PaperCode> and <PaperCode>parseWidgetChoices</PaperCode>.
                Next: <PaperLink href="/docs/paperapi/bridge/">createPanelBridge</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
