import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ActionsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">actionsApi</PaperText>
            <PaperText preset="body" as="p">
                actionsApi registers a panel's actions, calls other panels' actions, and sends events and triggers between panels.
                An action with a schema becomes a block in the Actions panel's flow builder and a tool the Agent panel can call.
                It works in every context, and most panels register their actions from the service through <PaperLink href="/docs/paperapi/service/">definePanelService</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { actionsApi } from "@mileniumhq/paperapi";

// call another panel's action, from a page or a service
const forecast = await actionsApi.call<{ high: number; low: number }>(
    "dev.example.weather",
    "forecast",
    { city: "Lisbon" },
);

// hear another panel's trigger
const stop = actionsApi.onTrigger("dev.example.weather", "storm-warning", (output) => {
    console.log("Storm warning", output);
});`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="calling">Calling</PaperText>
            <PaperCode block language="tsx">
{`actionsApi.call<T = unknown>(
    targetPanel: string,
    actionName: string,
    inputs?: any,
    options?: ActionCallOptions,
): Promise<T>;

interface ActionCallOptions {
    /** default 30000; at most 60000; null waits with no deadline */
    timeoutMs?: number | null;
    /** every other field reaches the handler as its options argument */
    [key: string]: unknown;
}`}
            </PaperCode>
            <PaperTextList>
                <li>Resolves with what the handler returned, and rejects with the message the handler threw.</li>
                <li>Any panel can call any other panel's action, except one whose schema sets <PaperCode>internal</PaperCode>: those answer only their own panel.</li>
                <li>Use <PaperCode>timeoutMs: null</PaperCode> for work that runs longer than a minute, such as installing a runtime. A caller may have at most 1000 calls waiting at once.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="definitions">Definitions</PaperText>
            <PaperText preset="body" as="p">
                An action is an <PaperCode>ActionDefinition</PaperCode>: a schema that describes the block, and a <PaperCode>run</PaperCode> function, or a <PaperCode>listen</PaperCode> function for an action that fires.
            </PaperText>
            <PaperCode block language="tsx">
{`actionsApi.register(
    actionOrName: string | ActionDefinition,
    handler?: (inputs: any, options?: Record<string, unknown>) => any,
    panelId?: string,
    options?: RegisterOptions,
): Promise<void>;

actionsApi.registerMultiple(
    actions: ActionDefinition[] | Record<string, (inputs: any, options?: Record<string, unknown>) => any>,
    panelId?: string,
): Promise<void>;

actionsApi.unregister(actionName: string, panelId?: string): Promise<void>;

/** returns def; fills template from writtenOut */
actionsApi.defineAction<TInputs, TOutput>(def: ActionDefinition<TInputs, TOutput>): ActionDefinition<TInputs, TOutput>;

interface RegisterOptions {
    internal?: boolean;
    name?: string;
    description?: string;
    /** registers into a project, as "project/action" */
    project?: string;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The definition form validates the definition, checks each call's inputs against their limits, then calls <PaperCode>run({"{ panelId }"}, inputs)</PaperCode>.
                The name form registers a plain handler with no schema, or with the small schema <PaperCode>options</PaperCode> describes. It suits actions a panel's own pages call.
                <PaperCode>panelId</PaperCode> defaults to the current panel.
            </PaperText>
            <PaperCode block language="tsx">
{`await actionsApi.register({
    id: "forecast",
    name: "Get forecast",
    description: "Returns today's high and low for a city",
    template: "Get the forecast for {city}",
    category: "Forecasts",
    icon: "partly_cloudy_day",
    inputs: {
        city: { type: "string", label: "City", placeholder: "City", maxLength: 64 },
        days: { type: "number", label: "Days", placeholder: "Number", default: 1, min: 1, max: 7, integer: true },
    },
    output: "object",
    outputFields: { high: "number", low: "number" },
    run: async (_ctx, inputs: { city: string; days: number }) => fetchForecast(inputs.city, inputs.days),
});`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>id</PaperCode></td><td><PaperCode>string</PaperCode></td><td>Required. The name the action is called by, at most 256 characters. A slash makes it a project's action, <PaperCode>project/action</PaperCode>.</td></tr>
                    <tr><td><PaperCode>name</PaperCode></td><td><PaperCode>string</PaperCode></td><td>Required. The block's title in the library.</td></tr>
                    <tr><td><PaperCode>description</PaperCode></td><td><PaperCode>string</PaperCode></td><td>Required. What the action does, for the library and for agents.</td></tr>
                    <tr><td><PaperCode>template</PaperCode>, <PaperCode>writtenOut</PaperCode></td><td><PaperCode>string</PaperCode></td><td>The sentence the block shows, with each <PaperCode>{"{input}"}</PaperCode> replaced by that input's field. Either one fills the other. Without one, the block shows its name followed by its inputs.</td></tr>
                    <tr><td><PaperCode>category</PaperCode></td><td><PaperCode>string | ActionCategoryDefinition</PaperCode></td><td>The section of the library the block sits in. Actions with none go under <PaperCode>General</PaperCode>.</td></tr>
                    <tr><td><PaperCode>icon</PaperCode></td><td><PaperCode>string</PaperCode></td><td>A Material Symbols name for the block.</td></tr>
                    <tr><td><PaperCode>inputs</PaperCode></td><td><PaperCode>Record&lt;string, ActionParamDefinition&gt;</PaperCode></td><td>The values the block asks for, keyed by the name <PaperCode>run</PaperCode> reads. See <PaperLink href="/docs/paperapi/actions/#inputs">Inputs</PaperLink>.</td></tr>
                    <tr><td><PaperCode>output</PaperCode></td><td><PaperCode>DataType | {"{ type, label?, description? }"}</PaperCode></td><td>The type of what <PaperCode>run</PaperCode> returns, or of what an event action fires.</td></tr>
                    <tr><td><PaperCode>outputFields</PaperCode></td><td><PaperCode>Record&lt;string, DataType | ActionOutputFieldDefinition&gt;</PaperCode></td><td>Named fields of an object output. The flow builder offers each one as a typed variable.</td></tr>
                    <tr><td><PaperCode>internal</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td>Out of the library and the Agent panel, and refused to other panels. For calls between a panel's own pages and service.</td></tr>
                    <tr><td><PaperCode>hidden</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td>Out of the library, but callable by any panel and offered to the Agent panel. For actions too involved to be a block.</td></tr>
                    <tr><td><PaperCode>deprecated</PaperCode></td><td><PaperCode>string</PaperCode></td><td>Still runs, but the library stops offering it and every placed block shows this text. Say what to use instead.</td></tr>
                    <tr><td><PaperCode>match</PaperCode></td><td><PaperCode>ActionMatchDefinition | ActionMatchDefinition[]</PaperCode></td><td>Event actions only. See <PaperLink href="/docs/paperapi/actions/#matching">Matching</PaperLink>.</td></tr>
                    <tr><td><PaperCode>quick</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td>Kept in the registry. No part of Paperboard reads it.</td></tr>
                    <tr><td><PaperCode>run</PaperCode></td><td><PaperCode>(ctx, inputs) =&gt; TOutput | Promise&lt;TOutput&gt;</PaperCode></td><td>Runs on a call. Its return value is the call's result.</td></tr>
                    <tr><td><PaperCode>listen</PaperCode></td><td><PaperCode>(ctx, emit: (output) =&gt; void) =&gt; () =&gt; void</PaperCode></td><td>Makes an event action: called once at registration, and each <PaperCode>emit(output)</PaperCode> fires the action as a trigger.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                An action with no <PaperCode>run</PaperCode> is an event action: the SDK sets <PaperCode>eventOnly</PaperCode> on its schema, the library shows it as a trigger, and a call to it rejects with <PaperCode>Action "&lt;id&gt;" fires as an event and is not callable</PaperCode>.
                The SDK also sets <PaperCode>types</PaperCode> to every custom type the schema names.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="inputs">Inputs</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>type</PaperCode></td><td><PaperCode>DataType</PaperCode></td><td>Required. <PaperCode>string</PaperCode>, <PaperCode>number</PaperCode>, <PaperCode>boolean</PaperCode>, <PaperCode>object</PaperCode>, <PaperCode>file</PaperCode>, <PaperCode>void</PaperCode>, <PaperCode>any</PaperCode>, a custom type id, or <PaperCode>list&lt;type&gt;</PaperCode>.</td></tr>
                    <tr><td><PaperCode>label</PaperCode></td><td><PaperCode>string</PaperCode></td><td>Required. The field's name on the block, and the name in limit errors.</td></tr>
                    <tr><td><PaperCode>placeholder</PaperCode></td><td><PaperCode>string</PaperCode></td><td>The empty field's text: the kind of value, such as <PaperCode>Text</PaperCode> or <PaperCode>Channel ID</PaperCode>.</td></tr>
                    <tr><td><PaperCode>description</PaperCode></td><td><PaperCode>string</PaperCode></td><td>More about the value.</td></tr>
                    <tr><td><PaperCode>default</PaperCode></td><td><PaperCode>any</PaperCode></td><td>The value a new block starts with.</td></tr>
                    <tr><td><PaperCode>required</PaperCode>, <PaperCode>optional</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td><PaperCode>required</PaperCode> marks the empty field on the block, and the SDK refuses a call that leaves it empty. <PaperCode>optional</PaperCode> is for the flow editor.</td></tr>
                    <tr><td><PaperCode>options</PaperCode></td><td><PaperCode>{"{ label: string; value: any }[]"}</PaperCode></td><td>Makes the field a dropdown.</td></tr>
                    <tr><td><PaperCode>allowEmpty</PaperCode>, <PaperCode>emptyLabel</PaperCode></td><td><PaperCode>boolean</PaperCode>, <PaperCode>string</PaperCode></td><td>Adds an unselected entry to the dropdown, named <PaperCode>emptyLabel</PaperCode>. On a match input it means any value.</td></tr>
                    <tr><td><PaperCode>multiline</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td>A wrapping field for long text.</td></tr>
                    <tr><td><PaperCode>typeName</PaperCode></td><td><PaperCode>string</PaperCode></td><td>The type badge's text, in place of the type id.</td></tr>
                    <tr><td><PaperCode>min</PaperCode>, <PaperCode>max</PaperCode>, <PaperCode>integer</PaperCode></td><td><PaperCode>number</PaperCode>, <PaperCode>boolean</PaperCode></td><td>Limits on a number. Any of them makes the value a number.</td></tr>
                    <tr><td><PaperCode>maxLength</PaperCode></td><td><PaperCode>number</PaperCode></td><td>Most characters in a text value.</td></tr>
                    <tr><td><PaperCode>maxItems</PaperCode></td><td><PaperCode>number</PaperCode></td><td>Most items in a list. The other limits apply to each item.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The flow editor shows a broken limit on the block before the flow runs, and the SDK refuses a call that breaks one before <PaperCode>run</PaperCode> starts.
                An empty value breaks no limit. The errors name the input by its label: <PaperCode>"Days" must be a number</PaperCode>, <PaperCode>must be a whole number</PaperCode>, <PaperCode>must be at least 1</PaperCode>, <PaperCode>must be at most 7</PaperCode>, <PaperCode>"City" holds at most 64 characters (it has 70)</PaperCode>, <PaperCode>holds at most 5 items (it has 6)</PaperCode>.
                The same check is exported as <PaperCode>checkActionInput(def, value)</PaperCode>, which returns the sentence or <PaperCode>undefined</PaperCode>.
                A call that leaves a <PaperCode>required</PaperCode> input empty is refused with <PaperCode>"City" is required</PaperCode>. Empty is a missing value, <PaperCode>null</PaperCode>, <PaperCode>""</PaperCode>, or a list with no item that is not empty. That check is exported as <PaperCode>checkRequiredActionInput(def, value)</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="categories">Categories</PaperText>
            <PaperCode block language="tsx">
{`interface ActionCategoryDefinition {
    name: string;
    /** a Material Symbols name for the section */
    icon?: string;
    /** lower sorts first; categories without one sort by name after */
    order?: number;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Give <PaperCode>category</PaperCode> a string to name the section only, or the object for its icon and order.
                With <PaperCode>definePanelService</PaperCode>, list the objects once in its <PaperCode>categories</PaperCode> option and use the names in each action.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="types">Types</PaperText>
            <PaperCode block language="tsx">
{`actionsApi.defineType(def: CustomTypeDefinition): CustomTypeDefinition;
actionsApi.listTypes(): CustomTypeDefinition[];
actionsApi.isTypeCompatible(outputType: DataType, inputType: DataType): boolean;

interface CustomTypeDefinition {
    id: string;
    /** what the flow builder calls values of this type, such as "Channel" */
    name: string;
    description?: string;
    icon?: string;
    /** the primitive it is stored as */
    base: "string" | "number" | "boolean" | "object" | "file" | "void" | "any";
    /** the field shown when the value becomes text */
    defaultField?: string;
    /** how the value becomes text; stays in this program */
    toString?: (value: any) => string;
    fields?: Record<string, { type: DataType; label?: string; description?: string; optional?: boolean }>;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A custom type lets the flow builder connect only matching values, and offer an object's fields as variables.
                Types live in the program that defines them: define them before registering the actions that name them, and the SDK copies each one, without <PaperCode>toString</PaperCode>, into those actions' schemas.
                <PaperCode>listTypes</PaperCode> and <PaperCode>isTypeCompatible</PaperCode> see only this program's types. A type is compatible with its <PaperCode>base</PaperCode>, <PaperCode>any</PaperCode> matches every type, and <PaperCode>list&lt;a&gt;</PaperCode> matches <PaperCode>list&lt;b&gt;</PaperCode> when <PaperCode>a</PaperCode> matches <PaperCode>b</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="matching">Matching</PaperText>
            <PaperCode block language="tsx">
{`interface ActionMatchDefinition {
    /** the payload field to compare, dotted paths allowed; "$" is the whole payload */
    field: string;
    /** the input whose value the field must equal */
    input: string;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Without <PaperCode>match</PaperCode>, an event action starts every flow built on it. With rules, a flow starts only when every rule holds: the payload's <PaperCode>field</PaperCode> equals the value the flow's block set for <PaperCode>input</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="definition-rules">Definition rules</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>register</PaperCode> throws before anything is sent when a definition breaks one. <PaperCode>validateActionDefinition(def)</PaperCode> runs the same check.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>An action definition requires an id</PaperCode></td><td>No <PaperCode>id</PaperCode>, or an empty one.</td></tr>
                    <tr><td><PaperCode>declares both run and listen; an action either executes or fires, never both</PaperCode></td><td>Both functions.</td></tr>
                    <tr><td><PaperCode>declares match rules but is callable</PaperCode></td><td><PaperCode>match</PaperCode> with <PaperCode>run</PaperCode>.</td></tr>
                    <tr><td><PaperCode>declares a match rule without a payload field</PaperCode></td><td>An empty <PaperCode>field</PaperCode>.</td></tr>
                    <tr><td><PaperCode>declares a match on undeclared input "&lt;key&gt;"</PaperCode></td><td>A rule's <PaperCode>input</PaperCode> is not in <PaperCode>inputs</PaperCode>.</td></tr>
                    <tr><td><PaperCode>input "&lt;key&gt;" declares a min that is not a number</PaperCode></td><td>A <PaperCode>min</PaperCode> or <PaperCode>max</PaperCode> that is not a finite number.</td></tr>
                    <tr><td><PaperCode>input "&lt;key&gt;" declares a maxLength that is not a whole number</PaperCode></td><td>A negative or fractional <PaperCode>maxLength</PaperCode> or <PaperCode>maxItems</PaperCode>.</td></tr>
                    <tr><td><PaperCode>input "&lt;key&gt;" declares a min above its max</PaperCode></td><td><PaperCode>min</PaperCode> over <PaperCode>max</PaperCode>.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="events-and-triggers">Events and triggers</PaperText>
            <PaperCode block language="tsx">
{`actionsApi.emit(eventName: string, payload?: unknown, panelId?: string): Promise<void>;
actionsApi.emitTrigger<T>(triggerId: string, output: T, panelId?: string): Promise<void>;

actionsApi.on(event: string, callback: (payload: any) => void): () => void;
actionsApi.on(panelId: string, event: string, callback: (payload: any) => void): () => void;

actionsApi.onTrigger<T>(trigger: string, callback: (output: T, event: TriggerEventPayload<T>) => void): () => void;
actionsApi.onTrigger<T>(panelId: string, trigger: string, callback: (output: T, event: TriggerEventPayload<T>) => void): () => void;

interface TriggerEventPayload<T> {
    panelId: string;
    trigger: string;
    output: T;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Kind</th>
                        <th>Who hears it</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Event (<PaperCode>emit</PaperCode>)</td>
                        <td>Every page and service on this computer subscribed with <PaperCode>on</PaperCode> to that panel and event. The payload arrives as sent. Bridges use the <PaperCode>__stateChanged</PaperCode> event.</td>
                    </tr>
                    <tr>
                        <td>Trigger (<PaperCode>emitTrigger</PaperCode>)</td>
                        <td>Every subscriber through <PaperCode>onTrigger</PaperCode>, and the Actions panel, which starts the flows built on the event action of that id. Fire a trigger from the event action's <PaperCode>listen</PaperCode>, or by its id from anywhere in the panel.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li>A panel sends events and triggers only under its own id. Naming another panel is refused with <PaperCode>FORBIDDEN</PaperCode>.</li>
                <li>Any panel can listen to any panel's events and triggers.</li>
                <li>The two-argument forms listen to the current panel, and throw when its id can't be found. Pass the panel id to listen to another panel.</li>
                <li><PaperCode>"*"</PaperCode> is refused as a panel or a name: <PaperCode>actions.on does not accept "*"</PaperCode>.</li>
                <li>Subscriptions survive a reconnect. What was sent while the connection was down is lost.</li>
                <li>The returned function stops listening.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="projects">Projects</PaperText>
            <PaperText preset="body" as="p">
                A project is a named set of a panel's actions, such as one game server or one bot. The library's project picker shows each project's blocks apart.
                Each action in a project is its own action, registered as <PaperCode>project/action</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`actionsApi.defineProject(project: ProjectDefinition, panelId?: string): Promise<ActionProjectHandle>;
/** a handle on a project this panel defined, with no call to the daemon */
actionsApi.project(projectId: string, panelId?: string): ActionProjectHandle;
actionsApi.removeProject(projectId: string, panelId?: string): Promise<void>;
actionsApi.listProjects(filterPanelId?: string): Promise<ProjectInfo[]>;

interface ProjectDefinition {
    /** a letter or digit, then letters, digits, ".", "_" and "-"; at most 64 */
    id: string;
    /** at most 128 characters */
    name: string;
    icon?: string;
}

interface ActionProjectHandle {
    readonly id: string;
    readonly panelId: string;
    actionId(action: string): string;
    register(actionOrName: string | ActionDefinition, handler?: (inputs: any) => any, options?: Omit<RegisterOptions, "project">): Promise<void>;
    registerMultiple(defs: ActionDefinition[]): Promise<void>;
    unregister(action: string): Promise<void>;
    emitTrigger<T>(trigger: string, output: T): Promise<void>;
    call<T>(action: string, inputs?: any, options?: ActionCallOptions): Promise<T>;
    /** renames the project or changes its icon */
    update(project: Omit<ProjectDefinition, "id">): Promise<void>;
    /** removes the project and every action in it */
    remove(): Promise<void>;
}`}
            </PaperCode>
            <PaperCode block language="tsx">
{`const lobby = await actionsApi.defineProject({ id: "lobby", name: "Lobby server", icon: "dns" });
await lobby.register({
    id: "say",
    name: "Say",
    description: "Sends a chat message to the server",
    inputs: { text: { type: "string", label: "Text", placeholder: "Text" } },
    run: async (_ctx, inputs: { text: string }) => sendChat("lobby", inputs.text),
});`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A project belongs to the connection that defined it, and its actions register only from that connection. A flow block of a removed project fails when it runs.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="listing">Listing</PaperText>
            <PaperCode block language="tsx">
{`actionsApi.list(filterPanelId?: string): Promise<ActionInfo[]>;
actionsApi.onRegistryChange(callback: (change?: any) => void): () => void;

interface ActionInfo {
    panelId: string;
    /** a project's actions are "project/action" */
    action: string;
    project?: string;
    schema?: ActionSchema;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>list</PaperCode> returns every registered action on this computer, internal and event actions included, so filter by the schema's flags.
                <PaperCode>onRegistryChange</PaperCode> calls back whenever an action or project is registered or removed.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="registration-lifetime">Registration lifetime</PaperText>
            <PaperTextList>
                <li>An action belongs to the connection that registered it. When that page or service closes, its actions go away, and calls to them reject with <PaperCode>not registered or unavailable</PaperCode>.</li>
                <li>After a reconnect, the SDK registers the actions again.</li>
                <li>Registering a name another connection holds is refused with <PaperCode>CONFLICT</PaperCode>, so a panel's page and its service can't both register <PaperCode>forecast</PaperCode>.</li>
                <li>A connection holds at most 1024 actions and 256 projects, and a schema is at most 64 KB.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>Action "&lt;name&gt;" on panel "&lt;id&gt;" is not registered or unavailable</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>Nothing registered that name, or its connection closed.</td></tr>
                    <tr><td><PaperCode>Action "&lt;name&gt;" is internal to panel "&lt;id&gt;"</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>Another panel called an internal action.</td></tr>
                    <tr><td><PaperCode>Parameter "timeoutMs" exceeds 60000 ms cap</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A <PaperCode>timeoutMs</PaperCode> over a minute. Use <PaperCode>null</PaperCode>.</td></tr>
                    <tr><td><PaperCode>PaperCrane 'actions:call' timed out</PaperCode>, or <PaperCode>Action call "&lt;id&gt;:&lt;name&gt;" timed out after &lt;n&gt;ms</PaperCode></td><td>No code, or <PaperCode>INTERNAL</PaperCode></td><td>The handler did not answer in time. The SDK and the daemon both time the call, and the first to give up answers.</td></tr>
                    <tr><td><PaperCode>Registry namespace is owned by another socket</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>Another connection registered that name.</td></tr>
                    <tr><td><PaperCode>Project "&lt;project&gt;" is not defined for panel "&lt;id&gt;" on this connection</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A <PaperCode>project/action</PaperCode> id for a project this connection did not define.</td></tr>
                    <tr><td><PaperCode>"&lt;project&gt;" is not a valid project id</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A project id outside the rule.</td></tr>
                    <tr><td><PaperCode>Cannot register action without a panel context (panel ID not found)</PaperCode></td><td>No code</td><td>No panel id was passed or found.</td></tr>
                    <tr><td>The handler's message</td><td><PaperCode>INTERNAL</PaperCode></td><td>The handler threw, or an input broke a limit.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
