import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ServiceApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">definePanelService</PaperText>
            <PaperText preset="body" as="p">
                definePanelService is the entry point of a panel's service: it answers the panel's page, holds its state, and tells the daemon it is ready.
                The Paperboard server daemon runs the service as a background process that keeps going while the Paperboard window is closed.
                Give a panel a service when it owns something long-lived: a server, a bot, a schedule, a connection.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Name the built file in the manifest's <PaperCode>service</PaperCode> field, such as <PaperCode>./dist/service.js</PaperCode>, and call <PaperCode>definePanelService</PaperCode> once at its top level.
            </PaperText>
            <PaperCode block language="tsx">
{`import { blocksApi, definePanelService, secretsApi } from "@mileniumhq/paperapi";
import { PANEL_ID, weatherContract } from "./panel";

const service = definePanelService({
    // the calls, events and state the page and the service agree on
    contract: weatherContract,
    // one handler per call of the contract: weather.calls.forecast({ city: "Oslo" }) on the page
    calls: {
        forecast: async ({ city }, ctx) => {
            const key = await secretsApi.get("apiKey", PANEL_ID);
            if (!key.found) throw new Error("Add an API key in the Weather panel first");
            if (!city.trim()) throw new Error("Enter a city name");
            const today = { city, high: 21, low: 12 };
            ctx.setState((prev) => ({ recent: [city, ...prev.recent].slice(0, 5) }));
            ctx.emit("forecastRead", today);
            return today;
        },
        clearRecent: (_input, ctx) => {
            ctx.setState({ recent: [] });
        },
    },
    onInit: async (ctx) => {
        // what the Blocks panel, agents and other panels can use
        await blocksApi.panel(PANEL_ID).register({
            commands: [{
                id: "get-forecast",
                name: "Get Forecast",
                description: "Returns today's high and low for a city",
                inputs: { city: { type: "text", name: "City", maxLength: 64 } },
                output: "any",
                outputName: "Forecast",
                run: ({ city }: { city: string }) => ({ city, high: 21, low: 12 }),
            }],
        });
        console.log(\`Weather service ready, recent cities: \${ctx.state.recent.join(", ") || "none"}\`);
    },
});

export default service;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>weatherContract</PaperCode> is the one on <PaperLink href="/docs/paperapi/bridge/#usage">Contract API</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`function definePanelService<TState, C extends PanelContract>(
    options: DefinePanelServiceOptions<TState, C>,
): {
    panelId: string;
    /** resolves once the service's own blocks are registered and onInit has finished */
    ready: Promise<void>;
    ctx: ContractContext<C, TState>;
    getState(): State;
    setState(patchOrUpdater: Partial<State> | ((prev: State) => Partial<State>)): void;
};

/** the handlers of a contract's calls, to type them in a file of their own */
type CallHandlers<C> = { [call]: (input, ctx: ContractContext<C>, scope) => output | Promise<output> };
/** what handlers and hooks are given: the contract's state and events */
type ContractContext<C, TState = Record<string, any>> = ServiceContext<State, Events>;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>What changes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>contract</PaperCode></td>
                        <td><PaperCode>PanelContract</PaperCode></td>
                        <td>No default (no calls, no events)</td>
                        <td>The calls, events and state the panel's page and its service agree on, made with <PaperLink href="/docs/paperapi/bridge/">defineContract</PaperLink>. It gives the service its panel id and its state, and types <PaperCode>calls</PaperCode>, <PaperCode>emit</PaperCode> and <PaperCode>setState</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The contract's panel id, or <PaperCode>getPanelId()</PaperCode>, the id the daemon started the service with</td>
                        <td>The panel the service registers its blocks under. With a contract it must be the contract's, or <PaperCode>definePanelService</PaperCode> throws <PaperCode>{"[Service:<id>] its contract is <panel id>'s"}</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>state</PaperCode></td>
                        <td><PaperCode>TState</PaperCode></td>
                        <td>The contract's <PaperCode>state.initial</PaperCode>, or <PaperCode>{"{}"}</PaperCode></td>
                        <td>The starting state, for a contract that says nothing of the state. A contract that declares one says it instead, and this option is a type error. The state lives in memory: save what must survive a restart with <PaperLink href="/docs/paperapi/config/">configApi</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>calls</PaperCode></td>
                        <td><PaperCode>{"CallHandlers<typeof contract>"}</PaperCode>: <PaperCode>(input, ctx, scope) =&gt; output | Promise&lt;output&gt;</PaperCode></td>
                        <td>Required for each call of the contract</td>
                        <td>One handler for each of the contract's calls, given its checked input, the context and the scope's values, and returning its output. See <PaperLink href="#calls">Calls</PaperLink>. For what other panels, flows and agents use, register blocks in <PaperCode>onInit</PaperCode> with <PaperLink href="/docs/paperapi/blocks/">blocksApi</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>widgetChoices</PaperCode></td>
                        <td><PaperCode>Record&lt;widgetId, Record&lt;optionId, (ctx) =&gt; WidgetChoice[]&gt;&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>What each widget option's dropdown offers in Home's gallery. See <PaperLink href="/docs/paperapi/widgets/#widget-choices">Widgets</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onInit</PaperCode></td>
                        <td><PaperCode>(ctx) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>Runs after the service's calls are registered. The service reports ready once it resolves, so do start-up work here: load config, reconnect, adopt running processes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>beforeBackup</PaperCode></td>
                        <td><PaperCode>(ctx, options: {"{ sourceId?: string }"}) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default (the service is stopped for the copy, with no warning)</td>
                        <td>Called before a backup copies the panel's data. Write out what is in memory and make running programs stop writing. Throwing refuses the backup. <PaperCode>sourceId</PaperCode> names the backup source being copied, and is absent for a whole-panel backup.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>beforeRestore</PaperCode></td>
                        <td><PaperCode>(ctx, options: {"{ sourceId?: string }"}) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>Called before a restore replaces the panel's data. Stop the programs that hold the data open. Throwing refuses the restore with the thrown message.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>afterBackup</PaperCode></td>
                        <td><PaperCode>(ctx, ended: BackupEnded) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>Called when a backup of the panel's data ends, whoever started it. <PaperCode>ended</PaperCode> is <PaperCode>{"{ ok: true, backup, sourceId? }"}</PaperCode> with the new record, or <PaperCode>{"{ ok: false, error, sourceId? }"}</PaperCode> with why it failed. It runs in the service that started after the backup.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>afterRestore</PaperCode></td>
                        <td><PaperCode>(ctx, ended: BackupEnded) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>The same, for a restore. <PaperCode>backup</PaperCode> is the record that was restored.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>beforeUpdate</PaperCode></td>
                        <td><PaperCode>(ctx, options: {"{ processes: string[] }"}) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default (each process is sent a terminate signal)</td>
                        <td>Called before an update stops your processes: a new release of your panel, or a runtime package such as Java they run from. Processes that just started are stopped without asking; an <PaperCode>important</PaperCode> one, or one that has run for ten minutes, waits until someone chooses Stop and update. Stop the listed processes your own way, such as a game server saving its world. Any still running when it resolves is sent a terminate signal and given 30 seconds. Throwing refuses the update.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>afterUpdate</PaperCode></td>
                        <td><PaperCode>(ctx, ended: UpdateEnded) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>Called when that update ends, with <PaperCode>{"{ processes, ok, error? }"}</PaperCode>: start the processes again. After an update of your panel it runs in the new release's service. <PaperCode>ok</PaperCode> is false when the update failed and the previous release is still in place; start them all the same.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onPagesChanged</PaperCode></td>
                        <td><PaperCode>(ctx, open: number) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>Hears how many of the panel's pages are open, on every computer showing them: once when the service is ready, then each time one opens or closes. A widget is not a page. Use it to let go of what only an open page needs, such as a draft no page shows any more.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="service-context">ServiceContext</PaperText>
            <PaperCode block language="tsx">
{`interface ServiceContext<TState, TEvents> {
    /** the current state; always the latest value */
    readonly state: TState;
    setState(patchOrUpdater: Partial<TState> | ((prev: TState) => Partial<TState>)): void;
    /** tells the panel's page something happened; other panels can't hear it */
    emit<E extends keyof TEvents>(event: E, payload: Infer<TEvents[E]>): void;
    /** the contract's keyed state, by field */
    readonly keyed: { [field]: KeyedEntries<Value> };
}

interface KeyedEntries<Value> {
    get(key: string): Value | undefined;
    set(key: string, value: Value): void;
    delete(key: string): void;
    keys(): string[];
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Every handler and hook is given it as <PaperCode>ctx</PaperCode>. To type a helper that takes it, use <PaperCode>{"ContractContext<typeof weatherContract>"}</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>setState</PaperCode></td>
                        <td>Checks the patch against the contract's state, merges it into the state, one level deep, then sends it to every window's <PaperLink href="/docs/paperapi/bridge/#state-sync">state mirror</PaperLink> as the internal <PaperCode>panel-state-changed</PaperCode> event. A patch the state's shape doesn't allow throws <PaperCode>{"[Service:<id>] The state was not changed: <problem>"}</PaperCode>, or <PaperCode>{"The state has no field \"<key>\""}</PaperCode>, and changes nothing. One send is in flight at a time: patches made while it travels are merged into the next one, so a service that sets state hundreds of times a second sends far fewer events.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>emit</PaperCode></td>
                        <td>Typed by the contract's <PaperCode>events</PaperCode>: the event must be one it names, with the payload it says. Anything else throws where it is emitted, <PaperCode>{"[Service:<id>] The contract has no event \"<name>\""}</PaperCode> or <PaperCode>{"The event \"<name>\" was not sent: <problem>"}</PaperCode>, and nothing is sent. Returns at once. The page hears it through its client's <PaperCode>events</PaperCode>. It fires the internal event <PaperCode>emit-&lt;kebab-name&gt;</PaperCode>, which is registered the first time it is emitted. A delivery that fails is reported as the panel's problem, <PaperCode>The panel's page missed an update</PaperCode>, with the event's name and why; see <PaperLink href="/docs/paperapi/problems/">problemsApi</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>keyed</PaperCode></td>
                        <td>The contract's <PaperLink href="/docs/paperapi/bridge/#keyed-state">keyed state</PaperLink>. <PaperCode>set</PaperCode> checks the value against the field's shape, keeps it and sends that one key to every window; a value the shape refuses throws <PaperCode>{"[Service:<id>] The keyed state \"<field>\" was not changed: <problem>"}</PaperCode> and changes nothing. <PaperCode>delete</PaperCode> removes a key, and a window following it hears <PaperCode>undefined</PaperCode>. Sends are merged as <PaperCode>setState</PaperCode>'s are, each key once.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The service registers the internal value <PaperCode>panel-state</PaperCode>, which returns the whole state once the service is ready, and the internal event <PaperCode>panel-state-changed</PaperCode>. State mirrors read the value to hydrate and hear the event for each patch.
                A contract with keyed state also registers the internal value <PaperCode>panel-state-key</PaperCode>, which returns one key's value, or a field's every key.
                With <PaperCode>widgetChoices</PaperCode>, it also registers the internal command <PaperCode>widget-choices</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="calls">Calls</PaperText>
            <PaperText preset="body" as="p">
                A call is what the panel's own page asks its service to do, declared in the <PaperLink href="/docs/paperapi/bridge/">contract</PaperLink>. Each is registered as an internal command, <PaperCode>call-&lt;kebab-name&gt;</PaperCode>, so <PaperCode>followCity</PaperCode> becomes <PaperCode>call-follow-city</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`// in a file of its own, typed by the contract
const calls = {
    forecast: async ({ city }, ctx) => readForecast(city),
    clearRecent: (_input, ctx) => ctx.setState({ recent: [] }),
} satisfies CallHandlers<typeof weatherContract>;`}
            </PaperCode>
            <PaperTextList>
                <li>A handler is <PaperCode>(input, ctx, scope)</PaperCode>: the call's own fields, checked; the <PaperLink href="#service-context">context</PaperLink>; and the contract's <PaperLink href="/docs/paperapi/bridge/#scope">scope</PaperLink> values. A call without <PaperCode>input</PaperCode> is given <PaperCode>undefined</PaperCode>.</li>
                <li>The input is checked against its shape before the handler runs, and a field the shape doesn't name is refused. A refused call never reaches the handler, whoever made it, <PaperCode>paperapi call</PaperCode> included.</li>
                <li>What the handler returns is checked against <PaperCode>output</PaperCode> before it leaves. Returning nothing, for a <PaperCode>shape.nothing()</PaperCode> call, gives the page <PaperCode>undefined</PaperCode>.</li>
                <li>A handler that throws rejects the caller with the same message. Throw sentences the person using the panel can act on.</li>
                <li>A shape says what a value is, not what it may be: refuse an empty city in the handler.</li>
                <li>Internal blocks are never listed, and the daemon refuses them to every other panel. For what other panels, flows and agents use, register a block with <PaperLink href="/docs/paperapi/blocks/">blocksApi</PaperLink> in <PaperCode>onInit</PaperCode>.</li>
            </PaperTextList>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>STATE_VALUE</PaperCode></td><td><PaperCode>"panel-state"</PaperCode>, the internal value holding the service's state.</td></tr>
                    <tr><td><PaperCode>STATE_EVENT</PaperCode></td><td><PaperCode>"panel-state-changed"</PaperCode>, the internal event each patch travels on.</td></tr>
                    <tr><td><PaperCode>WIDGET_CHOICES_COMMAND</PaperCode></td><td><PaperCode>"widget-choices"</PaperCode>, the internal command Home asks a widget option's dropdown from.</td></tr>
                    <tr><td><PaperCode>callBlockId(name)</PaperCode>, <PaperCode>eventBlockId(name)</PaperCode></td><td>The block id a call name (<PaperCode>call-follow-city</PaperCode>) or an event name (<PaperCode>emit-forecast-read</PaperCode>) becomes. They throw for a name that can't be one.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="lifecycle">Lifecycle</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Event</th>
                        <th>What the daemon does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Start</td>
                        <td>Starts every installed service when the daemon starts, except those whose manifest sets <PaperCode>autostart: false</PaperCode>. Also starts the service after an install or update, and on a restart. A newly linked panel's service starts on the next <PaperCode>paperapi restart</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Runtime</td>
                        <td>Runs the script with the daemon's own runtime: Node, Bun, or the Bun built into the released daemon binary. The working directory is the panel folder. Write a service that runs on both Node and Bun.</td>
                    </tr>
                    <tr>
                        <td>Ready</td>
                        <td>Waits for the service to report ready, which <PaperCode>definePanelService</PaperCode> does once its calls are registered and <PaperCode>onInit</PaperCode> resolves. A service that has not reported within 20 seconds is killed and marked failed, with <PaperCode>did not report ready within 20s</PaperCode>, and is not restarted.</td>
                    </tr>
                    <tr>
                        <td>Crash</td>
                        <td>Restarts it after 1, 2, 4, 8, then 10 seconds. A crash counts as consecutive when the service ran for less than 30 seconds. After the sixth consecutive crash, the daemon stops restarting it until the next restart or daemon start.</td>
                    </tr>
                    <tr>
                        <td>Stop</td>
                        <td>Sends <PaperCode>SIGTERM</PaperCode>, then <PaperCode>SIGKILL</PaperCode> after 3 seconds. A service still alive 3 seconds after that fails the stop with <PaperCode>Service &lt;id&gt; did not exit; refusing to remove its files</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Output</td>
                        <td>Writes standard output and standard error to the daemon log, prefixed <PaperCode>{"[service:<id>]"}</PaperCode>, at most 64 KB per chunk.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Processes the service started through <PaperLink href="/docs/paperapi/process/">processApi</PaperLink> are not the service's children: they keep running through a service restart, a crash and a daemon restart.
                In <PaperCode>onInit</PaperCode>, check <PaperCode>processApi.exists</PaperCode> and <PaperCode>processApi.attach</PaperCode> to pick them up again.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="environment">Environment</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>PAPERBOARD_PANEL_ID</PaperCode></td><td>The panel id.</td></tr>
                    <tr><td><PaperCode>PAPERCRANE_PANEL_TOKEN</PaperCode></td><td>The panel's scoped credential. Never log it.</td></tr>
                    <tr><td><PaperCode>PAPERCRANE_PORT</PaperCode></td><td>The daemon's port on <PaperCode>127.0.0.1</PaperCode>.</td></tr>
                    <tr><td><PaperCode>PAPERBOARD_DIR</PaperCode></td><td>The Paperboard data folder. Read and write the panel's data through the APIs, not through this path.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The rest of the daemon's environment is passed through, except the host's <PaperCode>PAPERCRANE_TOKEN</PaperCode>, which is removed.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTextList>
                <li>A block that breaks a rule throws when it registers, before anything reaches the daemon. See <PaperLink href="/docs/paperapi/blocks/#registering">Registering</PaperLink>.</li>
                <li>When a registration or <PaperCode>onInit</PaperCode> fails, <PaperCode>ready</PaperCode> rejects, the error is logged as <PaperCode>{"[Service:<id>] initialization failed:"}</PaperCode>, and the service never reports ready, so the daemon kills it after 20 seconds.</li>
                <li>An error thrown by a handler rejects the page's call with the same message. Throw sentences the person using the panel can act on.</li>
                <li>A contract whose <PaperCode>calls</PaperCode> don't match the handlers throws when the service is defined: <PaperCode>{"[Service:<id>] the call \"<name>\" has no handler"}</PaperCode>, or <PaperCode>{"[Service:<id>] \"<name>\" is not a call of its contract"}</PaperCode>.</li>
                <li>A <PaperCode>beforeBackup</PaperCode> that throws refuses the backup with <PaperCode>The panel could not get ready for a backup: &lt;message&gt;</PaperCode>. A <PaperCode>beforeRestore</PaperCode> that throws refuses the restore with its own message.</li>
                <li><PaperCode>afterBackup</PaperCode> and <PaperCode>afterRestore</PaperCode> are told only while the service is ready. A backup that ends while the service is stopped or still starting is not heard. An error they throw is reported as the panel's problem, <PaperCode>Finishing up after a backup failed</PaperCode> (or a restore), with its message.</li>
                <li>The daemon waits at most 5 minutes for either hook, then fails with <PaperCode>Service &lt;id&gt; did not get ready for the backup within 300 s</PaperCode>. The hooks run only while the service is ready; a stopped or failed service is not asked.</li>
                <li>Paperboard never stops your processes for an update on its own. While they run, the update waits in the top bar's list until someone chooses Stop and update, or they stop.</li>
                <li>A <PaperCode>beforeUpdate</PaperCode> that throws refuses the update with <PaperCode>&lt;panel id&gt; could not stop its processes for the update: &lt;message&gt;</PaperCode>. The daemon waits at most 2 minutes for it. An error <PaperCode>afterUpdate</PaperCode> throws is reported as the panel's problem, <PaperCode>Finishing up after an update failed</PaperCode>, with its message.</li>
                <li>Each page counts from the moment it is ready until its connection closes, so a page that loses its connection counts again when it is back. An error <PaperCode>onPagesChanged</PaperCode> throws is reported as the panel's problem, <PaperCode>The panel's service couldn't follow its pages opening and closing</PaperCode>, with its message.</li>
                <li>A state sync that fails is logged as <PaperCode>{"[Service:<id>] Failed to sync state, trying again in <n> ms:"}</PaperCode>. The patch is kept and sent again, merged under any newer one, starting half a second later and doubling up to 30 seconds, until it arrives.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperapi/bridge/">the contract the page and the service share</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
