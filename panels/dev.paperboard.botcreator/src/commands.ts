// A bot's slash commands: made and removed the one way, from the Commands
// tab or a Blocks flow alike. Each is saved, gets its Blocks event, and is
// set on Discord.
import { randomUUID } from "node:crypto";
import { commandEvent, commandEventId } from "./blocks/events";
import {
    GLOBAL_SCOPE,
    MAX_COMMANDS_PER_SCOPE,
    MAX_COMMAND_OPTIONS,
    SNOWFLAKE_PATTERN,
    describeCommandProblem,
    describeCommandOptionProblem,
    normalizeCommandName,
    type SlashCommandDefinition,
    type SlashCommandOption,
    type CommandOptionType,
    type CommandMutationResult,
} from "./types";
import { publish, requireReadable, type BotEntry } from "./registry";
import { readToken, saveBots } from "./persistence";
import { errorMessage } from "@mileniumhq/paperapi";

/**
 * The one way a bot's commands change: saved, handed to the session, and
 * announced with the bot, so every window's Commands tab shows the list as
 * it now is.
 */
async function setCommands(entry: BotEntry, commands: SlashCommandDefinition[]): Promise<void> {
    const before = entry.stored;
    entry.stored = { ...entry.stored, commands };
    try {
        await saveBots();
    } catch (err) {
        entry.stored = before;
        throw err;
    }
    entry.session.commands = commands;
    publish();
}

// one Blocks event per command: registering is part of creating the
// command, so a command whose event is missing is reported, never
// quietly half-created
async function registerCommandTrigger(entry: BotEntry, command: SlashCommandDefinition): Promise<string | null> {
    try {
        if (!entry.blocks) throw new Error(entry.blocksError ?? "the bot's project is not in Blocks");
        await entry.blocks.register({ events: [commandEvent(command)] });
        return null;
    } catch (err) {
        console.error(`[DiscordService] registering the Blocks event for /${command.name} failed:`, err);
        return `Could not register the trigger for /${command.name}: ${errorMessage(err)}`;
    }
}

async function unregisterCommandTrigger(entry: BotEntry, command: SlashCommandDefinition): Promise<string | null> {
    try {
        if (entry.blocks) await entry.blocks.unregister("event", commandEventId(command));
        return null;
    } catch (err) {
        console.error(`[DiscordService] removing the Blocks event for /${command.name} failed:`, err);
        return `Could not remove the trigger for /${command.name}: ${errorMessage(err)}`;
    }
}

function parseCommandOptions(raw: unknown): SlashCommandOption[] {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_COMMAND_OPTIONS) {
        throw new Error(`Discord allows at most ${MAX_COMMAND_OPTIONS} parameters per command.`);
    }
    const candidates = list.map((option: any) => ({
        id: typeof option?.id === "string" && option.id ? option.id : randomUUID(),
        name: typeof option?.name === "string" ? normalizeCommandName(option.name) : "",
        description: typeof option?.description === "string" ? option.description.trim() : "",
        type: typeof option?.type === "string" ? option.type : "",
        required: Boolean(option?.required),
    }));
    for (let index = 0; index < candidates.length; index++) {
        const problem = describeCommandOptionProblem(candidates[index], candidates, index);
        if (problem) throw new Error(`Parameter ${index + 1}: ${problem}`);
    }
    return candidates.map((candidate) => ({ ...candidate, type: candidate.type as CommandOptionType }));
}

/** Stores a command, registers its event in the bot's project, and tells Discord. */
export async function createCommand(entry: BotEntry, input: any): Promise<CommandMutationResult> {
    requireReadable();
    const name = typeof input?.name === "string" ? normalizeCommandName(input.name) : "";
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    const scope = typeof input?.scope === "string" && input.scope.trim() ? input.scope.trim() : GLOBAL_SCOPE;
    const userInstall = Boolean(input?.userInstall);
    const problem = describeCommandProblem({ name, description });
    if (problem) throw new Error(problem);
    if (scope !== GLOBAL_SCOPE && !SNOWFLAKE_PATTERN.test(scope)) {
        throw new Error(`Unknown command scope "${scope}".`);
    }
    if (userInstall && scope !== GLOBAL_SCOPE) {
        throw new Error(
            "User apps are only available for global commands: Discord ignores installation contexts on server-scoped commands.",
        );
    }
    const options = parseCommandOptions(input?.options);

    const commands = entry.stored.commands;
    if (commands.some((c) => c.scope === scope && c.name === name)) {
        throw new Error(`A command named /${name} already exists in this scope.`);
    }
    if (commands.filter((c) => c.scope === scope).length >= MAX_COMMANDS_PER_SCOPE) {
        throw new Error(`Discord allows at most ${MAX_COMMANDS_PER_SCOPE} commands per scope.`);
    }

    const definition: SlashCommandDefinition = { id: randomUUID(), name, description, scope, options, userInstall };
    await setCommands(entry, [...commands, definition]);
    const triggerError = await registerCommandTrigger(entry, definition);
    const sync = await entry.session.syncCommands();
    return { command: definition, ...sync, triggerError };
}

/** Removes a stored command, its event, and its Discord definition. */
export async function deleteCommand(entry: BotEntry, rawId: unknown): Promise<CommandMutationResult> {
    requireReadable();
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) throw new Error("A command id is required.");
    const target = entry.stored.commands.find((c) => c.id === id);
    if (!target) throw new Error(`No command with id ${id} is stored.`);
    const next = entry.stored.commands.filter((c) => c.id !== id);
    // a scope with no commands left cannot be inferred from the list, so it
    // is explicitly cleared on Discord
    const emptied = !next.some((c) => c.scope === target.scope);
    await setCommands(entry, next);
    const triggerError = await unregisterCommandTrigger(entry, target);
    if (!emptied || entry.session.connected()) {
        return { command: target, ...(await entry.session.syncCommands(emptied ? [target.scope] : [])), triggerError };
    }
    // a bot that is off syncs only the scopes it still has commands in when
    // it next logs in, so an emptied one is cleared now with its token, as
    // deleting the bot does
    let syncError: string | null = null;
    try {
        const token = await readToken(entry.stored.id);
        if (!token) throw new Error("No token is saved for this bot.");
        await entry.session.clearCommands(token, [target.scope]);
    } catch (err) {
        syncError = `${errorMessage(err)} /${target.name} stays on Discord.`;
    }
    return { command: target, registered: false, syncError, triggerError };
}
