import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function BlocksApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">blocksApi</PaperText>
            <PaperText preset="body" as="p">
                blocksApi registers what a panel offers the Blocks panel, and is how the Blocks panel lists, runs and reads it.
                It is the second version of <PaperLink href="/docs/paperapi/actions/">actionsApi</PaperLink>, and a registry of its own: Actions keeps working, and neither sees the other's blocks.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="kinds">Four kinds of block</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Kind</th>
                        <th>In Blocks</th>
                        <th>For</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Event</td><td>A block a flow starts from. Each value it fires with is a typed value inside the flow.</td><td>Something happened: a player joined.</td></tr>
                    <tr><td>Command</td><td>A step that does something, and may give back a typed value.</td><td>Kick a player, send a message.</td></tr>
                    <tr><td>Value</td><td>A value block for state the panel keeps. It only reads.</td><td>Player count, online players.</td></tr>
                    <tr><td>Type</td><td>What a value is. Its fields become properties: one "[field] of [value]" block.</td><td>A Player, a Channel and its name.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A read that has no effect is a value or a property, never a command. That keeps flows short: a flow uses the count where it needs it, instead of a step that fetches it first.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { blocksApi } from "@mileniumhq/paperapi";

// the panel's types, once
await blocksApi.panel().register({
    types: [{ id: "player", name: "Player", icon: "person", base: "text" }],
});

// each instance (one game server, one bot) is a project with its own blocks
const server = await blocksApi.defineProject({ id: "s1", name: "Survival", icon: "dns" });
await server.register({
    values: [{
        id: "player-count",
        name: "Player Count",
        type: "number",
        changes: true,
        read: () => state.onlinePlayers.length,
    }],
    commands: [{
        id: "kick-player",
        name: "Kick Player",
        text: "Kick {player} because {reason}",
        inputs: {
            player: { type: "player", name: "Player" },
            reason: { type: "text", name: "Reason", optional: true },
        },
        run: ({ player, reason }) => kick(player, reason),
    }],
    events: [{
        id: "player-joined",
        name: "When a Player Joins",
        values: { player: { type: "player", name: "Player" } },
    }],
});

// later, as things happen
await server.fire("player-joined", { player: "Steve" });
await server.changed("player-count");`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="registering">Registering</PaperText>
            <PaperCode block language="tsx">
{`blocksApi.panel(panelId?: string): BlocksHandle;
blocksApi.defineProject(project: BlockProjectDefinition, panelId?: string): Promise<BlocksProjectHandle>;

interface BlocksHandle {
    register(set: BlockSet): Promise<void>;
    unregister(kind: "type" | "command" | "value" | "event", id: string): Promise<void>;
    fire(event: string, payload: Record<string, unknown>): Promise<void>;
    changed(value: string): Promise<void>;
}

interface BlocksProjectHandle extends BlocksHandle {
    update(project: { name: string; icon?: string }): Promise<void>;
    remove(): Promise<void>;
}

interface BlockSet {
    types?: BlockTypeDefinition[];
    commands?: BlockCommandDefinition[];
    values?: BlockValueDefinition[];
    events?: BlockEventDefinition[];
}`}
            </PaperCode>
            <PaperTextList>
                <li><PaperCode>register</PaperCode> checks the whole set first, and a broken definition registers nothing. The error says what to fix: <PaperCode>Command "kick" text names {"{who}"}, which is not one of its inputs</PaperCode>.</li>
                <li>Types belong to the panel, so only <PaperCode>blocksApi.panel()</PaperCode> registers them. Its projects use them.</li>
                <li>A project's blocks are its own, and its section in the Blocks toolbox shows them. <PaperCode>remove</PaperCode> takes them all away.</li>
                <li><PaperCode>fire</PaperCode> checks the payload against the values the event declares, and <PaperCode>changed</PaperCode> needs a value with <PaperCode>changes: true</PaperCode>. Both refuse before anything is sent.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="types">Types</PaperText>
            <PaperText preset="body" as="p">
                Every input, output, value and field names its type.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>A value is</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>text</PaperCode>, <PaperCode>number</PaperCode>, <PaperCode>boolean</PaperCode></td><td>A string, a finite number, true or false.</td></tr>
                    <tr><td><PaperCode>timestamp</PaperCode>, <PaperCode>duration</PaperCode></td><td>Milliseconds: since 1970, or long.</td></tr>
                    <tr><td><PaperCode>color</PaperCode></td><td>A hex color, such as <PaperCode>#3366ff</PaperCode>.</td></tr>
                    <tr><td><PaperCode>url</PaperCode></td><td>A web address.</td></tr>
                    <tr><td><PaperCode>any</PaperCode></td><td>Anything.</td></tr>
                    <tr><td><PaperCode>list&lt;type&gt;</PaperCode></td><td>A list of that type, four deep at most.</td></tr>
                    <tr><td><PaperCode>player</PaperCode></td><td>One of the panel's own types.</td></tr>
                    <tr><td><PaperCode>dev.paperboard.botcreator:channel</PaperCode></td><td>Another panel's type.</td></tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`interface BlockTypeDefinition<V = any> {
    id: string;
    /** what a value of the type is called, such as "Player" */
    name: string;
    description?: string;
    icon?: string;
    /** what its values are on the wire */
    base: "text" | "number" | "boolean" | "object";
    fields?: Record<string, {
        type: TypeRef;
        name: string;
        description?: string;
        /** looks the field up; without it the field is the object value's own key */
        resolve?: (value: V, ctx: BlockContext) => unknown | Promise<unknown>;
    }>;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A field without <PaperCode>resolve</PaperCode> is read off the value and costs nothing, so the value must be an object that has it.
                A field with <PaperCode>resolve</PaperCode> asks the panel, which can look it up: a channel's name from Discord.
                A text, number or boolean value has no keys, so each of its fields needs <PaperCode>resolve</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="blocks">Commands, values and events</PaperText>
            <PaperCode block language="tsx">
{`interface BlockCommandDefinition {
    id: string;
    name: string;
    description?: string;
    /** the toolbox section */
    category?: string;
    icon?: string;
    /** what the block says, each input in braces where its socket sits */
    text?: string;
    inputs?: Record<string, BlockInputDefinition>;
    /** the type it gives back; leave it off when it gives nothing */
    output?: TypeRef;
    run: (inputs, ctx: BlockContext) => unknown;
}

interface BlockValueDefinition {
    id: string;
    name: string;
    // description, category, icon, text and inputs as for a command
    type: TypeRef;
    /** the panel calls changed(id), so Blocks offers "when it changes" */
    changes?: boolean;
    read: (inputs, ctx: BlockContext) => unknown;
}

interface BlockEventDefinition {
    id: string;
    name: string;
    // description, category, icon, text and inputs as for a command
    /** what it fires with: each one a typed value in the flow */
    values?: Record<string, { type: TypeRef; name: string; description?: string }>;
    /** input -> value: the flow starts only when the value equals the input */
    filters?: Record<string, string>;
}

interface BlockContext {
    panelId: string;
    /** absent on the panel's own blocks */
    project?: string;
}`}
            </PaperCode>
            <PaperTextList>
                <li>Ids are lowercase letters, digits and dashes. Each id is unique within its kind.</li>
                <li><PaperCode>text</PaperCode> shows each input once, in braces. Without it the block shows its name, with the inputs after it.</li>
                <li>The panel that owns a block checks every call: inputs before <PaperCode>run</PaperCode> or <PaperCode>read</PaperCode>, and the result against the declared type after. A result that isn't its type fails the block, so nothing wrong reaches the next one: <PaperCode>Lie returned: expected a number, got the text "not a number"</PaperCode>.</li>
                <li>A filter's input and the value it compares have one type.</li>
            </PaperTextList>

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
                    <tr><td><PaperCode>type</PaperCode></td><td><PaperCode>TypeRef</PaperCode></td><td>Required. What the socket takes. The empty socket shows the type's name, so there is no placeholder.</td></tr>
                    <tr><td><PaperCode>name</PaperCode></td><td><PaperCode>string</PaperCode></td><td>Required. The input's name, and the name in its errors.</td></tr>
                    <tr><td><PaperCode>description</PaperCode></td><td><PaperCode>string</PaperCode></td><td>More about the value.</td></tr>
                    <tr><td><PaperCode>optional</PaperCode></td><td><PaperCode>boolean</PaperCode></td><td>The block runs without it. Without this, an empty input is refused: <PaperCode>"Player" is required</PaperCode>.</td></tr>
                    <tr><td><PaperCode>choices</PaperCode></td><td><PaperCode>{"{ label: string; value: string | number | boolean }[]"}</PaperCode></td><td>A dropdown of these, in place of a socket.</td></tr>
                    <tr><td><PaperCode>min</PaperCode>, <PaperCode>max</PaperCode>, <PaperCode>integer</PaperCode></td><td><PaperCode>number</PaperCode>, <PaperCode>boolean</PaperCode></td><td>Limits on a number, timestamp or duration.</td></tr>
                    <tr><td><PaperCode>maxLength</PaperCode></td><td><PaperCode>number</PaperCode></td><td>Most characters in text.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="using">Using blocks</PaperText>
            <PaperText preset="body" as="p">
                This is how the Blocks panel works, and any panel can do the same.
            </PaperText>
            <PaperCode block language="tsx">
{`blocksApi.list(panelId?: string): Promise<BlockInfo[]>;
blocksApi.projects(panelId?: string): Promise<BlockProjectInfo[]>;

blocksApi.run<T>(panelId, command, inputs?, options?: { project?: string; timeoutMs?: number | null }): Promise<T>;
blocksApi.read<T>(panelId, value, inputs?, options?: { project?: string; timeoutMs?: number | null }): Promise<T>;
/** typeRef is "panel.id:type" */
blocksApi.property<T>(typeRef, field, value, options?): Promise<T>;

blocksApi.onEvent(panelId, event, callback: (payload) => void, project?): () => void;
blocksApi.onChange(panelId, value, callback: () => void, project?): () => void;
blocksApi.onRegistryChange(callback): () => void;

interface BlockInfo {
    panelId: string;
    /** "kind.id", or "project/kind.id" */
    entry: string;
    project?: string;
    schema: BlockSchema;
}`}
            </PaperCode>
            <PaperTextList>
                <li>A listed schema is the definition without its code, with every custom type named by its panel: <PaperCode>dev.paperboard.gameserver:player</PaperCode>. A field the panel looks up is marked <PaperCode>resolved: true</PaperCode>.</li>
                <li>A call waits 30 seconds by default and 60 at most. <PaperCode>timeoutMs: null</PaperCode> waits it out.</li>
                <li>A change says only that the value changed. Read it again for the new one.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
