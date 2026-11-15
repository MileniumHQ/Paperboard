import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const PANEL_TS = `// src/panel.ts: the contract, in a file the page and the service both
// import. It runs in the browser and in Node, so it imports neither.
import { defineContract, shape, type Infer } from "@mileniumhq/paperapi";

export const PANEL_ID = "dev.example.weather";

const forecast = shape.object({
    city: shape.text(),
    high: shape.number(),
    low: shape.number(),
});
export type Forecast = Infer<typeof forecast>;

export const weatherContract = defineContract(PANEL_ID, {
    calls: {
        /** today's high and low in a city */
        forecast: { input: shape.object({ city: shape.text() }), output: forecast },
        /** forgets the cities asked about */
        clearRecent: { output: shape.nothing() },
    },
    events: {
        /** a window read a forecast */
        forecastRead: forecast,
    },
    state: {
        shape: shape.object({ recent: shape.list(shape.text()) }),
        initial: { recent: [] },
    },
});`;

const SERVICE_TS = `// src/service.ts: one handler for each call of the contract
import { definePanelService } from "@mileniumhq/paperapi";
import { readForecast } from "./lib/openWeather";
import { weatherContract } from "./panel";

export default definePanelService({
    // the panel's id and its state come with the contract
    contract: weatherContract,
    calls: {
        // input is { city: string }, checked before this runs
        forecast: async ({ city }, ctx) => {
            const name = city.trim();
            if (!name) throw new Error("Enter a city name");
            const today = await readForecast(name);
            ctx.setState((prev) => ({ recent: [name, ...prev.recent.filter((c) => c !== name)].slice(0, 5) }));
            ctx.emit("forecastRead", today);
            return today;
        },
        clearRecent: (_input, ctx) => {
            ctx.setState({ recent: [] });
        },
    },
});`;

const PAGE_TSX = `// src/ForecastView.tsx: the page's client, made from the same contract
import { errorMessage, serviceClient } from "@mileniumhq/paperapi";
import { PaperButton, PaperFlex, PaperInput, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { createSignal, onCleanup, Show } from "solid-js";
import { weatherContract, type Forecast } from "./panel";

// made, and its state read, as the page loads: the shell waits for the
// state before it shows the panel
const weather = serviceClient(weatherContract);
const [state, setState] = createSignal(weather.state.current());
weather.state.subscribe((full) => setState(full));

export function ForecastView() {
    const [city, setCity] = createSignal("");
    const [forecast, setForecast] = createSignal<Forecast>();
    const [failure, setFailure] = createSignal("");

    // a forecast any window read, this one included
    const off = weather.events.forecastRead((read) => setForecast(read));
    onCleanup(off);

    const look = async () => {
        setFailure("");
        try {
            // the answer is a Forecast; the event above hears it too
            await weather.calls.forecast({ city: city() });
        } catch (err) {
            setFailure(errorMessage(err));
        }
    };

    return (
        <PaperFlex direction="column" gap="full">
            <PaperInput label="City" value={city()} onInput={(e) => setCity(e.currentTarget.value)} />
            <PaperButton variant="primary" onClick={() => void look()}>Get forecast</PaperButton>
            <Show when={forecast()}>
                {(f) => <PaperText preset="body">{f().city}: {f().high}° / {f().low}°</PaperText>}
            </Show>
            <PaperText preset="body">Recent: {state().recent.join(", ") || "none yet"}</PaperText>
            <Show when={failure()}>
                <PaperQuote variant="danger" icon="error" title="No forecast" role="alert" onDismiss={() => setFailure("")}>
                    {failure()}
                </PaperQuote>
            </Show>
        </PaperFlex>
    );
}`;

const SCOPE_TS = `// every call is about one server; a page makes its client for it
export const consoleContract = defineContract(PANEL_ID, {
    scope: { server: shape.text() },
    calls: {
        send: { input: shape.object({ command: shape.text() }), output: shape.nothing() },
        players: { output: shape.list(shape.text()) },
    },
});

// the page
const lobby = serviceClient(consoleContract, { server: "lobby" });
await lobby.calls.send({ command: "say hi" });
const online = await lobby.calls.players();

// the service: the scope's values come third
calls: {
    send: async ({ command }, ctx, { server }) => runCommand(server, command),
    players: async (_input, ctx, { server }) => listPlayers(server),
},`;

export default function ContractApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">defineContract</PaperText>
            <PaperText preset="body" as="p">
                A contract is what a panel's page and its own <PaperLink href="/docs/paperapi/service/">service</PaperLink> agree on: each call's input and answer, each event's payload, and the state the service keeps.
                It is written once, in a file both import. The page gets a typed client from it with <PaperCode>serviceClient</PaperCode>, with no names as strings and no casts. The service gives one handler for each call.
                Every input is checked against its shape before its handler runs, and every answer, event and state change before it leaves the service.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                A whole Weather panel: the contract, the service that answers it, and the page that uses it.
            </PaperText>
            <PaperCode block language="tsx">{PANEL_TS}</PaperCode>
            <PaperCode block language="tsx">{SERVICE_TS}</PaperCode>
            <PaperCode block language="tsx">{PAGE_TSX}</PaperCode>
            <PaperTextList>
                <li>A name the contract doesn't have, such as <PaperCode>weather.calls.forcast</PaperCode>, is a type error, and nothing at run time.</li>
                <li>A handler missing for a call, or one for a call the contract doesn't have, throws when the service is defined.</li>
                <li>The contract file runs in the browser and in Node. Keep it to shapes and types.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="shapes">Shapes</PaperText>
            <PaperText preset="body" as="p">
                A value travels as JSON, so a shape is one of JSON's: text, numbers, true or false, lists, objects and nothing.
                <PaperCode>{"Infer<typeof s>"}</PaperCode> is the TypeScript type a shape describes. Write a shape once and take its type from it, as the sample does with <PaperCode>Forecast</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Shape</th>
                        <th>Type</th>
                        <th>Accepts</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>shape.text()</PaperCode></td><td><PaperCode>string</PaperCode></td><td>Any string, the empty one included. Check what the text must be in the handler.</td></tr>
                    <tr><td><PaperCode>shape.number()</PaperCode></td><td><PaperCode>number</PaperCode></td><td>A finite number.</td></tr>
                    <tr><td><PaperCode>shape.boolean()</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td><PaperCode>true</PaperCode> or <PaperCode>false</PaperCode>.</td></tr>
                    <tr><td><PaperCode>shape.json()</PaperCode></td><td><PaperCode>unknown</PaperCode></td><td>Any JSON value, read by its receiver: a saved document whose own reader checks it.</td></tr>
                    <tr><td><PaperCode>shape.read(reader)</PaperCode></td><td><PaperCode>T</PaperCode>, what <PaperCode>reader</PaperCode> returns</td><td>A value <PaperCode>reader</PaperCode> doesn't throw for. Its thrown message is the problem. The value travels as it was given; what the reader returns is not used.</td></tr>
                    <tr><td><PaperCode>shape.nothing()</PaperCode></td><td><PaperCode>void</PaperCode></td><td>What a call that gives nothing back answers. The page gets <PaperCode>undefined</PaperCode>.</td></tr>
                    <tr><td><PaperCode>shape.oneOf(...values)</PaperCode></td><td>The union of the values</td><td>Exactly one of the listed texts, numbers or booleans: <PaperCode>shape.oneOf("metric", "imperial")</PaperCode>.</td></tr>
                    <tr><td><PaperCode>shape.list(item)</PaperCode></td><td><PaperCode>T[]</PaperCode></td><td>A list whose every item fits <PaperCode>item</PaperCode>.</td></tr>
                    <tr><td><PaperCode>shape.object(fields)</PaperCode></td><td>The object of its fields</td><td>An object with every field that is not optional. A call's input refuses a field it doesn't name; an answer, an event or the state may carry more.</td></tr>
                    <tr><td><PaperCode>shape.optional(inner)</PaperCode></td><td><PaperCode>T | undefined</PaperCode>, an optional field</td><td>Only inside <PaperCode>shape.object</PaperCode>: a field that may be left out.</td></tr>
                    <tr><td><PaperCode>shape.record(entry)</PaperCode></td><td><PaperCode>{"Record<string, T>"}</PaperCode></td><td>An object of text keys, each to a value that fits <PaperCode>entry</PaperCode>.</td></tr>
                    <tr><td><PaperCode>shape.nullable(inner)</PaperCode></td><td><PaperCode>T | null</PaperCode></td><td>The value, or <PaperCode>null</PaperCode>. A field that is <PaperCode>null</PaperCode> must still be there.</td></tr>
                    <tr><td><PaperCode>shape.either(...shapes)</PaperCode></td><td>The union of their types</td><td>A value that fits one of the shapes, tried in order.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`function defineContract(panelId: string, definition: ContractDefinition): PanelContract;

interface ContractDefinition {
    /** fields every call carries, given once when the page makes its client */
    scope?: Record<string, Shape | OptionalShape>;
    calls?: Record<string, CallDefinition>;
    /** what the service tells its page, each with its payload's shape */
    events?: Record<string, Shape>;
    /** what the service keeps and every window mirrors, and what it starts as */
    state?: { shape: ObjectShape; initial: Infer<shape> };
}

interface CallDefinition {
    /** an object of fields; left out for a call that takes nothing */
    input?: ObjectShape;
    output: Shape;
    /** milliseconds the page waits for the answer; defaults to 30_000, null waits it out */
    timeoutMs?: number | null;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>What changes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>scope</PaperCode></td>
                        <td>Fields, as in <PaperCode>shape.object</PaperCode></td>
                        <td>No scope</td>
                        <td>Values every call carries, which the page gives once to <PaperCode>serviceClient</PaperCode>. See <PaperLink href="#scope">Scope</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>calls</PaperCode></td>
                        <td><PaperCode>{"Record<string, CallDefinition>"}</PaperCode></td>
                        <td>No calls</td>
                        <td>What the page asks the service. Each is an internal block, <PaperCode>call-&lt;kebab-name&gt;</PaperCode>: never listed, and refused to every other panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>calls.x.input</PaperCode></td>
                        <td><PaperCode>shape.object(...)</PaperCode></td>
                        <td>The call takes nothing</td>
                        <td>The call's input. The page's call takes it, typed; the handler is given it, checked.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>calls.x.output</PaperCode></td>
                        <td>Any shape</td>
                        <td>Required</td>
                        <td>What the call answers. Use <PaperCode>shape.nothing()</PaperCode> for a call that gives nothing back.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>calls.x.timeoutMs</PaperCode></td>
                        <td><PaperCode>number | null</PaperCode></td>
                        <td><PaperCode>30_000</PaperCode></td>
                        <td>How long the page waits for the answer. <PaperCode>null</PaperCode> waits as long as the call takes, for work such as an install.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>events</PaperCode></td>
                        <td><PaperCode>{"Record<string, Shape>"}</PaperCode></td>
                        <td>No events</td>
                        <td>What the service tells its page with <PaperCode>ctx.emit</PaperCode>, by name, with its payload's shape. Each is the internal event <PaperCode>emit-&lt;kebab-name&gt;</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>state</PaperCode></td>
                        <td><PaperCode>{"{ shape: shape.object(...), initial }"}</PaperCode></td>
                        <td>The contract says nothing of the state</td>
                        <td>What the service keeps and every window mirrors. <PaperCode>initial</PaperCode> is what it starts as, checked against <PaperCode>shape</PaperCode> by the type checker and again when the contract is made.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A call or event name is written freely, <PaperCode>clearRecent</PaperCode>, and travels as kebab-case, <PaperCode>call-clear-recent</PaperCode>. It must be letters, digits and dashes once spelled so, at most 59 characters for a call and 58 for an event, and two names may not spell the same.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="service-client">serviceClient</PaperText>
            <PaperCode block language="tsx">
{`function serviceClient(contract: PanelContract, scope?: ScopeValues): ServiceClient;

interface ServiceClient {
    readonly panelId: string;
    /** one function per call: its input in, its answer out */
    readonly calls: { [name]: (input) => Promise<output> };
    /** one subscription per event */
    readonly events: { [name]: (onValue: (payload) => void) => () => void };
    /** the service's state; undefined for a contract that says nothing of it */
    readonly state: ServiceState<State>;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Make a client where the page talks to its service. <PaperCode>scope</PaperCode> is required when the contract has one, and not taken when it doesn't.
                It works on a panel page and in a widget. A service has no client: it answers the contract.
            </PaperText>
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
                        <td>The contract's panel, whose service the client talks to.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>calls.x(input)</PaperCode></td>
                        <td><PaperCode>{"(input: Infer<input>) => Promise<Infer<output>>"}</PaperCode></td>
                        <td>Runs the call and resolves with its answer. A call with no <PaperCode>input</PaperCode> takes no argument. A <PaperCode>shape.nothing()</PaperCode> answer resolves with <PaperCode>undefined</PaperCode>. Rejects with the refusal, or with the message the handler threw.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>events.x(onValue)</PaperCode></td>
                        <td><PaperCode>{"(onValue: (payload: Infer<shape>) => void) => () => void"}</PaperCode></td>
                        <td>Calls <PaperCode>onValue</PaperCode> with the payload each time the service emits the event. Returns the function that stops it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>state</PaperCode></td>
                        <td><PaperCode>{"ServiceState<State>"}</PaperCode></td>
                        <td>The service's state as this window mirrors it. The mirror is made the first time <PaperCode>state</PaperCode> is read, so a client that only calls reads no state.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="service-state">ServiceState</PaperText>
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
                        <td><PaperCode>current()</PaperCode></td>
                        <td><PaperCode>() =&gt; State</PaperCode></td>
                        <td>What is known now: the contract's <PaperCode>initial</PaperCode> until the service's first answer, then the mirrored state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>subscribe(onValue)</PaperCode></td>
                        <td><PaperCode>{"(onValue: (state: State, patch: Partial<State>) => void) => () => void"}</PaperCode></td>
                        <td>Calls <PaperCode>onValue</PaperCode> after every change and every read, with the whole state and what changed. Returns the function that stops it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>refresh()</PaperCode></td>
                        <td><PaperCode>{"() => Promise<State>"}</PaperCode></td>
                        <td>Reads the whole state again and resolves with the mirror. A change that lands while the read is out wins over it. Rejects with the read's error, such as a service that is not running.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>error()</PaperCode></td>
                        <td><PaperCode>{"() => string | null"}</PaperCode></td>
                        <td>Why the last read failed, or <PaperCode>null</PaperCode> once one succeeded.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>dispose()</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Stops mirroring and drops every subscriber. Call it when the component that read <PaperCode>state</PaperCode> goes away, such as a widget Home removes.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="scope">Scope</PaperText>
            <PaperText preset="body" as="p">
                A scope is what every call of a contract is about, such as the server a Game Server page shows. The page gives its values once, when it makes the client, and each call carries them.
                The handler is given them third, beside its own input.
            </PaperText>
            <PaperCode block language="tsx">{SCOPE_TS}</PaperCode>
            <PaperTextList>
                <li>A call's input may not name a field the scope gives. <PaperCode>defineContract</PaperCode> throws when one does.</li>
                <li>The scope's values travel with each call and are checked with its input. A page that needs two servers makes two clients.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="checks">What is checked where</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>What</th>
                        <th>Checked</th>
                        <th>When it doesn't fit</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Names, the scope and the initial state</td><td>By <PaperCode>defineContract</PaperCode>, when the contract is made</td><td>It throws, on the page and in the service alike.</td></tr>
                    <tr><td>Handlers</td><td>By <PaperCode>definePanelService</PaperCode>, when the service is defined</td><td>It throws, so the service fails as it starts.</td></tr>
                    <tr><td>A call's input and the scope's values</td><td>In the service, before the handler runs. A field the shape doesn't name is refused.</td><td>The caller rejects with the refusal, and the handler doesn't run. This holds for every caller, <PaperCode>paperapi call</PaperCode> included.</td></tr>
                    <tr><td>A call's answer</td><td>In the service, before it leaves</td><td>The caller rejects; the page never sees the wrong answer.</td></tr>
                    <tr><td>An event's name and payload</td><td>By <PaperCode>ctx.emit</PaperCode></td><td>It throws where it was emitted, and nothing is sent.</td></tr>
                    <tr><td>A state change</td><td>By <PaperCode>ctx.setState</PaperCode></td><td>It throws where it was made, and the state is unchanged. In a handler, the call rejects with it.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The page's types are the first check, and the service's the one that holds: the page is trusted no more than a person is.
                A shape says what a value is, not what it may be. A city that is only spaces is text; the handler still refuses it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="state-sync">State sync</PaperText>
            <PaperTextList ordered>
                <li>When it is made, the mirror listens for the service's internal <PaperCode>panel-state-changed</PaperCode> event and reads the whole state from its internal <PaperCode>panel-state</PaperCode> value.</li>
                <li>Each <PaperCode>setState</PaperCode> in the service arrives as a patch. The mirror merges it into its copy, one level deep, and calls every subscriber.</li>
                <li>The copy is not a reactive store. Each merge replaces it with a new object, so put it into a signal or a store from <PaperCode>subscribe</PaperCode>, as the sample does, for the page to update.</li>
                <li>Patches sent while the page was disconnected are lost. After a reconnect, call <PaperCode>refresh()</PaperCode> to catch up.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="readiness">Readiness</PaperText>
            <PaperText preset="body" as="p">
                Before the shell shows a panel with a service, it waits for the service to answer and for every state mirror on the page to read the state.
                A mirror whose first read fails makes the shell show the failure in place of the panel.
                A mirror is made the first time a client's <PaperCode>state</PaperCode> is read, so read it as the page loads, as the sample does with <PaperCode>current()</PaperCode>, and it takes part.
                See <PaperLink href="/docs/paperapi/connection/#readiness">Readiness</PaperLink> for the whole sequence.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                Each refusal names the call and where in the value it went wrong: <PaperCode>"text"</PaperCode>, <PaperCode>"split.direction"</PaperCode>, <PaperCode>"sizes[1]"</PaperCode>.
                What it got is said as <PaperCode>number 42</PaperCode>, <PaperCode>the text "many"</PaperCode>, <PaperCode>a list</PaperCode>, <PaperCode>an object</PaperCode> or <PaperCode>nothing</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>The call "addNote" was refused: the field "text": expected text, got number 42</PaperCode></td>
                        <td>A field's value is not its shape. Other shapes say <PaperCode>expected a number</PaperCode>, <PaperCode>expected true or false</PaperCode>, <PaperCode>expected a list</PaperCode>, <PaperCode>expected an object</PaperCode> or <PaperCode>expected "metric" or "imperial"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>The call "addNote" was refused: the field "text" is missing</PaperCode></td>
                        <td>A field that is not optional was left out.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>The call "addNote" was refused: there is no field "pinnd"</PaperCode></td>
                        <td>The input names a field its shape doesn't.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>The call "clearRecent" was refused: it takes no input, got an object</PaperCode></td>
                        <td>A call without <PaperCode>input</PaperCode> was given one.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"The call \"x\" answered what its contract doesn't say: <problem>"}</PaperCode></td>
                        <td>The handler returned what <PaperCode>output</PaperCode> doesn't allow.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"[Service:<id>] The state was not changed: <problem>"}</PaperCode></td>
                        <td><PaperCode>setState</PaperCode> was given a value the state's shape doesn't allow.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"[Service:<id>] The state has no field \"<key>\""}</PaperCode></td>
                        <td><PaperCode>setState</PaperCode> was given a field the state's shape doesn't name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"[Service:<id>] The contract has no event \"<name>\""}</PaperCode></td>
                        <td><PaperCode>ctx.emit</PaperCode> was given a name the contract's <PaperCode>events</PaperCode> doesn't have.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"[Service:<id>] The event \"<name>\" was not sent: <problem>"}</PaperCode></td>
                        <td>The payload is not the event's shape.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"The initial state of <id>'s contract is wrong: <problem>"}</PaperCode></td>
                        <td><PaperCode>state.initial</PaperCode> is not <PaperCode>state.shape</PaperCode>. Thrown by <PaperCode>defineContract</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"The calls \"renameTab\" and \"rename-tab\" of <id> share the name call-rename-tab"}</PaperCode></td>
                        <td>Two calls, or two events, spell the same once in kebab-case. Thrown by <PaperCode>defineContract</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"The call \"kick\" of <id> names \"server\", which its scope already gives"}</PaperCode></td>
                        <td>A call's input repeats a scope field. Thrown by <PaperCode>defineContract</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"The service call \"<name>\" can't be named: use letters, digits and dashes, at most 59 characters"}</PaperCode></td>
                        <td>A name that can't be a block id. Thrown by <PaperCode>defineContract</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>{"[Service:<id>] the call \"<name>\" has no handler"}</PaperCode>, <PaperCode>{"[Service:<id>] \"<name>\" is not a call of its contract"}</PaperCode></td>
                        <td>The service's <PaperCode>calls</PaperCode> don't match the contract's. Thrown by <PaperCode>definePanelService</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Block "command.call-&lt;name&gt;" on panel "&lt;id&gt;" is not registered or unavailable</PaperCode></td>
                        <td>The service is not running, or has not registered its calls yet.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Block call "&lt;id&gt;:command.call-&lt;name&gt;" timed out after 30000ms</PaperCode></td>
                        <td>The call ran longer than its <PaperCode>timeoutMs</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>The handler's own message</td>
                        <td>The handler threw. The caller rejects with the same text, so throw sentences the person using the panel can act on.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Too many state mirrors on this page; dispose the ones no longer shown</PaperCode></td>
                        <td>The page holds 128 state mirrors. Thrown by the first read of a client's <PaperCode>state</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A mirror's first read that fails is logged to the console and kept in <PaperCode>state.error()</PaperCode>. Read it there to show why the state is missing.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="deprecated">Deprecated</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>serviceApi.call</PaperCode> and <PaperCode>serviceApi.on</PaperCode>, and <PaperCode>createPanelBridge</PaperCode>'s <PaperCode>call</PaperCode>, <PaperCode>calls</PaperCode> and <PaperCode>on</PaperCode>, reach a service by names as strings, with nothing checked.
                They are removed once Game Server and Agents use the contract. Don't use them in new code.
            </PaperText>
        </PaperFlex>
    );
}
