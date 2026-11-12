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

const FOLLOW_RUN = `followCity: async (ctx: Ctx, input?: { city?: string }) => {
    const city = cityName(input?.city);
    const { settings } = ctx.state;
    if (settings.cities.includes(city)) throw new Error(\`Weather already follows \${city}\`);
    if (settings.cities.length >= 12) throw new Error("Weather follows at most 12 cities. Remove one first.");
    await saveSettings(ctx, { ...settings, cities: [...settings.cities, city] });
    await refreshCity(ctx, city);
    return true;
},`;

const PAGE_CALL = `const follow = async () => {
    setBusy(true);
    setFailure("");
    try {
        await bridge.call<boolean>("followCity", { city: city() });
        setCity("");
    } catch (err) {
        setFailure(errorMessage(err));
    } finally {
        setBusy(false);
    }
};`;

const PAGE_QUOTE = `<Show when={failure()}>
    <PaperQuote variant="danger" icon="warning" title="City not added" role="alert" onDismiss={() => setFailure("")}>
        {failure()}
    </PaperQuote>
</Show>`;

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

const PAGE_FAILURES = `<For each={Object.entries(weather().failures)}>
    {([name, message]) => (
        <PaperQuote variant="danger" icon="warning" title={\`\${name} not checked\`}>
            {message}
        </PaperQuote>
    )}
</For>`;

const ON_INIT = `async onInit(ctx: Ctx) {
    try {
        const saved = await configApi.get<WeatherSettings>(PANEL_ID);
        const stored = await secretsApi.get(API_KEY_SECRET, PANEL_ID);
        ctx.setState({ settings: { ...DEFAULT_SETTINGS, ...saved }, hasKey: stored.found });
    } catch (err) {
        // keep running, so the page can say what is wrong instead of a dead panel
        const message = err instanceof Error ? err.message : String(err);
        console.error("[weather] settings not loaded:", message);
        ctx.setState({ loadError: message });
        return;
    }
    void refreshAll(ctx);
    setInterval(() => void refreshAll(ctx), REFRESH_EVERY_MS);
},`;

const PAGE_LOAD_ERROR = `<Show when={weather().loadError}>
    {(message) => (
        <PaperQuote variant="danger" icon="warning" title="Settings could not be read" role="alert">
            {message()}
        </PaperQuote>
    )}
</Show>`;

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
                <li>Show it where it happened: next to the button, on the city's tile, in the widget. A message in the log alone is a failure nobody sees.</li>
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
✗ dev.example.weather followCity failed: Enter a city name`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Check the input before changing anything, so a refused call leaves nothing half done.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="on-the-page">Show it on the page</PaperText>
            <PaperText preset="body" as="p">
                Every handler that calls something catches the error and puts its message in a signal.
                Weather's Follow button runs this handler, with <PaperCode>city</PaperCode>, <PaperCode>busy</PaperCode> and <PaperCode>failure</PaperCode> as <PaperCode>createSignal</PaperCode> signals of the page:
            </PaperText>
            <PaperCode block language="tsx">{PAGE_CALL}</PaperCode>
            <PaperText preset="body" as="p">
                The page shows the signal with a <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> under the form. The title says what didn't happen, and the body is the reason:
            </PaperText>
            <PaperCode block language="tsx">{PAGE_QUOTE}</PaperCode>
            <PaperTextList>
                <li>Clear the failure when the person tries again, so an old message never sits next to a new result.</li>
                <li><PaperCode>role="alert"</PaperCode> makes a screen reader read it out. <PaperCode>onDismiss</PaperCode> gives the quote a close button.</li>
                <li><PaperCode>finally</PaperCode> turns the button back on whether the call worked or not.</li>
                <li>Each place that can fail gets its own signal and quote. A failure shown under the wrong button points the person at the wrong thing.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="in-the-background">Failures in the background</PaperText>
            <PaperText preset="body" as="p">
                Work on a timer has no caller to throw to. Catch the failure, log it, and keep the reason in the state, where every window shows it:
            </PaperText>
            <PaperCode block language="tsx">{REFRESH_CITY}</PaperCode>
            <PaperCode block language="tsx">{PAGE_FAILURES}</PaperCode>
            <PaperText preset="body" as="p">
                The next check that works removes the city's entry from <PaperCode>failures</PaperCode>, and its quote goes away.
                Keep the reason until then: a failure that disappears before anyone looks is a failure nobody sees.
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
                    <tr><td>A button or form</td><td><PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> with <PaperCode>variant="danger"</PaperCode> next to it.</td></tr>
                    <tr><td>Something the panel needs and doesn't have yet, such as an API key</td><td><PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink> with the button that fixes it.</td></tr>
                    <tr><td>One item in a list or grid</td><td>The item's own error state, such as <PaperCode>tone="danger"</PaperCode> on a <PaperLink href="/docs/paperui/paperstattile/">PaperStatTile</PaperLink>, and the reason below.</td></tr>
                    <tr><td>A Home widget</td><td><PaperCode>PaperWidgetMessage</PaperCode> with <PaperCode>tone="danger"</PaperCode> and the reason as its hint. See <PaperLink href="/docs/developers/widgets/#failures">Add a Home widget</PaperLink>.</td></tr>
                    <tr><td>Inside a modal</td><td>A PaperQuote in the modal. Keep it open, so the person can fix the input.</td></tr>
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
                <li>Leave <PaperCode>bunx paperapi monitor --panel &lt;panel-id&gt;</PaperCode> running and press every button. A call marked <PaperCode>✗</PaperCode> must show on the page too.</li>
                <li>Stop the network or remove the API key and look at every page and widget. Each says what is wrong.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/settings-and-secrets/">settings and secrets</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
