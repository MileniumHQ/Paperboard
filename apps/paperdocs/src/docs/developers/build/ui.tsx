import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const APP_TSX = `import { createSignal } from "solid-js";
import { PaperInterfaceGroup, PaperInterfaceItem, PaperMenu, PaperMenuItem, PaperPanel } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import ForecastPage from "./pages/ForecastPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
    const [tab, setTab] = createSignal("forecast");

    return (
        <PaperPanel>
            <PaperMenu name="weather-menu" value={tab()} onValueChange={(value) => setTab(String(value))}>
                <PaperMenuItem value="forecast" icon="partly_cloudy_day">
                    Forecast
                </PaperMenuItem>
                <PaperMenuItem value="settings" icon="settings">
                    Settings
                </PaperMenuItem>
            </PaperMenu>
            <PaperInterfaceGroup value={tab()}>
                <PaperInterfaceItem value="forecast">
                    <ForecastPage openSettings={() => setTab("settings")} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="settings">
                    <SettingsPage />
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}`;

const FORECAST_PAGE = `import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperEmptyState,
    PaperFlex,
    PaperGrid,
    PaperInput,
    PaperPage,
    PaperPageHeader,
    PaperQuote,
    PaperStatTile,
} from "@mileniumhq/paperui";
import { bridge, errorMessage, weather } from "../weather";

export default function ForecastPage(props: { openSettings: () => void }) {
    const [city, setCity] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [failure, setFailure] = createSignal("");

    const follow = async () => {
        setBusy(true);
        setFailure("");
        try {
            await bridge.call<boolean>("follow-city", { city: city() });
            setCity("");
        } catch (err) {
            setFailure(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const unit = () => (weather().settings.units === "metric" ? "°C" : "°F");

    return (
        <PaperPage>
            <PaperPageHeader icon="partly_cloudy_day" title="Forecast" subtitle="Checked every 15 minutes" />
            <Show when={weather().loadError}>
                {(message) => (
                    <PaperQuote variant="danger" icon="warning" title="Settings could not be read" role="alert">
                        {message()}
                    </PaperQuote>
                )}
            </Show>
            <Show
                when={weather().hasKey}
                fallback={
                    <PaperEmptyState icon="key" title="No API key yet" description="Weather needs an OpenWeather API key to check the weather.">
                        <PaperButton variant="primary" onClick={() => props.openSettings()}>
                            Add API key
                        </PaperButton>
                    </PaperEmptyState>
                }
            >
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperInput
                        label="City"
                        value={city()}
                        onInput={(e) => setCity(e.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void follow();
                        }}
                    />
                    <PaperButton disabled={busy()} onClick={() => void follow()}>
                        Follow
                    </PaperButton>
                </PaperFlex>
                <Show when={failure()}>
                    <PaperQuote variant="danger" icon="warning" title="City not added" role="alert" onDismiss={() => setFailure("")}>
                        {failure()}
                    </PaperQuote>
                </Show>
                <PaperGrid min="field">
                    <For each={weather().settings.cities}>
                        {(name) => (
                            <Show
                                when={weather().forecasts[name]}
                                fallback={<PaperStatTile icon="cloud_off" label={name} value="No reading" tone="danger" />}
                            >
                                {(forecast) => (
                                    <PaperStatTile
                                        icon="thermostat"
                                        label={name}
                                        value={\`\${Math.round(forecast().temperature)}\${unit()}\`}
                                    />
                                )}
                            </Show>
                        )}
                    </For>
                </PaperGrid>
                <For each={Object.entries(weather().failures)}>
                    {([name, message]) => (
                        <PaperQuote variant="danger" icon="warning" title={\`\${name} not checked\`}>
                            {message}
                        </PaperQuote>
                    )}
                </For>
            </Show>
        </PaperPage>
    );
}`;

const REMOVE_MODAL = `<PaperModal
    open={confirmRemove()}
    onClose={() => setConfirmRemove(false)}
    title="Remove the API key"
    size="small"
    footer={
        <>
            <PaperButton variant="text" onClick={() => setConfirmRemove(false)}>Cancel</PaperButton>
            <PaperButton variant="danger" onClick={() => void removeKey()}>
                Remove
            </PaperButton>
        </>
    }
>
    <PaperText preset="body" as="p">
        Weather stops checking the weather until you add a key again.
    </PaperText>
</PaperModal>`;

export default function UiGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Design the interface</PaperText>
            <PaperText preset="body" as="p">
                A panel's interface is built from PaperUI templates and components, with no CSS of its own.
                This guide lays out the Weather example panel: a menu with two pages, a form, a grid of readings, a settings list and a confirm dialog.
                At the end, the panel looks and behaves like the panels that ship with Paperboard, on a computer and on a phone.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel with a service, as in <PaperLink href="/docs/developers/services/">Services and state</PaperLink>.
                The page reads the service's state through <PaperCode>weather()</PaperCode> from <PaperCode>src/weather.ts</PaperCode>, shown there.
                Every component used here has its own page in the <PaperLink href="/docs/paperui/overview/">PaperUI</PaperLink> reference.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="rules">The rules</PaperText>
            <PaperTextList>
                <li>Build from PaperUI components and their props. Spacing, sizes and colors are tokens passed as props: <PaperCode>gap="half"</PaperCode>, <PaperCode>min="field"</PaperCode>, <PaperCode>variant="danger"</PaperCode>.</li>
                <li>Write no inline styles and no pixel or rem values. The scaffolded <PaperCode>test/uiStandards.test.ts</PaperCode> fails on a <PaperCode>style=</PaperCode> prop or a style write.</li>
                <li>When a token has to appear in code, such as a color handed to a library that draws on a canvas, read it with <PaperLink href="/docs/paperui/utilities/#getvarcss">getVarCss</PaperLink>: <PaperCode>getVarCss("primary")</PaperCode>. Never write <PaperCode>var(--paper-primary)</PaperCode> yourself.</li>
                <li>When a screen needs something no component does, give it a CSS module that uses the tokens, and tell the PaperUI maintainers what is missing. Never copy a component to restyle it.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/design-language/">Design language</PaperLink> explains the look these components share.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="the-frame">The frame: a menu and its pages</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> holds a <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> and a <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink>.
                The menu's value picks which <PaperCode>PaperInterfaceItem</PaperCode> shows. Weather's <PaperCode>src/App.tsx</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">{APP_TSX}</PaperCode>
            <PaperTextList>
                <li>On a computer, the menu sits beside the pages. On a phone, the menu fills the panel and each entry opens as a page with a back button. The panel gets both from <PaperCode>PaperPanel</PaperCode>; see <PaperLink href="/docs/paperui/paperpanel/#phone">Phone layout</PaperLink>.</li>
                <li>Keep the tab in a signal when another part of the page switches it. Weather's empty state opens Settings with <PaperCode>setTab("settings")</PaperCode>.</li>
                <li>Import <PaperCode>@mileniumhq/paperui/style.css</PaperCode> and <PaperCode>@mileniumhq/paperui/panel.css</PaperCode> once, in the file that renders the panel. The scaffolded <PaperCode>src/index.tsx</PaperCode> mounts it inside <PaperCode>PaperProvider</PaperCode>, which gives the panel its full height.</li>
                <li>A panel with one screen needs no menu: render the page alone inside <PaperCode>PaperPanel</PaperCode>.</li>
                <li>Paperboard unloads a panel's page once it has been out of view for 15 minutes, and loads it again when the person comes back. Keep what must survive in the service or the panel's config, not only in the window.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="a-page">A page</PaperText>
            <PaperText preset="body" as="p">
                Each entry is a <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink> that starts with a <PaperLink href="/docs/paperui/paperpageheader/">PaperPageHeader</PaperLink>.
                Weather's Forecast page has a form to follow a city, a grid of readings, and the failures:
            </PaperText>
            <PaperCode block language="tsx">{FORECAST_PAGE}</PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Part of the page</th>
                        <th>Component</th>
                        <th>Why</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Nothing to show yet</td><td><PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink></td><td>Says what is missing and offers the one button that fixes it.</td></tr>
                    <tr><td>A row of fields and a button</td><td><PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink> with <PaperCode>direction="row"</PaperCode></td><td><PaperCode>align="center"</PaperCode> lines the button up with the field.</td></tr>
                    <tr><td>Text input</td><td><PaperLink href="/docs/paperui/paperinput/">PaperInput</PaperLink></td><td>The <PaperCode>label</PaperCode> names the field. The sample also follows the city on Enter.</td></tr>
                    <tr><td>One number per thing</td><td><PaperLink href="/docs/paperui/paperstattile/">PaperStatTile</PaperLink> in a <PaperLink href="/docs/paperui/papergrid/">PaperGrid</PaperLink></td><td>The grid fits as many tiles in a row as the width allows.</td></tr>
                    <tr><td>A failure</td><td><PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> with <PaperCode>variant="danger"</PaperCode></td><td>Shows where the person was looking, with the reason. See <PaperLink href="/docs/developers/errors/">Show every failure</PaperLink>.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The button is disabled while the call runs, so a second press can't follow the city twice.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="settings">A settings page</PaperText>
            <PaperText preset="body" as="p">
                Put settings in a <PaperLink href="/docs/paperui/papersettinglist/">PaperSettingList</PaperLink>, one <PaperCode>PaperSettingItem</PaperCode> each, with a title, a short description and its control on the right.
                Weather's settings page is on <PaperLink href="/docs/developers/settings-and-secrets/#the-page">Settings and secrets</PaperLink>.
                Weather applies the units as soon as they are picked, with no Save button for the page.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="confirm">Ask before something can't be undone</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>alert</PaperCode>, <PaperCode>confirm</PaperCode> and <PaperCode>prompt</PaperCode> do nothing in a panel: the page's frame blocks them. Ask with a <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>.
                Weather asks before it removes the API key. The Remove button sets <PaperCode>confirmRemove</PaperCode>, and the modal sits at the end of the settings page:
            </PaperText>
            <PaperCode block language="tsx">{REMOVE_MODAL}</PaperCode>
            <PaperTextList>
                <li>The modal is always mounted and opens through <PaperCode>open</PaperCode>. Never put it inside <PaperCode>Show</PaperCode>; the scaffolded UI test fails when one is.</li>
                <li>The title names what happens, and the text says what changes afterwards.</li>
                <li>The confirm button says what it does. A confirm that deletes or removes is <PaperCode>variant="danger"</PaperCode>, and Cancel is <PaperCode>variant="text"</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="check-it">Check it</PaperText>
            <PaperTextList>
                <li><PaperCode>bun test</PaperCode> runs the UI standards test with the others.</li>
                <li>Build, then right-click the panel in Paperboard's list and choose Restart Panel to load the new page.</li>
                <li>Try the page in the light and the dark theme, and make the window narrow: below 520 pixels, <PaperCode>PaperPanel</PaperCode> takes the phone layout.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/errors/">show every failure</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
