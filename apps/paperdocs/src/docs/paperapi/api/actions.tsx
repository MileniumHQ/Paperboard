import {
    PaperCode,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Actions API</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>actions</PaperCode> namespace: semantic action schemas, natural language templates, typed triggers, and inter-panel workflow automations.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The <strong>Actions API</strong> gives Paperboard apps structured, discoverable capabilities similar to Apple Shortcuts. Panels declare strongly typed actions and event triggers with natural language templates, input/output contracts, and quick-menu hooks.
            </PaperText>

            <PaperQuote variant="blue" icon="auto_awesome" title="Shortcuts & Workflows">
                Actions can be executed directly across panels, bound to right-click context menus, or chained into automated pipelines reacting to live triggers.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="action-schemas" preset="subheader">
                Defining Semantic Actions
            </PaperText>
            <PaperText preset="body">
                Actions define sentence templates (<PaperCode>template</PaperCode> / <PaperCode>writtenOut</PaperCode>), required inputs, optional flags, output contracts, and quick-menu visibility:
            </PaperText>
            <PaperCode block language="tsx">
                {`import { defineAction, defineType } from "@paperboard-dev/paperapi";

// 1. Declare domain types
export const playerType = defineType({
    id: "player",
    name: "Player",
    base: "string",
});

// 2. Declare action
export const sendMessageAction = defineAction({
    id: "send-message",
    name: "Send Message",
    description: "Sends a chat message to all players or whispers to a specific player",
    template: "Send {content} to {recipient}",
    inputs: {
        content: { type: "string", label: "Content", required: true },
        recipient: { type: "player", label: "Recipient", default: "@a", required: true },
    },
    options: {
        silent: { type: "boolean", label: "Silent", default: false },
    },
    output: { type: "object", label: "Sent Message" },
    quick: true, // Surfaces in context menus when right-clicking a player!
    icon: "chat",
    run: async (ctx, inputs, options) => {
        // Execute action daemon-side
        return { success: true };
    },
});`}
            </PaperCode>

            <PaperSeparator />

            <PaperText id="trigger-schemas" preset="subheader">
                Defining Event Triggers
            </PaperText>
            <PaperText preset="body">
                Triggers act as event sources that produce typed outputs when fired:
            </PaperText>
            <PaperCode block language="tsx">
                {`import { defineTrigger } from "@paperboard-dev/paperapi";

export const chatMessageTrigger = defineTrigger({
    id: "chat-message",
    name: "When Chat Message Received",
    description: "Fires whenever an in-game player or server chat message is received",
    template: "When chat message {message} is received",
    output: { type: "message", label: "Chat Message" },
    icon: "chat",
});

export const playerJoinedTrigger = defineTrigger({
    id: "player-joined",
    name: "When Player Joins",
    description: "Fires when a player connects and joins the game world",
    template: "When player {player} joins the server",
    output: { type: "player", label: "Joining Player" },
    icon: "person_add",
});`}
            </PaperCode>

            <PaperSeparator />

            <PaperText id="workflow-automation" preset="subheader">
                Building Automation Workflows
            </PaperText>
            <PaperText preset="body">
                Any script, panel, or automation service can subscribe to triggers and chain action execution:
            </PaperText>
            <PaperCode block language="tsx">
                {`import { actions } from "@paperboard-dev/paperapi";

// Listen when a player joins and execute a welcome routine
actions.onTrigger("dev.paperboard.gameserver", "player-joined", async (player: string) => {
    // 1. Broadcast welcome message
    await actions.call("dev.paperboard.gameserver", "send-message", {
        content: \`Hello \${player}! Welcome to the server!\`,
        recipient: "@a",
    });

    // 2. Gift starter items
    await actions.call("dev.paperboard.gameserver", "run-command", {
        command: \`give \${player} golden_apple 20\`,
    });
});`}
            </PaperCode>

            <PaperSeparator />

            <PaperText id="reference" preset="subheader">
                Actions API Reference
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
                        <td><PaperCode>(targetPanel, actionName, inputs?, options?) =&gt; Promise&lt;any&gt;</PaperCode></td>
                        <td>Invokes a semantic action on a target panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>register</PaperCode></td>
                        <td><PaperCode>(actionDef, handler?, panelId?) =&gt; Promise&lt;void&gt;</PaperCode></td>
                        <td>Registers an action and its contract.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>registerTrigger</PaperCode></td>
                        <td><PaperCode>(triggerDef, panelId?) =&gt; Promise&lt;void&gt;</PaperCode></td>
                        <td>Registers an event trigger schema.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>emitTrigger</PaperCode></td>
                        <td><PaperCode>(triggerId, output, panelId?) =&gt; Promise&lt;void&gt;</PaperCode></td>
                        <td>Fires a trigger with its output payload.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onTrigger</PaperCode></td>
                        <td><PaperCode>(panelIdOrTrigger, triggerOrCallback, cb?) =&gt; () =&gt; void</PaperCode></td>
                        <td>Subscribes to live trigger events.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onRegistryChange</PaperCode></td>
                        <td><PaperCode>(callback: () =&gt; void) =&gt; () =&gt; void</PaperCode></td>
                        <td>Subscribes to additions or removals from the action registry.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>(panelId?) =&gt; Promise&lt;ActionInfo[]&gt;</PaperCode></td>
                        <td>Discovers registered actions and schemas.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>listTriggers</PaperCode></td>
                        <td><PaperCode>(panelId?) =&gt; Promise&lt;TriggerInfo[]&gt;</PaperCode></td>
                        <td>Discovers registered event triggers.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defineType</PaperCode></td>
                        <td><PaperCode>(typeDef) =&gt; CustomTypeDefinition</PaperCode></td>
                        <td>Declares a custom domain entity type.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isTypeCompatible</PaperCode></td>
                        <td><PaperCode>(outputType, inputType) =&gt; boolean</PaperCode></td>
                        <td>Validates type compatibility between steps.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/process">Process API</PaperLink> — Supervised background processes.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/config">Config API</PaperLink> — Panel JSON configuration persistence.
                </PaperText>
            </PaperTextList>
        </>
    );
}
