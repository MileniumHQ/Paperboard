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
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Event</td><td>A block a flow starts from, such as a player joining. Each value it fires with is a typed value inside the flow.</td></tr>
                    <tr><td>Command</td><td>A step that does something, such as kicking a player. What it gives back is in its gear: the value, and each of its type's fields.</td></tr>
                    <tr><td>Value</td><td>A value block for state the panel keeps, such as the player count. It only reads.</td></tr>
                    <tr><td>Type</td><td>What a value is, such as a Player. Its fields become properties: one "[field] of [value]" block.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A read that has no effect is a value or a property, never a command. That keeps flows short: a flow uses the count where it needs it, instead of a step that fetches it first.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { blocksApi } from "@mileniumhq/paperapi";

// the panel's categories and types, once
await blocksApi.panel().register({
    categories: [{ name: "Players", icon: "group" }],
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
    update(project: { name: string; icon?: string; image?: string }): Promise<void>;
    remove(): Promise<void>;
}

interface BlockProjectDefinition {
    id: string;
    name: string;
    icon?: string;
    image?: string;
}

interface BlockSet {
    categories?: { name: string; icon: string }[];
    types?: BlockTypeDefinition[];
    commands?: BlockCommandDefinition[];
    values?: BlockValueDefinition[];
    events?: BlockEventDefinition[];
}`}
            </PaperCode>
            <PaperTextList>
                <li><PaperCode>register</PaperCode> checks the whole set first, and a broken definition registers nothing. The error says what to fix: <PaperCode>Command "kick" text names {"{who}"}, which is not one of its inputs</PaperCode>.</li>
                <li>Types belong to the panel, so only <PaperCode>blocksApi.panel()</PaperCode> registers them. Its projects use them.</li>
                <li>Categories belong to the panel too. A block names one in <PaperCode>category</PaperCode>, and the Library heads its section with the category's <PaperCode>icon</PaperCode>, a Material Symbols name. Register them before the blocks that name them. A category with no declaration gets a plain heading.</li>
                <li>A project's blocks are its own, and its section in the Blocks toolbox shows them. <PaperCode>remove</PaperCode> takes them all away.</li>
                <li>The Blocks project menu shows a project by <PaperCode>image</PaperCode> when it has one, else by <PaperCode>icon</PaperCode>, a Material Symbols name. Give it the picture your panel shows for the project, such as a server's icon.</li>
                <li><PaperCode>image</PaperCode> is a path in the panel's folder, such as <PaperCode>/assets/games/minecraft/icon.webp</PaperCode>, or a base64 <PaperCode>data:image</PaperCode> URL of a PNG, WebP, JPEG or GIF. It is at most 512 KB. Any other value is refused with <PaperCode>{`Project "s1"'s picture must be an image file in the panel's folder or a base64 data:image URL`}</PaperCode>.</li>
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
        /** a value may not have it; it reads as nothing */
        optional?: boolean;
        /** resolve needs the project that asks; each project gets the field */
        perProject?: boolean;
        /** looks the field up; without it the field is the object value's own key */
        resolve?: (value: V, ctx: BlockContext) => unknown | Promise<unknown>;
    }>;
    /** the values there are now; an input of the type starts as a dropdown of them */
    choices?: (ctx: BlockContext) => BlockChoice[] | Promise<BlockChoice[]>;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A field without <PaperCode>resolve</PaperCode> is read off the value and costs nothing, so the value must be an object that has it.
                A field with <PaperCode>resolve</PaperCode> asks the panel, which can look it up: a channel's name from Discord.
                A text, number or boolean value has no keys, so each of its fields needs <PaperCode>resolve</PaperCode>.
            </PaperText>
            <PaperTextList>
                <li>An <PaperCode>optional</PaperCode> field may be missing from the value, or <PaperCode>resolve</PaperCode> may give back <PaperCode>null</PaperCode>: a member with no nickname. It reads as nothing, and the "has a value" block tells it apart.</li>
                <li>A type with <PaperCode>choices</PaperCode> lists its values: the servers there are, a server's online players. Every input of the type, in any panel, starts as a dropdown of them, and a block can be dropped in its place, a text block too. Give it to any type whose values can be listed, so nobody has to type an ID. <PaperCode>ctx.project</PaperCode> is set when the input's block is in one of this panel's projects. An optional input's dropdown starts on <b>none</b>, or <b>any</b> on an event.</li>
                <li>A <PaperCode>perProject</PaperCode> field depends on the project that asks: whether a player is online on this server. Each project's section in the toolbox gets its own "[field] of [value]" block for these fields, and <PaperCode>resolve</PaperCode> gets that project in <PaperCode>ctx.project</PaperCode>. It needs <PaperCode>resolve</PaperCode>.</li>
            </PaperTextList>

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
    /** what it gives back is called, such as "Answer"; needed for a core type or a list */
    outputName?: string;
    /** the panel's own: its page calls it, nothing lists it, and other panels are refused */
    internal?: boolean;
    run: (inputs, ctx: BlockContext) => unknown;
}

interface BlockValueDefinition {
    id: string;
    name: string;
    // description, category, icon, text, inputs and internal as for a command
    type: TypeRef;
    /** the panel calls changed(id), so Blocks offers "when it changes" */
    changes?: boolean;
    read: (inputs, ctx: BlockContext) => unknown;
}

interface BlockEventDefinition {
    id: string;
    name: string;
    // description, category, icon, text, inputs and internal as for a command
    /** what it fires with: each one a typed value in the flow */
    values?: Record<string, { type: TypeRef; name: string; description?: string; optional?: boolean }>;
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
                <li>A command is always a step. When it has an <PaperCode>output</PaperCode>, its gear opens a tray of what it gave back: the value, named by <PaperCode>outputName</PaperCode> or its type ("message"), and one block per field of its type ("message ID"). Each reads that one block's result in the run.</li>
                <li>A block that only reads, with no effect, is a value, not a command, even when it takes inputs: an Embed built from its title and text.</li>
                <li>A filter's input and the value it compares have one type.</li>
                <li>An <PaperCode>internal</PaperCode> block is how a panel's page talks to its own service: the page calls it by name with <PaperCode>blocksApi.run</PaperCode>, <PaperCode>read</PaperCode> or <PaperCode>onEvent</PaperCode>. It is never listed, so no toolbox, flow or agent offers it, and the daemon refuses it to every other panel. It is checked like any other block. Use it for what only the panel's own page needs, such as saving a layout. What a person would automate is a normal block.</li>
                <li>An <PaperCode>optional</PaperCode> event value may be left out of a firing, or be <PaperCode>null</PaperCode>: the channel someone left, when they only joined. Inside the flow it reads as nothing. Don't fire empty text in its place.</li>
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
                    <tr><td><PaperCode>choices</PaperCode></td><td><PaperCode>{"BlockChoice[] | (ctx) => BlockChoice[]"}</PaperCode></td><td>A dropdown of these, in the input's socket: a variable or any block can take its place. A function is asked each time the dropdown opens and each time the block runs, so it follows what the panel has now, such as the game rules of the installed version. A choice that's gone stays in a saved flow, and running it says so.</td></tr>
                    <tr><td><PaperCode>default</PaperCode></td><td><PaperCode>string | number | boolean</PaperCode></td><td>What a new block holds, and what a call that leaves the input out gets. It's checked against the input when registered.</td></tr>
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
/** typeRef is "panel.id:type"; a perProject field needs options.project */
blocksApi.property<T>(typeRef, field, value, options?: { project?: string; timeoutMs?: number | null }): Promise<T>;
/** a dropdown's choices now, for an input whose choices are a function */
blocksApi.choices(panelId, entry, input): Promise<BlockChoice[]>;
/** a type's values now, for a type with choices; in one of its panel's projects when given */
blocksApi.typeChoices(typeRef, options?: { project?: string }): Promise<BlockChoice[]>;

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
                <li>Internal blocks are left out of <PaperCode>list</PaperCode>. A listed schema is the definition without its code, with every custom type named by its panel: <PaperCode>dev.paperboard.gameserver:player</PaperCode>. A field the panel looks up is marked <PaperCode>resolved: true</PaperCode>.</li>
                <li>A call waits 30 seconds by default and 60 at most. <PaperCode>timeoutMs: null</PaperCode> waits it out.</li>
                <li>A change says only that the value changed. Read it again for the new one.</li>
                <li>An input whose choices are a function, and a type with choices, are listed with <PaperCode>dynamicChoices: true</PaperCode> and no choices.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="testing">Testing</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>memoryBlocks</PaperCode> is a Blocks registry in memory, for a panel's tests. Hand its handle to the code that registers, and it checks everything the daemon's registry would: definitions, inputs, results and payloads. Every request and answer goes through JSON, as it would over the wire.
            </PaperText>
            <PaperCode block language="tsx">
{`import { memoryBlocks } from "@mileniumhq/paperapi";

const fired: unknown[] = [];
const blocks = memoryBlocks("dev.paperboard.gameserver", {
    fired: (event, payload, project) => fired.push({ event, payload, project }),
    changed: (value, project) => {},
});
await blocks.panel.register({ types });
const server = await blocks.defineProject({ id: "s1", name: "Survival" });
await server.register(serverBlocks);

await blocks.run("kick-player", { player: "Steve" }, { project: "s1" });
await blocks.read("player-count", {}, { project: "s1" });
await blocks.property("player", "online", "Steve", { project: "s1" });
await blocks.choices("s1/command.set-game-rule", "rule");`}
            </PaperCode>
        </PaperFlex>
    );
}
