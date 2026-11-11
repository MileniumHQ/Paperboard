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
                definePanelService is the entry point of a panel's service: it registers the panel's actions, holds its state, and tells the daemon it is ready.
                The Paperboard server daemon runs the service as a background process that keeps going while the Paperboard window is closed.
                Give a panel a service when it owns something long-lived: a server, a bot, a schedule, a connection.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Name the built file in the manifest's <PaperCode>service</PaperCode> field, such as <PaperCode>./dist/service.js</PaperCode>, and call <PaperCode>definePanelService</PaperCode> once at its top level.
            </PaperText>
            <PaperCode block language="tsx">
{`import { definePanelService, secretsApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.weather";

interface WeatherState {
    lastCity: string;
}

const service = definePanelService({
    id: PANEL_ID,
    state: { lastCity: "" } as WeatherState,
    actions: [
        {
            id: "forecast",
            name: "Get forecast",
            description: "Returns today's high and low for a city",
            inputs: { city: { type: "string", label: "City", placeholder: "City", required: true, maxLength: 64 } },
            output: "object",
            run: async (ctx, inputs: { city: string }) => {
                const key = await secretsApi.get("apiKey", PANEL_ID);
                if (!key.found) throw new Error("Add an API key in the Weather panel first");
                ctx.setState({ lastCity: inputs.city });
                return { city: inputs.city, high: 21, low: 12 };
            },
        },
    ],
    onInit: async (ctx) => {
        console.log(\`Weather service ready, last city: \${ctx.state.lastCity || "none"}\`);
    },
});

export default service;`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`function definePanelService<TState extends Record<string, any>, TActions>(
    options: DefinePanelServiceOptions<TState, TActions>,
): {
    panelId: string;
    /** resolves once every action is registered and onInit has finished */
    ready: Promise<void>;
    ctx: ServiceContext<TState>;
    getState(): TState;
    setState(patchOrUpdater: Partial<TState> | ((prev: TState) => Partial<TState>)): void;
};`}
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
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>getPanelId()</PaperCode>, the id the daemon started the service with</td>
                        <td>The panel the service registers its actions under.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>state</PaperCode></td>
                        <td><PaperCode>TState</PaperCode></td>
                        <td><PaperCode>{"{}"}</PaperCode></td>
                        <td>The starting state. It lives in memory: save what must survive a restart with <PaperLink href="/docs/paperapi/config/">configApi</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td><PaperCode>ActionDefinition[]</PaperCode> or <PaperCode>Record&lt;string, (ctx, inputs, options) =&gt; any&gt;</PaperCode></td>
                        <td>No default (no actions)</td>
                        <td>The array form registers each definition with its schema, as <PaperLink href="/docs/paperapi/actions/#definitions">actionsApi.register</PaperLink> does, with <PaperCode>run(ctx, inputs)</PaperCode> receiving the service context. The map form registers plain handlers by name, with no schema, as <PaperCode>handler(ctx, inputs, options)</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>types</PaperCode></td>
                        <td><PaperCode>CustomTypeDefinition[]</PaperCode></td>
                        <td>No default</td>
                        <td>Custom data types the actions name, defined before they register. See <PaperLink href="/docs/paperapi/actions/#types">Types</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>categories</PaperCode></td>
                        <td><PaperCode>ActionCategoryDefinition[]</PaperCode></td>
                        <td>No default</td>
                        <td>Icon and order for the categories actions name by string. An action with <PaperCode>category: "Forecasts"</PaperCode> gets the entry whose <PaperCode>name</PaperCode> is <PaperCode>"Forecasts"</PaperCode>.</td>
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
                        <td>Runs after every action is registered. The service reports ready once it resolves, so do start-up work here: load config, reconnect, adopt running processes.</td>
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
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="service-context">ServiceContext</PaperText>
            <PaperCode block language="tsx">
{`interface ServiceContext<TState> {
    /** the current state; always the latest value */
    readonly state: TState;
    setState(patchOrUpdater: Partial<TState> | ((prev: TState) => Partial<TState>)): void;
    /** broadcasts an event from this panel */
    emit(event: string, payload?: unknown): void;
    /** fires one of this panel's triggers, starting the flows built on it */
    emitTrigger<T = any>(triggerId: string, output: T): void;
    /** says whether the service has nothing to do until something calls it */
    setIdle(idle: boolean): void;
}`}
            </PaperCode>
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
                        <td>Merges the patch into the state, one level deep, then sends the patch to every <PaperLink href="/docs/paperapi/bridge/">panel bridge</PaperLink> as the <PaperCode>__stateChanged</PaperCode> event. One send is in flight at a time: patches made while it travels are merged into the next one, so a service that sets state hundreds of times a second sends far fewer events.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>emit</PaperCode>, <PaperCode>emitTrigger</PaperCode></td>
                        <td>Return at once. A failure is logged to the service's standard error with <PaperCode>{"[Service:<id>] Failed to emit"}</PaperCode>; call <PaperLink href="/docs/paperapi/actions/">actionsApi.emit</PaperLink> directly to await and handle it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setIdle</PaperCode></td>
                        <td>Tells the daemon whether the service has nothing to do until something calls it. A service starts as not idle, and one that never calls this is never put to sleep. See <PaperLink href="/docs/paperapi/service/#lifecycle">Sleep</PaperLink> below.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The service registers the internal action <PaperCode>__getState</PaperCode>, which returns the whole state once the service is ready. Bridges call it to hydrate.
                With <PaperCode>widgetChoices</PaperCode>, it also registers the internal <PaperCode>__widgetChoices</PaperCode>.
            </PaperText>

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
                        <td>Waits for the service to report ready, which <PaperCode>definePanelService</PaperCode> does once its actions are registered and <PaperCode>onInit</PaperCode> resolves. A service that has not reported within 20 seconds is killed and marked failed, with <PaperCode>did not report ready within 20s</PaperCode>, and is not restarted.</td>
                    </tr>
                    <tr>
                        <td>Crash</td>
                        <td>Restarts it after 1, 2, 4, 8, then 10 seconds. A crash counts as consecutive when the service ran for less than 30 seconds. After the sixth consecutive crash, the daemon stops restarting it until the next restart or daemon start.</td>
                    </tr>
                    <tr>
                        <td>Sleep</td>
                        <td>Stops a service that has said <PaperCode>ctx.setIdle(true)</PaperCode> once 2 minutes have passed with no call to it and none still running. Its actions, blocks and projects stay listed. The next call to one of them starts the service again and waits for it to be ready, so <PaperCode>onInit</PaperCode> runs again and whatever the service knew must be on disk. Events are not kept for a sleeping service, so one that listens for another panel's events is not idle.</td>
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
                <li>A definition that breaks a rule throws when it registers, before anything reaches the daemon. See <PaperLink href="/docs/paperapi/actions/#definition-rules">definition rules</PaperLink>.</li>
                <li>When a registration or <PaperCode>onInit</PaperCode> fails, <PaperCode>ready</PaperCode> rejects, the error is logged as <PaperCode>{"[Service:<id>] initialization failed:"}</PaperCode>, and the service never reports ready, so the daemon kills it after 20 seconds.</li>
                <li>An error thrown by an action's <PaperCode>run</PaperCode> rejects the caller's <PaperCode>actionsApi.call</PaperCode> with the same message. Throw sentences the person using the panel can act on.</li>
                <li>A <PaperCode>beforeBackup</PaperCode> that throws refuses the backup with <PaperCode>The panel could not get ready for a backup: &lt;message&gt;</PaperCode>. A <PaperCode>beforeRestore</PaperCode> that throws refuses the restore with its own message.</li>
                <li><PaperCode>afterBackup</PaperCode> and <PaperCode>afterRestore</PaperCode> are told only while the service is ready. A backup that ends while the service is stopped or still starting is not heard. An error they throw is logged as <PaperCode>{"[Service:<id>] afterBackup failed:"}</PaperCode>.</li>
                <li>The daemon waits at most 5 minutes for either hook, then fails with <PaperCode>Service &lt;id&gt; did not get ready for the backup within 300 s</PaperCode>. The hooks run only while the service is ready; a stopped or failed service is not asked.</li>
                <li>Paperboard never stops your processes for an update on its own. While they run, the update waits in the top bar's list until someone chooses Stop and update, or they stop.</li>
                <li>A <PaperCode>beforeUpdate</PaperCode> that throws refuses the update with <PaperCode>&lt;panel id&gt; could not stop its processes for the update: &lt;message&gt;</PaperCode>. The daemon waits at most 2 minutes for it. An error <PaperCode>afterUpdate</PaperCode> throws is logged as <PaperCode>{"[Service:<id>] afterUpdate failed:"}</PaperCode>.</li>
                <li>A state sync that fails is logged as <PaperCode>{"[Service:<id>] Failed to sync state:"}</PaperCode>, and open bridges miss that patch until they call <PaperCode>refreshState</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperapi/bridge/">read the state from the panel page</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
