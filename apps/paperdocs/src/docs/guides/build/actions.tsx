import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const FORECAST_ACTION = `defineAction({
    id: "forecast",
    name: "Get forecast",
    category: "Weather",
    description: "Checks the current weather in a city and returns its temperature, high, low and summary",
    template: "Get the forecast for {city}",
    icon: "partly_cloudy_day",
    inputs: {
        city: { type: "string", label: "City", placeholder: "City", required: true, maxLength: 64 },
    },
    output: "object",
    outputFields: { temperature: "number", high: "number", low: "number", summary: "string" },
    run: async (ctx: Ctx, inputs: { city?: string }) => fetchForecast(cityName(inputs.city), ctx.state.settings.units),
}),`;

const FREEZING_ACTION = `defineAction({
    id: "freezing",
    name: "Freezing",
    category: "Weather",
    description: "Fires when a followed city drops to 0 °C (32 °F) or below",
    template: "When {city} is freezing",
    icon: "ac_unit",
    inputs: {
        city: { type: "string", label: "City", placeholder: "City", allowEmpty: true, emptyLabel: "Any city" },
    },
    output: "object",
    outputFields: { city: "string", temperature: "number" },
    match: { field: "city", input: "city" },
}),`;

const DROPS_TO_FREEZING = `/** True when a city drops to freezing, 0 °C or 32 °F, on this reading and was above it on the last one. */
export function dropsToFreezing(before: Forecast | undefined, after: Forecast, units: Units): boolean {
    const limit = units === "metric" ? 0 : 32;
    return after.temperature <= limit && (before === undefined || before.temperature > limit);
}`;

const REFRESH_CITY = `async function refreshCity(ctx: Ctx, city: string): Promise<void> {
    try {
        const forecast = await fetchForecast(city, ctx.state.settings.units);
        const before = ctx.state.forecasts[city];
        const { [city]: _cleared, ...failures } = ctx.state.failures;
        ctx.setState((prev) => ({ forecasts: { ...prev.forecasts, [city]: forecast }, failures }));
        // once when the city drops to freezing, not on every check while it stays there
        if (dropsToFreezing(before, forecast, ctx.state.settings.units)) {
            ctx.emitTrigger("freezing", { city, temperature: forecast.temperature });
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(\`[weather] \${city} not refreshed:\`, message);
        ctx.setState((prev) => ({ failures: { ...prev.failures, [city]: message } }));
    }
}`;

const CATEGORIES = `export default definePanelService({
    id: PANEL_ID,
    state: DEFAULT_STATE,
    categories: [{ name: "Weather", icon: "partly_cloudy_day", order: 1 }],
    actions,
    // widgetChoices and onInit follow
});`;

const CALLER = `import { actionsApi } from "@mileniumhq/paperapi";

interface ForecastResult {
    temperature: number;
    high: number;
    low: number;
    summary: string;
}

export async function osloTemperature(): Promise<number> {
    const forecast = await actionsApi.call<ForecastResult>("dev.example.weather", "forecast", { city: "Oslo" });
    return forecast.temperature;
}

export function watchFreezing(onFreezing: (city: string) => void): () => void {
    return actionsApi.onTrigger<{ city: string; temperature: number }>("dev.example.weather", "freezing", (output) => onFreezing(output.city));
}`;

export default function ActionsGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Expose actions</PaperText>
            <PaperText preset="body" as="p">
                An action is something a panel does on request: for its own pages, for flows in the Actions panel, for agents, and for other panels.
                This guide adds the Weather example panel's actions, one trigger that starts flows when a city freezes, and the internal actions its pages call.
                At the end, a person can build a flow on Weather without opening its code.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel with a service, as in <PaperLink href="/docs/guides/services/">Services and state</PaperLink>.
                Every field is in the <PaperLink href="/docs/paperapi/actions/">actionsApi</PaperLink> reference.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="who-sees-what">Who sees an action</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Kind</th>
                        <th>Seen by</th>
                        <th>Weather's</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Public</td><td>The Actions panel's library as a block, the Agents panel as a tool, and any panel that calls it</td><td><PaperCode>forecast</PaperCode>, <PaperCode>follow-city</PaperCode>, <PaperCode>unfollow-city</PaperCode></td></tr>
                    <tr><td>Event</td><td>The Actions panel, as a block that starts a flow</td><td><PaperCode>freezing</PaperCode></td></tr>
                    <tr><td>Internal (<PaperCode>internal: true</PaperCode>)</td><td>Only the panel's own pages and service. Other panels are refused</td><td><PaperCode>set-units</PaperCode>, <PaperCode>key-changed</PaperCode></td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Make an action public when a person would want it in a flow or would ask an agent for it. Everything the page needs only for itself is internal.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="public">A public action</PaperText>
            <PaperCode block language="tsx">{FORECAST_ACTION}</PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>What to write</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>id</PaperCode></td><td>Lowercase words with dashes. Callers and saved flows use it, so never rename one that has shipped.</td></tr>
                    <tr><td><PaperCode>name</PaperCode></td><td>A verb and its object, in sentence case: <PaperCode>Get forecast</PaperCode>, <PaperCode>Follow city</PaperCode>.</td></tr>
                    <tr><td><PaperCode>description</PaperCode></td><td>What it does and what it returns, in one sentence. An agent decides from this whether to call it.</td></tr>
                    <tr><td><PaperCode>template</PaperCode></td><td>The sentence the block shows, with each input in braces: <PaperCode>{"Get the forecast for {city}"}</PaperCode>.</td></tr>
                    <tr><td><PaperCode>category</PaperCode>, <PaperCode>icon</PaperCode></td><td>The library section the block sits in, named after the panel, and a Material Symbols name for the action. The block itself shows the panel's icon, so give the panel one; see <PaperLink href="/docs/guides/packaging/#icon">Package a panel</PaperLink>.</td></tr>
                    <tr><td><PaperCode>output</PaperCode>, <PaperCode>outputFields</PaperCode></td><td>What <PaperCode>run</PaperCode> returns. Each field of an object output becomes a variable the next blocks of a flow can use.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="inputs">Inputs</PaperText>
            <PaperTextList>
                <li><PaperCode>label</PaperCode> names the field: <PaperCode>City</PaperCode>.</li>
                <li><PaperCode>placeholder</PaperCode> names the kind of value, never an example: <PaperCode>City</PaperCode>, <PaperCode>Text</PaperCode>, <PaperCode>Channel ID</PaperCode>. Not <PaperCode>Oslo</PaperCode> or <PaperCode>1234567890</PaperCode>.</li>
                <li>Set a limit on every input: <PaperCode>maxLength</PaperCode> on text, <PaperCode>min</PaperCode>, <PaperCode>max</PaperCode> and <PaperCode>integer</PaperCode> on numbers, <PaperCode>maxItems</PaperCode> on lists. The flow editor marks a broken limit before the flow runs, and the SDK refuses the call before <PaperCode>run</PaperCode> starts.</li>
                <li><PaperCode>required</PaperCode> is for the flow editor only. The call still reaches <PaperCode>run</PaperCode> with the input empty, so check it there, as <PaperCode>cityName</PaperCode> does.</li>
                <li>Never take a key, token or password as an input. Read it from <PaperLink href="/docs/guides/settings-and-secrets/">secretsApi</PaperLink> in the service.</li>
            </PaperTextList>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather follow-city '{"city":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'
✗ dev.example.weather follow-city failed: "City" holds at most 64 characters (it has 70)`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="triggers">A trigger</PaperText>
            <PaperText preset="body" as="p">
                An event action has no <PaperCode>run</PaperCode>. It describes something that happens, and a flow built on it starts each time the panel fires it.
                Weather's fires when a followed city drops to 0 °C (32 °F) or below:
            </PaperText>
            <PaperCode block language="tsx">{FREEZING_ACTION}</PaperCode>
            <PaperText preset="body" as="p">
                The service fires it by its id with <PaperCode>ctx.emitTrigger</PaperCode>, where it learns the temperature.
                <PaperCode>dropsToFreezing</PaperCode> in <PaperCode>src/lib/openWeather.ts</PaperCode> compares the new reading with the last one:
            </PaperText>
            <PaperCode block language="tsx">{DROPS_TO_FREEZING}</PaperCode>
            <PaperCode block language="tsx">{REFRESH_CITY}</PaperCode>
            <PaperTextList>
                <li><PaperCode>match</PaperCode> lets each flow pick which firings start it. The block reads <PaperCode>When (any) is freezing</PaperCode>, with a City field. A flow set to Oslo starts only when the payload's <PaperCode>city</PaperCode> is <PaperCode>Oslo</PaperCode>. A flow that leaves it empty starts for every city.</li>
                <li>The payload is the action's output. Declare its fields in <PaperCode>outputFields</PaperCode>, so the flow can use them.</li>
                <li>Fire a trigger once per change, not on every check. A city that stays frozen for a day fires it once, not every 15 minutes, so a flow that sends a message sends one.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="internal">Internal actions</PaperText>
            <PaperText preset="body" as="p">
                The page asks the service to do things through internal actions, such as <PaperCode>set-units</PaperCode> in <PaperLink href="/docs/guides/settings-and-secrets/#settings">Settings and secrets</PaperLink>.
                They need no <PaperCode>template</PaperCode>, <PaperCode>category</PaperCode> or <PaperCode>icon</PaperCode>, since no library shows them. Check their inputs all the same: <PaperCode>paperapi call</PaperCode> reaches them, and a bug in the page can send anything.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="categories">The panel's category</PaperText>
            <PaperText preset="body" as="p">
                List the panel's category once in <PaperCode>definePanelService</PaperCode>, with its icon, and name it in each action:
            </PaperText>
            <PaperCode block language="tsx">{CATEGORIES}</PaperCode>

            <PaperText preset="subheader" as="h2" id="call-other-panels">Call another panel</PaperText>
            <PaperText preset="body" as="p">
                Any panel calls another panel's public actions with <PaperCode>actionsApi.call</PaperCode>, and listens to its triggers with <PaperCode>actionsApi.onTrigger</PaperCode>.
                A panel that uses Weather would write:
            </PaperText>
            <PaperCode block language="tsx">{CALLER}</PaperCode>
            <PaperTextList>
                <li>The call rejects with the action's own message, such as <PaperCode>Enter a city name</PaperCode>. Show it like any other failure.</li>
                <li>A call waits 30 seconds by default. Pass <PaperCode>{"{ timeoutMs: null }"}</PaperCode> as the fourth argument for an action that takes longer.</li>
                <li>The panel you call may not be installed. The call then fails with <PaperCode>Action "forecast" on panel "dev.example.weather" is not registered or unavailable</PaperCode>; tell the person which panel to install.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="check-it">Check it</PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather
7 actions on dev.example.weather:
__getState       Get Panel State (internal)
__widgetChoices  Get Widget Choices (internal)
follow-city      Follow city  (city: string)
forecast         Get forecast  (city: string)
key-changed      API key changed (internal)
set-units        Set units (internal)
unfollow-city    Unfollow city  (city: string)`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The list shows the actions that can be called, so the event action is not in it. <PaperCode>__getState</PaperCode> and <PaperCode>__widgetChoices</PaperCode> are added by <PaperCode>definePanelService</PaperCode>.
                Then open the Actions panel, open or make a project, and pick Weather at the bottom of the library's rail.
                Weather's four blocks read <PaperCode>When (any) is freezing</PaperCode>, <PaperCode>Get the forecast for City</PaperCode>, <PaperCode>Follow the weather in City</PaperCode> and <PaperCode>Stop following City</PaperCode>: each <PaperCode>template</PaperCode>, with the input's placeholder in its field.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/guides/widgets/">add a Home widget</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
