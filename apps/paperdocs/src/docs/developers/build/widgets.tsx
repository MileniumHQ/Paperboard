import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const MANIFEST_WIDGETS = `"widgets": [
    {
        "id": "forecast",
        "name": "Forecast",
        "description": "The temperature in one city you follow",
        "sizes": [
            "2x1"
        ],
        "options": [
            {
                "id": "city",
                "label": "City"
            }
        ]
    }
]`;

const VITE_CONFIG = `import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    resolve: {
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
    build: {
        rollupOptions: {
            // the panel page and the Home widget page, built side by side
            input: { index: "index.html", widget: "widget.html" },
        },
    },
});`;

const WIDGET_HTML = `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Weather widget</title>
    </head>
    <body>
        <script type="module" src="/src/widget.tsx"></script>
    </body>
</html>`;

const WIDGET_CSS = `/* The tile is PaperWidget's; this only gives it a positioned, painted page. */
html,
body {
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--paper-surface-raised);
}`;

const WIDGET_TSX = `// The Forecast widget: one followed city's temperature on Home.
import { render } from "solid-js/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { PaperButton, PaperProvider, PaperWidget, PaperWidgetMessage, PaperWidgetStat } from "@mileniumhq/paperui";
import { createPanelBridge, defineWidgets, type WidgetContext } from "@mileniumhq/paperapi";
import "@mileniumhq/paperui/style.css";
import "./widget.css";
import { DEFAULT_STATE, PANEL_ID, type WeatherState } from "./panel";

function Forecast(props: { widget: WidgetContext }) {
    const city = props.widget.options.city;
    const bridge = createPanelBridge<WeatherState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });
    const [state, setState] = createSignal<WeatherState | null>(null);
    const [failure, setFailure] = createSignal("");

    const off = bridge.onStateChange((_patch, full) => setState({ ...full }));
    onCleanup(() => {
        off();
        bridge.dispose();
    });

    const load = async () => {
        setFailure("");
        try {
            setState({ ...(await bridge.refreshState()) });
        } catch (err) {
            setFailure(err instanceof Error ? err.message : String(err));
        }
    };
    void load();

    const unit = () => (state()?.settings.units === "imperial" ? "°F" : "°C");

    return (
        <PaperWidget title={city ?? "Forecast"} icon="partly_cloudy_day" onPress={() => props.widget.openPanel()} pressLabel="Open Weather">
            <Show
                when={!failure()}
                fallback={
                    <PaperWidgetMessage title="Weather is not answering" tone="danger" description={failure()} hint={failure()}>
                        <PaperButton size="tiny" onClick={() => void load()}>
                            Retry
                        </PaperButton>
                    </PaperWidgetMessage>
                }
            >
                <Show when={state()} fallback={<PaperWidgetMessage title="Loading" />}>
                    {(current) => (
                        <Show
                            when={city && current().settings.cities.includes(city)}
                            fallback={
                                <PaperWidgetMessage
                                    title="City not followed"
                                    tone="danger"
                                    description="Follow it in Weather, or place the widget again."
                                    hint="Follow it in Weather, or place the widget again."
                                />
                            }
                        >
                            <Show
                                when={current().forecasts[city!]}
                                fallback={
                                    <PaperWidgetMessage
                                        title="No reading yet"
                                        tone="danger"
                                        description={current().failures[city!]}
                                        hint={current().failures[city!]}
                                    />
                                }
                            >
                                {(forecast) => (
                                    <PaperWidgetStat value={\`\${Math.round(forecast().temperature)}\${unit()}\`} caption={forecast().summary} />
                                )}
                            </Show>
                        </Show>
                    )}
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
});`;

const WIDGET_CHOICES = `widgetChoices: {
    forecast: {
        city: (ctx: Ctx) => ctx.state.settings.cities.map((city) => ({ value: city, label: city })),
    },
},`;

export default function WidgetsGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Add a Home widget</PaperText>
            <PaperText preset="body" as="p">
                A widget is a small live tile from a panel that a person places on Paperboard's Home.
                This guide adds the Weather example panel's Forecast widget, which shows the temperature in one followed city.
                At the end, the widget is in Home's gallery, asks which city to show, and says what is wrong when it can't show a reading.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel with a service, as in <PaperLink href="/docs/developers/services/">Services and state</PaperLink>. A widget reads the service's state, so a panel without a service has nothing live to show.
                Panels made with <PaperCode>npm create @mileniumhq/panel</PaperCode> already have a widget page, <PaperCode>widget.html</PaperCode> and <PaperCode>src/widget.tsx</PaperCode>; this guide replaces its widget with Weather's.
                The rules for every field are in the <PaperLink href="/docs/paperapi/widgets/">widgets reference</PaperLink>, and the tile's components in <PaperLink href="/docs/paperui/paperwidget/">PaperWidget</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="what-to-show">Pick one fact</PaperText>
            <PaperText preset="body" as="p">
                A widget answers one question at a glance: how warm is it in Oslo, is the server up, how many players are on.
                Everything else stays in the panel, one press away. Weather's widget shows one city's temperature and its summary, and opens Weather when pressed.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="declare">Declare it in the manifest</PaperText>
            <PaperText preset="body" as="p">
                Add the widget to <PaperCode>widgets</PaperCode> in <PaperCode>manifest.json</PaperCode>:
            </PaperText>
            <PaperCode block language="json">{MANIFEST_WIDGETS}</PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>What to write</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>id</PaperCode></td><td>Lowercase, the key of its mount function in <PaperCode>defineWidgets</PaperCode>. Placed widgets refer to it, so never rename one that has shipped.</td></tr>
                    <tr><td><PaperCode>name</PaperCode>, <PaperCode>description</PaperCode></td><td>What the gallery shows. The description says what the tile shows, not how.</td></tr>
                    <tr><td><PaperCode>sizes</PaperCode></td><td>The sizes in grid cells a person can pick, smallest that fits first. Weather offers <PaperCode>2x1</PaperCode> only: a <PaperCode>1x1</PaperCode> tile has no room for the reason a reading is missing.</td></tr>
                    <tr><td><PaperCode>options</PaperCode></td><td>What the person picks before placing it, at most 2. Each becomes a dropdown in the gallery.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A broken declaration makes Paperboard refuse the whole manifest, and the panel disappears from the list. Run <PaperCode>bunx paperapi doctor</PaperCode> after every change to it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="build-the-page">Build the widget page</PaperText>
            <PaperText preset="body" as="p">
                Every widget of a panel is drawn by one page, <PaperCode>dist/widget.html</PaperCode>. The scaffold builds it next to the panel page with a second Vite input:
            </PaperText>
            <PaperCode block language="tsx">{VITE_CONFIG}</PaperCode>
            <PaperCode block language="html">{WIDGET_HTML}</PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>src/widget.css</PaperCode> gives the page its height and the tile's background, and nothing else:
            </PaperText>
            <PaperCode block language="css">{WIDGET_CSS}</PaperCode>

            <PaperText preset="subheader" as="h2" id="draw-it">Draw the tile</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>defineWidgets</PaperCode> maps each widget id to a function that mounts it. Weather's <PaperCode>src/widget.tsx</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">{WIDGET_TSX}</PaperCode>
            <PaperTextList>
                <li>The tile is a <PaperCode>PaperWidget</PaperCode> with a title and icon. <PaperCode>onPress</PaperCode> makes the whole tile a button, here to open the panel.</li>
                <li>A widget is its own page, with no access to the panel page's signals. It makes its own bridge, reads the state once with <PaperCode>refreshState</PaperCode>, and follows it with <PaperCode>onStateChange</PaperCode>.</li>
                <li><PaperCode>onCleanup</PaperCode> disposes the bridge when Home removes the tile. Every placed copy of the widget makes a bridge, and a page that keeps too many open fails with <PaperCode>Too many panel bridges; dispose unused bridges</PaperCode>.</li>
                <li><PaperCode>widget.options.city</PaperCode> is what the person picked in the gallery. It is fixed for the tile's life: picking another city means placing the widget again.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="failures">Every state says what it is</PaperText>
            <PaperText preset="body" as="p">
                A tile that is blank, or shows a number it doesn't have, tells the person nothing. Weather's tile has one message for each way it can't show a reading:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>State</th>
                        <th>The tile shows</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>The state has not arrived yet</td><td><PaperCode>Loading</PaperCode></td></tr>
                    <tr><td>The service can't be reached</td><td><PaperCode>Weather is not answering</PaperCode>, the reason, and a Retry button</td></tr>
                    <tr><td>The person stopped following the city</td><td><PaperCode>City not followed</PaperCode>, and what to do</td></tr>
                    <tr><td>The last check failed</td><td><PaperCode>No reading yet</PaperCode>, and the reason from <PaperCode>failures</PaperCode>, such as an invalid API key</td></tr>
                    <tr><td>A reading</td><td>The temperature with <PaperCode>PaperWidgetStat</PaperCode>, and the summary below it</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>PaperWidgetMessage</PaperCode> takes the reason twice: <PaperCode>description</PaperCode> shows it in the tile, cut to fit, and <PaperCode>hint</PaperCode> shows all of it as a tooltip.
                <PaperCode>tone="danger"</PaperCode> marks a failure and makes a screen reader read it out.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="options">Fill the options</PaperText>
            <PaperText preset="body" as="p">
                The gallery asks the service what each option can be. <PaperCode>widgetChoices</PaperCode> in <PaperCode>definePanelService</PaperCode> answers, by widget id and option id:
            </PaperText>
            <PaperCode block language="tsx">{WIDGET_CHOICES}</PaperCode>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather command.widget-choices '{"widget":"forecast","option":"city"}'
✓ dev.example.weather command.widget-choices · 0.6 ms
[
  {
    "value": "Oslo",
    "label": "Oslo"
  }
]`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The value is what the widget receives in <PaperCode>options</PaperCode>, and the label is what the dropdown shows.
                The rules for the answer are under <PaperLink href="/docs/paperapi/widgets/#widget-choices">Widget choices</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="check-it">Check it</PaperText>
            <PaperTextList ordered>
                <li>Run <PaperCode>bun run build</PaperCode> and <PaperCode>bunx paperapi doctor</PaperCode>. The Build line lists <PaperCode>dist/widget.html</PaperCode>.</li>
                <li>In Paperboard, right-click the panel in the list and choose Restart Panel, so it reads the new manifest.</li>
                <li>On Home, press Edit Home. The Add widgets gallery lists Weather, with Forecast under it.</li>
                <li>Open it, pick a city and a size, and drag the preview onto Home or press it to add it. Press Done.</li>
                <li>Place the widget for a city whose check failed. The tile says <PaperCode>No reading yet</PaperCode> and the reason.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A widget page that fails to load shows its reason on Home with a Reload widget button.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/testing/">test the panel</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
