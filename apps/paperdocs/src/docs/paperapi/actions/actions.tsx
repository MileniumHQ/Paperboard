import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

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
                Import actionsApi or its alias actions from @paperboard-dev/paperapi.
                Register RPC handlers within backend services and invoke them from frontend interfaces or automation flows.
            </PaperText>
            <PaperCode block language="tsx">
{`import { actionsApi } from "@paperboard-dev/paperapi";

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
                        <td>Calls an RPC action registered on a target panel and resolves its returned value.</td>
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
                        <td>Queries registered action schemas across active panels.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Action subscriptions are scoped to explicit panel and event identifiers.
                Wildcard subscriptions using "*" emit deprecation warnings.
                Every subscription returns a disposal function to guarantee bounded listener lifetimes.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Define typed trigger events that start automation flows in Paperboard.
            </PaperText>
            <PaperCode block language="tsx">
{`import { actionsApi, defineAction } from "@paperboard-dev/paperapi";

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
