import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const REGISTER_BLOCKS = `import { blocksApi, type ServiceContext } from "@mileniumhq/paperapi";
import { cityName, fetchForecast } from "./lib/openWeather";
import { PANEL_ID, type WeatherState } from "./panel";

type Ctx = ServiceContext<WeatherState>;

export const weatherBlocks = blocksApi.panel(PANEL_ID);

export async function registerBlocks(ctx: Ctx): Promise<void> {
    await weatherBlocks.register({
        categories: [{ name: "Weather", icon: "partly_cloudy_day" }],
        types: [{
            id: "forecast",
            name: "Forecast",
            icon: "partly_cloudy_day",
            base: "object",
            fields: {
                temperature: { type: "number", name: "Temperature" },
                high: { type: "number", name: "High" },
                low: { type: "number", name: "Low" },
                summary: { type: "text", name: "Summary" },
            },
        }],
        commands: [{
            id: "get-forecast",
            name: "Get Forecast",
            description: "Checks the current weather in a city and gives back its temperature, high, low and summary",
            category: "Weather",
            icon: "partly_cloudy_day",
            text: "Get the forecast for {city}",
            inputs: { city: { type: "text", name: "City", maxLength: 64 } },
            output: "forecast",
            run: ({ city }: { city: string }) => fetchForecast(cityName(city), ctx.state.settings.units),
        }],
        events: [{
            id: "freezing",
            name: "When a City Freezes",
            description: "Fires when a followed city drops to 0 °C (32 °F) or below",
            category: "Weather",
            icon: "ac_unit",
            values: {
                city: { type: "text", name: "City" },
                temperature: { type: "number", name: "Temperature" },
            },
        }],
    });
}`;

const FOLLOW_BLOCK = `commands: [
    // ...get-forecast
    {
        id: "follow-city",
        name: "Follow City",
        description: "Adds a city to the ones Weather checks every 15 minutes",
        category: "Weather",
        icon: "add_location",
        text: "Follow the weather in {city}",
        inputs: { city: { type: "text", name: "City", maxLength: 64 } },
        run: ({ city }: { city: string }) => followCity(ctx, city),
    },
],`;

const FOLLOW_CITY = `// one function behind the page's call and the public block
export async function followCity(ctx: Ctx, city: unknown): Promise<void> {
    const name = cityName(city);
    const { settings } = ctx.state;
    if (settings.cities.includes(name)) throw new Error(\`Weather already follows \${name}\`);
    await saveSettings(ctx, { ...settings, cities: [...settings.cities, name] });
    await refreshCity(ctx, name);
}`;

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
            await weatherBlocks.fire("freezing", { city, temperature: forecast.temperature });
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(\`[weather] \${city} not refreshed:\`, message);
        ctx.setState((prev) => ({ failures: { ...prev.failures, [city]: message } }));
    }
}`;

const ON_INIT = `async onInit(ctx: Ctx) {
    // blocks first: a flow that starts on freezing needs the event to exist
    await registerBlocks(ctx);
    // load settings, start the checks
},`;

const CALLER = `import { blocksApi } from "@mileniumhq/paperapi";

interface Forecast {
    temperature: number;
    high: number;
    low: number;
    summary: string;
}

export async function osloTemperature(): Promise<number> {
    const forecast = await blocksApi.run<Forecast>("dev.example.weather", "get-forecast", { city: "Oslo" });
    return forecast.temperature;
}

export function watchFreezing(onFreezing: (city: string) => void): () => void {
    return blocksApi.onEvent("dev.example.weather", "freezing", (payload: { city: string }) => onFreezing(payload.city));
}`;

export default function BlocksGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Expose blocks</PaperText>
            <PaperText preset="body" as="p">
                A block is something a panel offers beyond its own pages: a step a flow can run, a value it can read, or an event it can start from. The Blocks panel shows them, agents use them as tools, and other panels can run them.
                This guide adds the Weather example panel's blocks, one event that starts flows when a city freezes, and keeps the calls its own page makes private.
                At the end, a person can build a flow on Weather without opening its code.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel with a service, as in <PaperLink href="/docs/developers/services/">Services and state</PaperLink>.
                Every field is in the <PaperLink href="/docs/paperapi/blocks/">blocksApi</PaperLink> reference.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="who-sees-what">Who sees what</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Kind</th>
                        <th>Seen by</th>
                        <th>Weather's</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Block</td><td>The Blocks panel's toolbox, agents as tools, and any panel that runs it</td><td><PaperCode>get-forecast</PaperCode>, <PaperCode>follow-city</PaperCode>, <PaperCode>unfollow-city</PaperCode>, and the event <PaperCode>freezing</PaperCode></td></tr>
                    <tr><td>Call</td><td>Only the panel's own page. Other panels are refused and nothing lists it</td><td><PaperCode>setUnits</PaperCode>, <PaperCode>keyChanged</PaperCode></td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Make a block when a person would want it in a flow or ask an agent for it. Everything the page needs only for itself is a call in <PaperCode>definePanelService</PaperCode>, which is an internal block the panel makes for you.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="register">Register blocks</PaperText>
            <PaperText preset="body" as="p">
                Register the blocks in <PaperCode>onInit</PaperCode> with <PaperCode>blocksApi.panel(PANEL_ID).register</PaperCode>. Weather keeps them in <PaperCode>src/blocks.ts</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">{REGISTER_BLOCKS}</PaperCode>
            <PaperCode block language="tsx">{ON_INIT}</PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>What to write</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>id</PaperCode></td><td>Lowercase words with dashes. Callers and saved flows use it, so never rename one that has shipped.</td></tr>
                    <tr><td><PaperCode>name</PaperCode></td><td>A verb and its object, in title case: <PaperCode>Get Forecast</PaperCode>, <PaperCode>Follow City</PaperCode>.</td></tr>
                    <tr><td><PaperCode>description</PaperCode></td><td>What it does and what it gives back, in one sentence. An agent decides from this whether to use it.</td></tr>
                    <tr><td><PaperCode>text</PaperCode></td><td>The sentence the block shows, with each input in braces: <PaperCode>{"Get the forecast for {city}"}</PaperCode>.</td></tr>
                    <tr><td><PaperCode>category</PaperCode>, <PaperCode>icon</PaperCode></td><td>The toolbox section the block sits in, named after the panel and declared in <PaperCode>categories</PaperCode>, and a Material Symbols name for the block. The panel's own icon is shown too, so give the panel one; see <PaperLink href="/docs/developers/packaging/">Package a panel</PaperLink>.</td></tr>
                    <tr><td><PaperCode>output</PaperCode></td><td>The type <PaperCode>run</PaperCode> gives back. Each field of an object type becomes a property the next blocks of a flow can use.</td></tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li><PaperCode>register</PaperCode> checks the whole set first, and a broken definition registers nothing. It throws in <PaperCode>onInit</PaperCode>, so the service never reports ready and the reason is in the log.</li>
                <li>A read with no effect is a value block, not a command. Weather could offer its followed cities that way.</li>
                <li>Register the blocks before slow start-up work, so a flow never finds half of them.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="inputs">Inputs</PaperText>
            <PaperTextList>
                <li><PaperCode>name</PaperCode> names the field, and the error: <PaperCode>"City" is required</PaperCode>.</li>
                <li>An empty input shows its type as the placeholder, so there is none to write.</li>
                <li>Set a limit on every input: <PaperCode>maxLength</PaperCode> on text, <PaperCode>min</PaperCode>, <PaperCode>max</PaperCode> and <PaperCode>integer</PaperCode> on numbers. Paperboard checks the limits before <PaperCode>run</PaperCode>, and the person is told which one broke.</li>
                <li>An input is required unless it is <PaperCode>optional</PaperCode>. The value can still be empty text, so check it in <PaperCode>run</PaperCode>, as <PaperCode>cityName</PaperCode> does.</li>
                <li>Never take a key, token or password as an input. Read it from <PaperLink href="/docs/developers/settings-and-secrets/">secretsApi</PaperLink> in the service.</li>
            </PaperTextList>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather command.get-forecast '{"city":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'
✗ dev.example.weather command.get-forecast failed: "City" must be at most 64 characters`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="share-the-work">One function for the page and the block</PaperText>
            <PaperText preset="body" as="p">
                Weather's page follows a city with a call, and a flow follows one with a block. Both run the same function, so the rules are written once:
            </PaperText>
            <PaperCode block language="tsx">{FOLLOW_CITY}</PaperCode>
            <PaperCode block language="tsx">{FOLLOW_BLOCK}</PaperCode>
            <PaperText preset="body" as="p">
                The call in <PaperCode>definePanelService</PaperCode> is <PaperCode>{"followCity: (ctx, input) => followCity(ctx, input?.city)"}</PaperCode>. <PaperCode>unfollow-city</PaperCode> has the same shape.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="events">An event</PaperText>
            <PaperText preset="body" as="p">
                An event has no <PaperCode>run</PaperCode>. It describes something that happens, and a flow built on it starts each time the service fires it.
                Weather's <PaperCode>freezing</PaperCode>, declared above, fires when a followed city drops to 0 °C (32 °F) or below.
                The service fires it with <PaperCode>fire</PaperCode>, where it learns the temperature.
                <PaperCode>dropsToFreezing</PaperCode> in <PaperCode>src/lib/openWeather.ts</PaperCode> compares the new reading with the last one:
            </PaperText>
            <PaperCode block language="tsx">{DROPS_TO_FREEZING}</PaperCode>
            <PaperCode block language="tsx">{REFRESH_CITY}</PaperCode>
            <PaperTextList>
                <li>What an event fires with is its <PaperCode>values</PaperCode>. Declare every field the flow can use, with a type.</li>
                <li><PaperCode>fire</PaperCode> checks the payload against those values and throws when it does not fit, before anything is sent. Here the failure is caught and shown in <PaperCode>failures</PaperCode>.</li>
                <li>Fire an event once per change, not on every check. A city that stays frozen for a day fires it once, not every 15 minutes, so a flow that sends a message sends one.</li>
                <li>To let a flow start only for one city, give the event an input and a <PaperCode>filters</PaperCode> entry. See <PaperLink href="/docs/paperapi/blocks/#blocks">Commands, values and events</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="calls">Keep the page's calls private</PaperText>
            <PaperText preset="body" as="p">
                The page asks the service to do things through <PaperCode>calls</PaperCode>, such as <PaperCode>setUnits</PaperCode> in <PaperLink href="/docs/developers/settings-and-secrets/#settings">Settings and secrets</PaperLink>.
                They need no <PaperCode>text</PaperCode>, <PaperCode>category</PaperCode> or <PaperCode>icon</PaperCode>, since nothing shows them. Check their input all the same: <PaperCode>paperapi call</PaperCode> reaches them, and a bug in the page can send anything.
                A call is an internal block: never listed, and refused to every other panel.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="call-other-panels">Use another panel's blocks</PaperText>
            <PaperText preset="body" as="p">
                Any panel runs another panel's blocks with <PaperCode>blocksApi.run</PaperCode>, and listens to its events with <PaperCode>blocksApi.onEvent</PaperCode>.
                Name the block by its id: <PaperCode>get-forecast</PaperCode>, <PaperCode>freezing</PaperCode>. <PaperCode>run</PaperCode> runs commands, <PaperCode>read</PaperCode> reads values, and <PaperCode>onEvent</PaperCode> hears events.
                A panel that uses Weather would write:
            </PaperText>
            <PaperCode block language="tsx">{CALLER}</PaperCode>
            <PaperTextList>
                <li>The call rejects with the block's own message, such as <PaperCode>Enter a city name</PaperCode>. Show it like any other failure.</li>
                <li>A call waits 30 seconds by default. Pass <PaperCode>{"{ timeoutMs: null }"}</PaperCode> as the fourth argument for a block that takes longer.</li>
                <li>The panel you call may not be installed. The call then fails with a message that the block is not registered or unavailable; tell the person which panel to install.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="check-it">Check it</PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather
4 blocks on dev.example.weather:
command.follow-city    Follow City  (city: text)
command.get-forecast   Get Forecast  (city: text)
command.unfollow-city  Unfollow City  (city: text)
event.freezing         When a City Freezes`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The list shows the blocks anyone can use, so the page's calls are not in it. Name a block to run it, as above.
                Then open the Blocks panel, open or make a project, and find Weather in the toolbox.
                Weather's blocks read <PaperCode>When a City Freezes</PaperCode>, <PaperCode>Get the forecast for City</PaperCode>, <PaperCode>Follow the weather in City</PaperCode> and <PaperCode>Stop following City</PaperCode>: each <PaperCode>text</PaperCode>, with the input's name in its socket.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/widgets/">add a Home widget</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
