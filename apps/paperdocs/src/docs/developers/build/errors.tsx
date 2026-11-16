import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const OPEN_WEATHER = `// Pure OpenWeather helpers: no network, no PaperAPI, so tests reach every rule.
import type { Forecast, Units } from "../panel";

export function cityName(raw: unknown): string {
    const city = String(raw ?? "").trim();
    if (!city) throw new Error("Enter a city name");
    if (city.length > 64) throw new Error("A city name has at most 64 characters");
    return city;
}

export function currentWeatherUrl(city: string, units: Units, key: string): string {
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("q", city);
    url.searchParams.set("units", units);
    url.searchParams.set("appid", key);
    return url.toString();
}

interface CurrentWeatherBody {
    message?: unknown;
    main?: { temp?: unknown; temp_min?: unknown; temp_max?: unknown };
    weather?: Array<{ description?: unknown }>;
}

/** Turns OpenWeather's answer into a Forecast, or throws the reason it can't. */
export function readCurrentWeather(city: string, status: number, body: unknown, now: number): Forecast {
    const data = (body ?? {}) as CurrentWeatherBody;
    if (status !== 200) {
        const reason = typeof data.message === "string" ? data.message : \`HTTP \${status}\`;
        throw new Error(\`OpenWeather refused \${city}: \${reason}\`);
    }
    const { temp, temp_min, temp_max } = data.main ?? {};
    const summary = data.weather?.[0]?.description;
    if (typeof temp !== "number" || typeof temp_min !== "number" || typeof temp_max !== "number" || typeof summary !== "string") {
        throw new Error(\`OpenWeather sent an answer for \${city} without a temperature\`);
    }
    return { city, temperature: temp, high: temp_max, low: temp_min, summary, checkedAt: now };
}

/** True when a city drops to freezing, 0 °C or 32 °F, on this reading and was above it on the last one. */
export function dropsToFreezing(before: Forecast | undefined, after: Forecast, units: Units): boolean {
    const limit = units === "metric" ? 0 : 32;
    return after.temperature <= limit && (before === undefined || before.temperature > limit);
}`;

const FOLLOW_RUN = `followCity: async (input, ctx) => {
    const city = cityName(input.city);
    const { settings } = ctx.state;
    if (settings.cities.includes(city)) throw new Error(\`Weather already follows \${city}\`);
    if (settings.cities.length >= 12) throw new Error("Weather follows at most 12 cities. Remove one first.");
    await saveSettings(ctx, { ...settings, cities: [...settings.cities, city] });
    await refreshCity(ctx, city);
},`;

const PAGE_CALL = `import { showError } from "@mileniumhq/paperui";
import { service } from "../weather";

const follow = async () => {
    setBusy(true);
    try {
        await service.followCity({ city: city() });
        setCity("");
    } catch (err) {
        showError("Couldn't follow the city", err);
    } finally {
        setBusy(false);
    }
};`;

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
        const message = errorMessage(err);
        console.error(\`[weather] \${city} not refreshed:\`, message);
        ctx.setState((prev) => ({ failures: { ...prev.failures, [city]: message } }));
    }
}`;

const PAGE_FAILURES = `createFailureToast(
    () => Object.entries(weather().failures).map(([name, message]) => \`\${name}: \${message}\`).join(" "),
    { title: "Couldn't check the weather" },
);`;

const ON_INIT = `async onInit(ctx: Ctx) {
    try {
        const saved = await configApi.get<WeatherSettings>(PANEL_ID);
        const stored = await secretsApi.get(API_KEY_SECRET, PANEL_ID);
        ctx.setState({ settings: { ...DEFAULT_SETTINGS, ...saved }, hasKey: stored.found });
    } catch (err) {
        // keep running, so the page can say what is wrong instead of a dead panel
        const message = errorMessage(err);
        console.error("[weather] settings not loaded:", message);
        ctx.setState({ loadError: message });
        return;
    }
    void refreshAll(ctx);
    setInterval(() => void refreshAll(ctx), REFRESH_EVERY_MS);
},`;

const PAGE_LOAD_ERROR = `createFailureToast(() => weather().loadError, { title: "Couldn't read the settings" });`;

export default function ErrorsGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Show every failure</PaperText>
            <PaperText preset="body" as="p">
                Every failure in a panel reaches the person using it, with the real reason, in the place they were looking.
                This guide follows the Weather example panel's failures from where they happen to where they show: a button press, work in the background, and a service that can't read its settings.
                At the end, no button in the panel can fail without saying why.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel with a service and a page, as in <PaperLink href="/docs/developers/services/">Services and state</PaperLink> and <PaperLink href="/docs/developers/ui/">Design the interface</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="the-rules">The rules</PaperText>
            <PaperTextList>
                <li>Never catch a failure and carry on as if it worked. A button that does nothing, with no way to know why, is the worst thing a panel can do.</li>
                <li>Show the reason, not only that something failed. <PaperCode>OpenWeather refused Oslo: city not found</PaperCode> tells the person what to change. <PaperCode>Something went wrong</PaperCode> doesn't.</li>
                <li>Show it where it will be seen: a toast for a button press, the city's tile for its last check, the widget for the widget. A message in the log alone is a failure nobody sees.</li>
                <li>Never show a placeholder in place of something missing. A city with no reading says <PaperCode>No reading</PaperCode> and why, never <PaperCode>0°C</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="throw-sentences">Throw sentences</PaperText>
            <PaperText preset="body" as="p">
                An error's message is what the person reads, so write it for them: one sentence that names the thing and says what is wrong or what to do.
                Weather keeps its checks in <PaperCode>src/lib/openWeather.ts</PaperCode>, with no network and no PaperAPI, so tests reach every one:
            </PaperText>
            <PaperCode block language="tsx">{OPEN_WEATHER}</PaperCode>
            <PaperTextList>
                <li>Throw <PaperCode>Error</PaperCode> objects. Paperboard passes on only the message: the stack, the cause and any other fields stay in the service.</li>
                <li>Put the input in the message, as <PaperCode>OpenWeather refused Oslo</PaperCode> does. A flow or an agent that ran the block reads the same text.</li>
                <li>Pass on a service's own reason, such as OpenWeather's <PaperCode>message</PaperCode>, instead of replacing it with your own guess.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="calls">Failures in a call or a block</PaperText>
            <PaperText preset="body" as="p">
                A call or a block fails by throwing. Its caller gets the same message, whether the caller is the panel's page, another panel, a flow or an agent:
            </PaperText>
            <PaperCode block language="tsx">{FOLLOW_RUN}</PaperCode>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather followCity '{"city":"  "}'
✗ dev.example.weather followCity failed: Enter a city name

$ bunx paperapi call dev.example.weather followCity '{"town":"Oslo"}'
✗ dev.example.weather followCity failed: The call "followCity" was refused: there is no field "town"`}
            </PaperCode>
            <PaperText preset="body" as="p">
                An input that is not the shape the <PaperLink href="/docs/paperapi/bridge/#errors">contract</PaperLink> says is refused before the handler runs, with a sentence that names the field.
                The handler checks the rest, such as a city that is only spaces, before changing anything, so a refused call leaves nothing half done.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="on-the-page">Show it on the page</PaperText>
            <PaperText preset="body" as="p">
                Every handler that calls something catches the error and shows it with <PaperLink href="/docs/paperui/papertoast/#show-error">showError</PaperLink>.
                There is no failure signal to keep and no place in the layout to find: one line in the <PaperCode>catch</PaperCode> and the failure is shown.
                Weather's Follow button runs this handler, with <PaperCode>city</PaperCode> and <PaperCode>busy</PaperCode> as <PaperCode>createSignal</PaperCode> signals of the page:
            </PaperText>
            <PaperCode block language="tsx">{PAGE_CALL}</PaperCode>
            <PaperTextList>
                <li>The title says what didn't happen, as "Couldn't …", and the toast says the error's message as the reason.</li>
                <li>A failure toast stays until it is closed and a screen reader reads it out, so the failure is never missed.</li>
                <li>Give it <PaperCode>retry</PaperCode> when trying again is what the person would do next. The page keeps its own way to try again too.</li>
                <li><PaperCode>finally</PaperCode> turns the button back on whether the call worked or not.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A failure that stays true until something changes, such as the background failures and settings below, is a toast too, from the state: <PaperLink href="/docs/paperui/papertoast/#create-failure-toast">createFailureToast</PaperLink> shows it while it stands, in every window, and closes it once it is fixed.
                Never an error quote: <PaperCode>{'<PaperQuote variant="danger">'}</PaperCode> is deprecated, and the code check flags it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="in-the-background">Failures in the background</PaperText>
            <PaperText preset="body" as="p">
                Work on a timer has no caller to throw to. Catch the failure, log it, and keep the reason in the state, where every window shows it:
            </PaperText>
            <PaperCode block language="tsx">{REFRESH_CITY}</PaperCode>
            <PaperCode block language="tsx">{PAGE_FAILURES}</PaperCode>
            <PaperText preset="body" as="p">
                The next check that works removes the city's entry from <PaperCode>failures</PaperCode>, and the toast takes it out, closing once no city is failing.
                Keep the reason until then: a failure that disappears before anyone looks is a failure nobody sees.
            </PaperText>
            <PaperText preset="body" as="p">
                A failure with no place on the page, or that matters while the panel isn't open, goes to <PaperLink href="/docs/paperapi/problems/">problemsApi</PaperLink> instead.
                Paperboard counts it on the panel's row in the sidebar until the panel clears it or the person dismisses it.
                Give it a key, so a check that keeps failing is one problem, and clear the key once it works again.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="at-start">Failures when the service starts</PaperText>
            <PaperText preset="body" as="p">
                A service whose <PaperCode>onInit</PaperCode> throws never becomes ready, so Paperboard stops it and the page can't explain anything.
                Catch what <PaperCode>onInit</PaperCode> can't do, put the reason in the state, and return:
            </PaperText>
            <PaperCode block language="tsx">{ON_INIT}</PaperCode>
            <PaperCode block language="tsx">{PAGE_LOAD_ERROR}</PaperCode>

            <PaperText preset="subheader" as="h2" id="where-to-show">Where each failure goes</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Failure</th>
                        <th>Show it with</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>A button, form, menu item or anything else the person pressed</td><td><PaperLink href="/docs/paperui/papertoast/#show-error">showError</PaperLink> in its <PaperCode>catch</PaperCode>.</td></tr>
                    <tr><td>Something that stays wrong, such as settings that can't be read</td><td><PaperLink href="/docs/paperui/papertoast/#create-failure-toast">createFailureToast</PaperLink>, from the state, or <PaperLink href="/docs/paperui/state/#create-read">createRead</PaperLink>'s <PaperCode>failure</PaperCode> for a read.</td></tr>
                    <tr><td>A view with nothing to show because it couldn't load</td><td><PaperLink href="/docs/paperui/paperemptystate/#couldnt-load">"Couldn't load"</PaperLink> with Try again, and the toast says why.</td></tr>
                    <tr><td>A field the person typed wrong</td><td>The field itself: <PaperLink href="/docs/paperui/paperinput/">PaperInput</PaperLink>'s <PaperCode>invalid</PaperCode>, with the reason under it.</td></tr>
                    <tr><td>Something the panel needs and doesn't have yet, such as an API key</td><td><PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink> with the button that fixes it.</td></tr>
                    <tr><td>One item in a list or grid</td><td>The item's own error state, such as <PaperCode>tone="danger"</PaperCode> on a <PaperLink href="/docs/paperui/paperstattile/">PaperStatTile</PaperLink>, and the reason below.</td></tr>
                    <tr><td>A Home widget</td><td><PaperCode>PaperWidgetMessage</PaperCode> with <PaperCode>tone="danger"</PaperCode> and the reason as its hint. See <PaperLink href="/docs/developers/widgets/#failures">Add a Home widget</PaperLink>.</td></tr>
                    <tr><td>Work in the background with no place on the page, such as a reconnect or a Blocks event</td><td><PaperLink href="/docs/paperapi/problems/">problemsApi.report</PaperLink> with a key, cleared once it works again.</td></tr>
                    <tr><td>Inside a modal</td><td>A toast, which shows above the modal. Keep the modal open, so the person can fix the input.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="logs">Log it too</PaperText>
            <PaperText preset="body" as="p">
                Log what the person doesn't see in full, with <PaperCode>console.error</PaperCode> and the panel's short name first, as <PaperCode>[weather]</PaperCode>.
                The service's output goes to the Paperboard log; see <PaperLink href="/docs/developers/dev-loop/#logs">Read the service's output</PaperLink>.
                The log is for you, as well as the page, never instead of it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="check-it">Check it</PaperText>
            <PaperTextList>
                <li>Run every block and call with input it must refuse, with <PaperCode>bunx paperapi call</PaperCode>, and read the message as the person would.</li>
                <li>Leave <PaperCode>bunx paperapi monitor --panel &lt;panel-id&gt;</PaperCode> running and press every button. A call marked <PaperCode>✗</PaperCode> must show a toast too.</li>
                <li>Stop the network or remove the API key and look at every page and widget. Each says what is wrong.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/settings-and-secrets/">settings and secrets</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
