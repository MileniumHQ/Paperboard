import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function ActionsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Actions API</PaperText>
            <PaperText preset="body">
                actionsApi exposes an inter-panel RPC registry and typed event dispatcher across Paperboard panels.
                Reach for actionsApi when registering callable methods, emitting triggers for automation flows, or invoking peer panel services.
                Every action call carries explicit panel identity and validates schemas at the boundary.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import actionsApi or its alias actions from @mileniumhq/paperapi.
                Register RPC handlers within backend services and invoke them from frontend interfaces or automation flows.
            </PaperText>
            <PaperCode block language="tsx">
{`import { actionsApi } from "@mileniumhq/paperapi";

// Call an action registered on a target panel
const result = await actionsApi.call<string>(
    "dev.paperboard.terminal",
    "executeCommand",
    { command: "uptime" }
);`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module exports the following registry and execution functions:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Method</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>call</PaperCode></td>
                        <td><PaperCode>call&lt;T&gt;(targetPanel, actionName, inputs?, options?): Promise&lt;T&gt;</PaperCode></td>
                        <td>Calls an RPC action registered on a target panel and resolves its returned value. <PaperCode>options.timeoutMs</PaperCode> overrides the 30 s default (numeric up to 60 s, or <PaperCode>null</PaperCode> to wait for long work).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>register</PaperCode></td>
                        <td><PaperCode>register(actionOrName, handler?, panelId?, options?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Registers an action handler and its schema definition on the current panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>registerMultiple</PaperCode></td>
                        <td><PaperCode>registerMultiple(actionsMap, panelId?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Registers a batch of action handlers or ActionDefinition records.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unregister</PaperCode></td>
                        <td><PaperCode>unregister(actionName, panelId?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Removes an action handler from the panel registry.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>emit</PaperCode></td>
                        <td><PaperCode>emit(eventName, payload?, panelId?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Broadcasts a scoped event from the current panel context.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>emitTrigger</PaperCode></td>
                        <td><PaperCode>emitTrigger&lt;T&gt;(triggerId, output, panelId?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Dispatches a flow trigger event with typed output values.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>on</PaperCode></td>
                        <td><PaperCode>on(panelOrEvent, eventOrCallback, maybeCallback?): () =&gt; void</PaperCode></td>
                        <td>Subscribes to panel events. Returns an unsubscribe teardown function.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onTrigger</PaperCode></td>
                        <td><PaperCode>onTrigger&lt;T&gt;(panelOrTrigger, triggerOrCallback, maybeCallback?): () =&gt; void</PaperCode></td>
                        <td>Subscribes to trigger executions. Returns an unsubscribe teardown function.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>list(filterPanelId?): Promise&lt;ActionInfo[]&gt;</PaperCode></td>
                        <td>Queries registered action schemas across active panels. A project's action carries its <PaperCode>project</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defineProject</PaperCode></td>
                        <td><PaperCode>defineProject(project, panelId?): Promise&lt;ActionProjectHandle&gt;</PaperCode></td>
                        <td>Defines (or renames) one of the panel's projects and returns a handle that registers, calls and fires that project's actions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>project</PaperCode></td>
                        <td><PaperCode>project(projectId, panelId?): ActionProjectHandle</PaperCode></td>
                        <td>A handle for a project already defined, without a round trip.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>removeProject</PaperCode></td>
                        <td><PaperCode>removeProject(projectId, panelId?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Removes a project and every action in it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>listProjects</PaperCode></td>
                        <td><PaperCode>listProjects(filterPanelId?): Promise&lt;ProjectInfo[]&gt;</PaperCode></td>
                        <td>Every defined project: its panel, id, name and icon.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>projectActionId</PaperCode></td>
                        <td><PaperCode>projectActionId(project, action): string</PaperCode></td>
                        <td>The id a project's action is registered, called and fired under: <PaperCode>project/action</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Action subscriptions are scoped to explicit panel and event identifiers.
                Wildcard subscriptions using "*" are refused: subscribe to an explicit panel id and event name.
                Every subscription returns a disposal function to guarantee bounded listener lifetimes.
            </PaperText>

            <PaperText preset="subheader" id="timeouts">Timeouts</PaperText>
            <PaperText preset="body">
                An action call waits at most 30 seconds by default. Pass options.timeoutMs to change it:
                a numeric value up to 60_000 is honored, a larger one is refused with a typed error, and
                null waits for completion. Use null for an action that legitimately runs long — an install
                or a large download — and prefer acknowledging the work and reporting progress through
                panel state over holding the call open. Long calls still count against the transport's
                1000-outstanding-call cap.
            </PaperText>
            <PaperCode block language="tsx">
{`// wait for a slow install instead of failing at 30 s
await actionsApi.call("dev.example.runtime", "install", { version: "1.2.0" }, {
    timeoutMs: null,
});`}
            </PaperCode>

            <PaperText preset="subheader" id="input-limits">Input limits</PaperText>
            <PaperText preset="body">
                An input can declare limits on its value: min, max and integer for numbers,
                maxLength for text, and maxItems for a list (min, max and maxLength then apply to each
                item). The flow editor shows a broken limit on the block as soon as the typed value
                breaks it, before the flow runs. A variable is only known when the flow runs, so the SDK
                checks the call itself and refuses one that breaks a limit before run sees it. Keep
                checks that span several inputs (a minimum above a maximum) in run.
            </PaperText>
            <PaperCode block language="tsx">
{`defineAction({
    id: "create-select-menu",
    name: "Create Select Menu",
    description: "Builds a dropdown",
    inputs: {
        options: { type: "list<string>", label: "Options", maxItems: 25, maxLength: 100 },
        maxValues: { type: "number", label: "Maximum picks", integer: true, min: 1, max: 25 },
    },
    run: async (ctx, inputs) => buildMenu(inputs),
});`}
            </PaperCode>

            <PaperText preset="subheader" id="projects">Projects</PaperText>
            <PaperText preset="body">Game Server gives each server its own project, using its stable server id. Choose that project’s blocks to target that server. Project-less blocks from before several servers are deprecated forwarders to the migrated server until v0.5. Status, players, console and MOTD widgets choose a Server independently.</PaperText>
            <PaperText preset="body">
                A panel that runs several of one thing (game servers, bots) can keep each one's actions
                in a project. A project's action is registered as project/action, so survival/send and
                creative/send are two separate actions: flows, triggers and calls treat them as if the
                projects shared nothing. Build them from one definition in your own code. The Actions
                library shows a panel's global actions and one project's at a time, with a dropdown to
                switch. A panel without projects needs none of this; bare action ids stay global.
            </PaperText>
            <PaperText preset="body">
                Projects come and go while the panel runs. Removing one removes its actions, and so does
                the panel's connection closing; a flow that uses them then fails with the reason. Only
                the connection that defined a project can register into it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { actionsApi, defineAction } from "@mileniumhq/paperapi";

const sendMessage = (server: Server) => defineAction({
    id: "send",
    name: "Send Message",
    description: \`Says something in \${server.name}'s chat\`,
    inputs: { text: { type: "string", label: "Text", required: true } },
    run: async (ctx, inputs) => server.say(inputs.text),
});

// a global action: not in any project
await actionsApi.register(createServerAction);

for (const server of servers) {
    const project = await actionsApi.defineProject({ id: server.id, name: server.name, icon: "dns" });
    await project.register(sendMessage(server)); // "<server.id>/send"
}

// renamed and deleted later, at any time
await actionsApi.project(server.id).update({ name: "Survival (old)" });
await actionsApi.removeProject(server.id);`}
            </PaperCode>

            <PaperText preset="subheader" id="hidden">Actions for programs</PaperText>
            <PaperText preset="body">
                Set hidden on an action that programs use but a person wouldn't place as a block, such as
                one taking a whole flow as an object. The Actions library leaves it out; it stays listed
                and callable, and the Agents panel offers it. Use internal instead for an action only the
                panel itself may call.
            </PaperText>

            <PaperText preset="subheader" id="deprecated">Retiring an action</PaperText>
            <PaperText preset="body">
                Set deprecated on an action definition to a message saying what to use instead and
                when the action goes away. The action keeps running for flows that already use it,
                the Actions library stops offering it, and every block already placed shows the
                message. Pair it with a TODO(remove after vX) marker and remove the action in that
                release.
            </PaperText>
            <PaperCode block language="tsx">
{`defineAction({
    id: "defer-interaction",
    name: "Defer Interaction",
    description: "Shows that the bot is thinking about a slash command",
    deprecated: "No longer needed: interactions are acknowledged automatically. Remove this step; it stops working after v0.3.",
    run: async (ctx, inputs) => { /* still works meanwhile */ },
});`}
            </PaperCode>
            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Define typed trigger events that start automation flows in Paperboard.
            </PaperText>
            <PaperCode block language="tsx">
{`import { actionsApi, defineAction } from "@mileniumhq/paperapi";

const playerJoinedAction = defineAction({
    id: "player-joined",
    name: "Player Joined",
    description: "Fires when a player connects to the server.",
    outputFields: {
        username: { type: "string", label: "Player Username" }
    },
    listen: (ctx, emit) => {
        const handler = (name: string) => emit({ username: name });
        server.on("join", handler);
        return () => server.off("join", handler);
    }
});

await actionsApi.register(playerJoinedAction);`}
            </PaperCode>
        </PaperFlex>
    );
}
