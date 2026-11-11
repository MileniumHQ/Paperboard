import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const PANEL_TS = `// What the page, the service and the widget agree on. It runs in the
// browser and in Node, so it imports nothing from either.
export const PANEL_ID = "dev.example.weather";

export type Units = "metric" | "imperial";

export interface Forecast {
    city: string;
    temperature: number;
    high: number;
    low: number;
    summary: string;
    checkedAt: number;
}

/** Saved with configApi. The service is its only writer. */
export interface WeatherSettings {
    cities: string[];
    units: Units;
}

/** What the service holds in memory and every window mirrors. */
export interface WeatherState {
    settings: WeatherSettings;
    forecasts: Record<string, Forecast>;
    /** the reason each city's last check failed, by city */
    failures: Record<string, string>;
    hasKey: boolean;
    /** set when the saved settings could not be read */
    loadError: string | null;
}

export const DEFAULT_SETTINGS: WeatherSettings = { cities: [], units: "metric" };

export const DEFAULT_STATE: WeatherState = {
    settings: DEFAULT_SETTINGS,
    forecasts: {},
    failures: {},
    hasKey: false,
    loadError: null,
};

export const API_KEY_SECRET = "openweather-key";`;

const SERVICE_TS = `import { configApi, defineAction, definePanelService, secretsApi, type ServiceContext } from "@mileniumhq/paperapi";
import { cityName, currentWeatherUrl, readCurrentWeather } from "./lib/openWeather";
import { API_KEY_SECRET, DEFAULT_SETTINGS, DEFAULT_STATE, PANEL_ID, type WeatherSettings, type WeatherState } from "./panel";

type Ctx = ServiceContext<WeatherState>;

const REFRESH_EVERY_MS = 15 * 60 * 1000;

// Save first, then show: the state never claims what the disk doesn't hold.
async function saveSettings(ctx: Ctx, settings: WeatherSettings): Promise<void> {
    await configApi.set(settings, PANEL_ID);
    ctx.setState({ settings });
}

async function refreshCity(ctx: Ctx, city: string): Promise<void> {
    try {
        const stored = await secretsApi.get(API_KEY_SECRET, PANEL_ID);
        if (!stored.found || !stored.value) throw new Error("Add an OpenWeather API key in Weather's settings");
        const url = currentWeatherUrl(city, ctx.state.settings.units, stored.value);
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const forecast = readCurrentWeather(city, response.status, await response.json(), Date.now());
        const { [city]: _cleared, ...failures } = ctx.state.failures;
        ctx.setState((prev) => ({ forecasts: { ...prev.forecasts, [city]: forecast }, failures }));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(\`[weather] \${city} not refreshed:\`, message);
        ctx.setState((prev) => ({ failures: { ...prev.failures, [city]: message } }));
    }
}

async function refreshAll(ctx: Ctx): Promise<void> {
    for (const city of ctx.state.settings.cities) await refreshCity(ctx, city);
}

export default definePanelService({
    id: PANEL_ID,
    state: DEFAULT_STATE,
    actions: [
        defineAction({
            id: "follow-city",
            name: "Follow city",
            description: "Adds a city to the ones Weather checks every 15 minutes",
            inputs: {
                city: { type: "string", label: "City", placeholder: "City", required: true, maxLength: 64 },
            },
            output: "boolean",
            run: async (ctx: Ctx, inputs: { city?: string }) => {
                const city = cityName(inputs.city);
                const { settings } = ctx.state;
                if (settings.cities.includes(city)) throw new Error(\`Weather already follows \${city}\`);
                await saveSettings(ctx, { ...settings, cities: [...settings.cities, city] });
                await refreshCity(ctx, city);
                return true;
            },
        }),
    ],
    async onInit(ctx: Ctx) {
        try {
            const saved = await configApi.get<WeatherSettings>(PANEL_ID);
            const stored = await secretsApi.get(API_KEY_SECRET, PANEL_ID);
            ctx.setState({ settings: { ...DEFAULT_SETTINGS, ...saved }, hasKey: stored.found });
        } catch (err) {
            // keep running, so the page can say what is wrong
            const message = err instanceof Error ? err.message : String(err);
            console.error("[weather] settings not loaded:", message);
            ctx.setState({ loadError: message });
            return;
        }
        void refreshAll(ctx);
        setInterval(() => void refreshAll(ctx), REFRESH_EVERY_MS);
    },
});`;

const WEATHER_TS = `// The page's one bridge to the service. Made when the page loads, so the
// shell waits for its first answer before it shows the panel.
import { createSignal } from "solid-js";
import { createPanelBridge } from "@mileniumhq/paperapi";
import { DEFAULT_STATE, PANEL_ID, type WeatherState } from "./panel";

export const bridge = createPanelBridge<WeatherState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });

const [state, setState] = createSignal<WeatherState>(bridge.getState());
bridge.onStateChange((_patch, full) => setState({ ...full }));

/** The service's state, updated on every change it sends. */
export const weather = state;

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}`;

const PAGE_USE = `import { For } from "solid-js";
import { PaperStatTile } from "@mileniumhq/paperui";
import { weather } from "../weather";

export function CityTiles() {
    return (
        <For each={weather().settings.cities}>
            {(name) => <PaperStatTile icon="location_city" label={name} value={weather().failures[name] ? "Not checked" : "Checked"} />}
        </For>
    );
}`;

export default function ServicesDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Services and state</PaperText>
            <PaperText preset="body" as="p">
                A service is the panel's background program: it holds the panel's state and does its work, with or without a window open.
                This guide builds the service of the Weather example panel, which checks the weather for the cities a person follows every 15 minutes.
                At the end, the service saves what it must keep, rebuilds its state when it starts, and every open window shows the same state.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel made with <PaperCode>npm create @mileniumhq/panel</PaperCode>, as in <PaperLink href="/docs/developers/first-panel/">Your first panel</PaperLink>.
                Its <PaperCode>src/service.ts</PaperCode> builds to <PaperCode>dist/service.js</PaperCode>, which the manifest names in <PaperCode>service</PaperCode>.
                Every function used here is in the <PaperLink href="/docs/paperapi/service/">definePanelService</PaperLink> and <PaperLink href="/docs/paperapi/bridge/">createPanelBridge</PaperLink> references.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="when-you-need-one">When a panel needs a service</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>The panel</th>
                        <th>Service</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Shows something and acts only when a person presses a button</td><td>Not needed. The page calls the APIs itself.</td></tr>
                    <tr><td>Works on a schedule, such as Weather's check every 15 minutes</td><td>Needed. The page runs only while a window shows it.</td></tr>
                    <tr><td>Runs a server, a bot, or another long-running program</td><td>Needed. It starts the program and watches it.</td></tr>
                    <tr><td>Offers actions to flows, agents or other panels</td><td>Needed. Actions are registered by the service.</td></tr>
                    <tr><td>Has a Home widget that shows live data</td><td>Needed. The widget reads the service's state.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="shape-the-state">Shape the state</PaperText>
            <PaperText preset="body" as="p">
                Write the state's type in a file that the service, the page and the widget all import.
                Weather keeps it in <PaperCode>src/panel.ts</PaperCode>, next to the panel id and the defaults:
            </PaperText>
            <PaperCode block language="tsx">{PANEL_TS}</PaperCode>
            <PaperTextList>
                <li>Put in the state everything a window shows: the settings, the results, and the reason each thing failed. A page that needs something not in the state has to ask for it, and a widget has to ask again.</li>
                <li>Keep the state plain JSON. It travels to every window as JSON.</li>
                <li>Never put a key, a token or a password in the state. Every page and widget of the panel receives it. Weather keeps only <PaperCode>hasKey</PaperCode>. See <PaperLink href="/docs/developers/settings-and-secrets/">Settings and secrets</PaperLink>.</li>
                <li>This file runs in the browser and in Node, so it imports neither.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="write-the-service">Write the service</PaperText>
            <PaperText preset="body" as="p">
                Here is Weather's service with one of its actions. Its parts are explained below.
            </PaperText>
            <PaperCode block language="tsx">{SERVICE_TS}</PaperCode>

            <PaperText preset="title" as="h3" id="set-state">Change the state with setState</PaperText>
            <PaperTextList>
                <li><PaperCode>ctx.state</PaperCode> is the current state. Read it, never change it in place.</li>
                <li><PaperCode>ctx.setState(patch)</PaperCode> replaces the top-level keys in the patch and keeps the others. <PaperCode>{"{ settings }"}</PaperCode> replaces the whole <PaperCode>settings</PaperCode> object, so build the new one from the old, as <PaperCode>follow-city</PaperCode> does.</li>
                <li>Pass a function, <PaperCode>{"ctx.setState((prev) => ({ ... }))"}</PaperCode>, when the new value depends on the old one and the code awaited something since it read it. Two cities that finish at once each add their own entry to <PaperCode>forecasts</PaperCode>.</li>
                <li>Each patch is sent to every open window and widget of the panel. Patches made while one is on its way are sent together in the next.</li>
            </PaperTextList>

            <PaperText preset="title" as="h3" id="start-up">Rebuild the state in onInit</PaperText>
            <PaperText preset="body" as="p">
                The state lives in memory. The service starts from <PaperCode>state</PaperCode> every time it starts: when Paperboard starts, after a crash, after an update, and on every restart.
                <PaperCode>onInit</PaperCode> runs before the service reports ready, and is where it reads back what it saved.
            </PaperText>
            <PaperTextList>
                <li>Catch what fails in <PaperCode>onInit</PaperCode> and put the reason in the state, as Weather does with <PaperCode>loadError</PaperCode>. The service keeps running and the page shows why. An <PaperCode>onInit</PaperCode> that throws never reports ready, so the daemon stops the service after 20 seconds and the page can't show the panel.</li>
                <li>A service that has not reported ready within 20 seconds is stopped and marked failed. Start long work, such as Weather's first check, without awaiting it: <PaperCode>void refreshAll(ctx)</PaperCode>.</li>
                <li>Timers go here too. Weather's <PaperCode>setInterval</PaperCode> keeps checking with no window open.</li>
            </PaperTextList>

            <PaperText preset="title" as="h3" id="save">Save first, then show</PaperText>
            <PaperText preset="body" as="p">
                What must outlive a restart goes to <PaperLink href="/docs/paperapi/config/">configApi</PaperLink>, the panel's settings document.
                <PaperCode>saveSettings</PaperCode> awaits <PaperCode>configApi.set</PaperCode> before it changes the state. When the save fails, the action fails with the reason and the window still shows what is on disk.
                Make the service the only code that writes the document. Pages and widgets ask it to, through an action.
            </PaperText>

            <PaperText preset="title" as="h3" id="background-work">Work in the background</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>refreshCity</PaperCode> runs on a timer, so no person is waiting for its answer.
                It catches every failure, logs it, and puts the reason in <PaperCode>failures</PaperCode>, where the page shows it next to the city.
                A failure that only reaches the log is a failure nobody sees. See <PaperLink href="/docs/developers/errors/">Show every failure</PaperLink>.
                Give every <PaperCode>fetch</PaperCode> a timeout with <PaperCode>AbortSignal.timeout</PaperCode>, so a site that never answers can't hold the work up forever.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="mirror-on-the-page">Mirror the state on the page</PaperText>
            <PaperText preset="body" as="p">
                The page makes one bridge when it loads and keeps the state in a Solid signal.
                Weather keeps both in <PaperCode>src/weather.ts</PaperCode>, so every page of the panel imports the same ones:
            </PaperText>
            <PaperCode block language="tsx">{WEATHER_TS}</PaperCode>
            <PaperText preset="body" as="p">
                Read <PaperCode>weather()</PaperCode> wherever the page shows state, and it updates on every patch:
            </PaperText>
            <PaperCode block language="tsx">{PAGE_USE}</PaperCode>
            <PaperTextList>
                <li>Make the bridge at module level, not inside a component. Paperboard waits for the bridges a page makes as it loads before it shows the panel, and shows the failure in place of the panel when one can't reach the service.</li>
                <li>The page changes state only by calling an action, with <PaperCode>{"bridge.call(\"follow-city\", { city })"}</PaperCode>. The service's <PaperCode>setState</PaperCode> then reaches every window, including the one that called.</li>
                <li><PaperCode>bridge.call</PaperCode> rejects with the message the action threw. Show it. See <PaperLink href="/docs/developers/errors/">Show every failure</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="programs">Run other programs</PaperText>
            <PaperText preset="body" as="p">
                A service that runs a server or a bot starts it with <PaperLink href="/docs/paperapi/process/">processApi</PaperLink>.
                Those programs are not the service's children: they keep running when the service restarts or crashes, and when Paperboard restarts.
                So in <PaperCode>onInit</PaperCode>, check <PaperCode>processApi.exists</PaperCode> with the program's id before starting it. Starting an id that is running fails.
                Subscribe to a running program's output with <PaperCode>processApi.onData</PaperCode>, or call <PaperCode>processApi.attach</PaperCode>, and the restarted service sees its output again.
                Installing or updating the panel stops every program it started.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="sleep">Let it sleep</PaperText>
            <PaperText preset="body" as="p">
                A service is a whole program kept running, and most of the time most services have nothing to do.
                Call <PaperCode>ctx.setIdle(true)</PaperCode> whenever yours has no program to watch, no timer due and no connection to keep, and <PaperCode>ctx.setIdle(false)</PaperCode> the moment that changes.
                After 2 quiet minutes Paperboard stops an idle service and starts it again for the next call, with its actions listed the whole time.
                It starts from nothing then, so keep what it knows in the panel's config or files, not only in memory.
                A service that never says it is idle is never stopped this way. The details are on the <PaperLink href="/docs/paperapi/service/#lifecycle">service reference</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="backups">Backups</PaperText>
            <PaperText preset="body" as="p">
                A backup of the panel is one archive of its config and its files folder, copied while its service is stopped.
                A service that holds data in memory writes it out in <PaperCode>beforeBackup</PaperCode>. A service that runs a program that writes files makes it save and stop writing there, as the Game Servers panel does with a running game server.
                Weather saves on every change and writes no files, so it needs neither hook.
                The hooks and their limits are on the <PaperLink href="/docs/paperapi/service/#lifecycle">service reference</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="check-it">Check it</PaperText>
            <PaperCode block language="sh">
{`bun run build
bunx paperapi restart
bunx paperapi call dev.example.weather follow-city '{"city":"Oslo"}'
bunx paperapi call dev.example.weather __getState`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The last command prints the service's whole state, with Oslo in <PaperCode>settings.cities</PaperCode>.
                Run <PaperCode>bunx paperapi restart</PaperCode> and print the state again: Oslo is still there, read back from config by <PaperCode>onInit</PaperCode>.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/ui/">design the interface</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
