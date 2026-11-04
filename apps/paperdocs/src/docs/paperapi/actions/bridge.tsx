import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function BridgeApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">createPanelBridge</PaperText>
            <PaperText preset="body" as="p">
                createPanelBridge connects a panel page or widget to its own service: it keeps a copy of the service's state and calls the service's actions.
                Create one in the panel's interface wherever it shows what the <PaperLink href="/docs/paperapi/service/">service</PaperLink> holds.
                The bridge works on a panel page and in a widget. A service has no bridge: it owns the state.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { createPanelBridge } from "@mileniumhq/paperapi";
import { PaperButton, PaperFlex, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { createSignal, onCleanup, Show } from "solid-js";

interface WeatherState {
    lastCity: string;
}

interface Forecast {
    city: string;
    high: number;
    low: number;
}

interface WeatherActions {
    forecast(inputs: { city: string }): Promise<Forecast>;
}

export function WeatherView() {
    const bridge = createPanelBridge<WeatherState, WeatherActions>({
        defaultState: { lastCity: "" },
    });
    const [state, setState] = createSignal(bridge.getState());
    const [forecast, setForecast] = createSignal<Forecast>();
    const [failure, setFailure] = createSignal("");

    const stop = bridge.onStateChange((_patch, full) => setState(full));
    onCleanup(() => {
        stop();
        bridge.dispose();
    });

    const load = async () => {
        setFailure("");
        try {
            setForecast(await bridge.actions.forecast({ city: "Lisbon" }));
        } catch (err) {
            setFailure(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <PaperFlex direction="column" gap="full">
            <PaperText preset="body">Last city: {state().lastCity || "none yet"}</PaperText>
            <Show when={forecast()}>
                {(f) => <PaperText preset="body">{f().city}: {f().high}° / {f().low}°</PaperText>}
            </Show>
            <Show when={failure()}>
                <PaperQuote variant="danger" icon="error" title="No forecast" onDismiss={() => setFailure("")}>
                    {failure()}
                </PaperQuote>
            </Show>
            <PaperButton variant="primary" onClick={load}>Get forecast</PaperButton>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`function createPanelBridge<
    TState extends Record<string, any> = Record<string, any>,
    TActions extends Record<string, (...args: any[]) => Promise<any>> = Record<string, (...args: any[]) => Promise<any>>,
>(options?: PanelBridgeOptions<TState>): PanelBridge<TState, TActions>;

interface PanelBridgeOptions<TState> {
    /** defaults to getPanelId(), the panel the page belongs to */
    panelId?: string;
    /** the state before the first answer from the service; defaults to {} */
    defaultState?: TState;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>Type</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>panelId</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The panel whose service the bridge talks to.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getState()</PaperCode></td>
                        <td><PaperCode>TState</PaperCode></td>
                        <td>The bridge's copy of the state. It starts as <PaperCode>defaultState</PaperCode> and changes as the service sends patches.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStateChange(cb)</PaperCode></td>
                        <td><PaperCode>(cb: (patch: Partial&lt;TState&gt;, full: TState) =&gt; void) =&gt; () =&gt; void</PaperCode></td>
                        <td>Calls <PaperCode>cb</PaperCode> after every patch and every refresh, with what changed and the whole copy. Returns the function that stops it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>refreshState()</PaperCode></td>
                        <td><PaperCode>() =&gt; Promise&lt;TState&gt;</PaperCode></td>
                        <td>Asks the service for its whole state, merges it into the copy and resolves with the copy. Rejects with the call's error, such as a service that is not running.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getStatus()</PaperCode></td>
                        <td><PaperCode>() =&gt; {"{ ready: boolean; error?: string }"}</PaperCode></td>
                        <td>The result of the last refresh: <PaperCode>ready</PaperCode> is true when it succeeded, and <PaperCode>error</PaperCode> holds its message when it failed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td><PaperCode>TActions</PaperCode></td>
                        <td>A proxy: <PaperCode>bridge.actions.forecast(inputs, options)</PaperCode> is <PaperCode>actionsApi.call(panelId, "forecast", inputs, options)</PaperCode>. Any name works, so a misspelled one rejects at call time with <PaperCode>not registered or unavailable</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>call(name, inputs?, options?)</PaperCode></td>
                        <td><PaperCode>&lt;R&gt;(actionName: string, ...args: any[]) =&gt; Promise&lt;R&gt;</PaperCode></td>
                        <td>The same call by name. <PaperCode>options</PaperCode> is an <PaperLink href="/docs/paperapi/actions/#calling">ActionCallOptions</PaperLink>, for a longer timeout.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>dispose()</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Stops listening for patches and drops every callback. Call it when the component that made the bridge goes away.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="state-sync">State sync</PaperText>
            <PaperTextList ordered>
                <li>On creation, the bridge subscribes to the service's <PaperCode>__stateChanged</PaperCode> event and asks for the whole state with the internal <PaperCode>__getState</PaperCode> action.</li>
                <li>Each <PaperCode>setState</PaperCode> in the service arrives as a patch. The bridge merges it into its copy, one level deep, and calls every <PaperCode>onStateChange</PaperCode> callback.</li>
                <li>The copy is not a reactive store. Each merge replaces it with a new object, so put <PaperCode>full</PaperCode> into a signal from <PaperCode>onStateChange</PaperCode>, as the sample does, for the page to update.</li>
                <li>Patches sent while the page was disconnected are lost. After a reconnect, call <PaperCode>refreshState()</PaperCode> to catch up.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="readiness">Readiness</PaperText>
            <PaperText preset="body" as="p">
                Before the shell shows a panel with a service, it waits for the service to answer and for every bridge the page made to refresh.
                A bridge whose first refresh fails makes the shell show the failure in place of the panel. Create bridges when the page loads, so they take part.
                See <PaperLink href="/docs/paperapi/connection/#readiness">Readiness</PaperLink> for the whole sequence.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>Too many panel bridges; dispose unused bridges</PaperCode></td>
                        <td>The page holds 128 bridges. Thrown by <PaperCode>createPanelBridge</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Action "&lt;name&gt;" on panel "&lt;id&gt;" is not registered or unavailable</PaperCode></td>
                        <td>The service is not running, has not registered the action yet, or the name is wrong.</td>
                    </tr>
                    <tr>
                        <td>The action's own message</td>
                        <td>The service's handler threw. The call rejects with the same text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperCrane 'actions:call' timed out</PaperCode></td>
                        <td>The action ran longer than the call's timeout, 30 seconds unless <PaperCode>timeoutMs</PaperCode> says otherwise.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The first refresh's failure is logged to the console at debug level and kept in <PaperCode>getStatus().error</PaperCode>. Read it there to show why the state is missing.
            </PaperText>
        </PaperFlex>
    );
}
