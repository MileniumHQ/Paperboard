// A bot's slash commands as Discord holds them: each scope is set to
// exactly the stored list, or cleared when the bot is deleted.
import type { Client, ApplicationCommandOptionData, ChatInputApplicationCommandData, REST } from "discord.js";
import { discord, loadDiscord } from "./discord";
import { GLOBAL_SCOPE, errorToMessage, extractApplicationIdFromToken, type SlashCommandDefinition, type SlashCommandOption } from "./types";

function optionPayload(option: SlashCommandOption): ApplicationCommandOptionData {
    const { ApplicationCommandOptionType } = discord();
    const base = {
        name: option.name,
        description: option.description,
        required: option.required,
    };
    switch (option.type) {
        case "string":
            return { ...base, type: ApplicationCommandOptionType.String };
        case "integer":
            return { ...base, type: ApplicationCommandOptionType.Integer };
        case "number":
            return { ...base, type: ApplicationCommandOptionType.Number };
        case "boolean":
            return { ...base, type: ApplicationCommandOptionType.Boolean };
        case "user":
            return { ...base, type: ApplicationCommandOptionType.User };
        case "channel":
            return { ...base, type: ApplicationCommandOptionType.Channel };
        case "role":
            return { ...base, type: ApplicationCommandOptionType.Role };
        case "mentionable":
            return { ...base, type: ApplicationCommandOptionType.Mentionable };
    }
    // unreachable: CommandOptionType is exhausted above
    throw new Error(`Unsupported command option type: ${String(option.type)}`);
}

function commandPayload(
    def: SlashCommandDefinition,
): ChatInputApplicationCommandData {
    // Always explicit: omitting integration types inherits the app's
    // configured contexts, which would silently promote a guild-only
    // command to user installs once the portal enables them. contexts is
    // left unset so a user-install command works on every surface.
    const { ApplicationCommandType, ApplicationIntegrationType } = discord();
    return {
        type: ApplicationCommandType.ChatInput,
        name: def.name,
        description: def.description,
        options: def.options.map(optionPayload),
        integrationTypes: def.userInstall
            ? [
                ApplicationIntegrationType.GuildInstall,
                ApplicationIntegrationType.UserInstall,
            ]
            : [ApplicationIntegrationType.GuildInstall],
    };
}

/**
 * Declarative registration: each scope is set to exactly the stored list, so
 * deleted commands disappear. `scopesToClear` carries scopes that no longer
 * have any command (an empty list cannot be inferred from the commands).
 * Returns human-readable errors instead of throwing so partial success is
 * reported truthfully.
 */
export async function syncSlashCommands(
    bot: Client,
    commands: SlashCommandDefinition[],
    scopesToClear: string[] = [],
): Promise<string[]> {
    await loadDiscord();
    const application = bot.application;
    if (!application) {
        throw new Error(
            "Discord application is not available on this client; commands were not registered.",
        );
    }

    const errors: string[] = [];
    const byScope = new Map<string, SlashCommandDefinition[]>();
    for (const command of commands) {
        const list = byScope.get(command.scope) ?? [];
        list.push(command);
        byScope.set(command.scope, list);
    }

    try {
        await application.commands.set(
            (byScope.get(GLOBAL_SCOPE) ?? []).map(commandPayload),
        );
    } catch (err) {
        errors.push(`Global commands: ${errorToMessage(err)}`);
    }

    for (const scope of new Set([...byScope.keys(), ...scopesToClear])) {
        if (scope === GLOBAL_SCOPE) continue;
        const definitions = byScope.get(scope) ?? [];
        const guild = bot.guilds.cache.get(scope);
        if (!guild) {
            errors.push(
                `Guild ${scope} is not in this bot's server list; its commands were not registered.`,
            );
            continue;
        }
        try {
            await guild.commands.set(definitions.map(commandPayload));
        } catch (err) {
            errors.push(`Guild ${guild.name}: ${errorToMessage(err)}`);
        }
    }

    return errors;
}

/**
 * Sets each of `scopes` to no commands with the bot's token alone, through
 * `rest`: the gateway is never needed. Gives what Discord refused, scope by
 * scope, with `guildName` naming a server.
 */
export async function clearSlashCommands(
    rest: REST,
    token: string,
    scopes: string[],
    guildName: (id: string) => string,
): Promise<string[]> {
    const applicationId = extractApplicationIdFromToken(token);
    if (!applicationId) throw new Error("The saved token doesn't name a Discord application, so its commands can't be cleared.");
    const { Routes } = await loadDiscord();
    const errors: string[] = [];
    for (const scope of scopes) {
        const global = scope === GLOBAL_SCOPE;
        try {
            await rest.put(global ? Routes.applicationCommands(applicationId) : Routes.applicationGuildCommands(applicationId, scope), { body: [] });
        } catch (err) {
            errors.push(`${global ? "Global commands" : `Guild ${guildName(scope)}`}: ${errorToMessage(err)}`);
        }
    }
    return errors;
}
