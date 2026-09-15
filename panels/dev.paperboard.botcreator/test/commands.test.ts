// slash-command validation, registration and health helpers (bun test):
// these are the boundaries the UI and Discord both depend on, so they are
// pinned here even though no component test exists in this repo
import { describe, it, expect, beforeEach } from "bun:test";
import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ChannelType,
    type Client,
} from "discord.js";
import {
    GLOBAL_SCOPE,
    MAX_COMMANDS_PER_SCOPE,
    MAX_COMMAND_OPTIONS,
    PENDING_INTERACTION_CAP,
    commandTriggerId,
    describeCommandOptionProblem,
    describeCommandProblem,
    findCommandForInteraction,
    hasDuplicateOptionName,
    isCommandDescriptionValid,
    isCommandNameValid,
    isOptionOrderValid,
    normalizeCommandDefinitions,
    normalizeCommandName,
    formatDuration,
    formatBytes,
    type SlashCommandDefinition,
    type SlashCommandOption,
} from "../src/types";
import {
    buildHealth,
    buildInviteUrl,
    buildGuildDetail,
    buildMemberSummaries,
    commandPayload,
    commandTriggerDefinition,
    describeChannelKind,
    syncSlashCommands,
    rememberInteraction,
    takeInteraction,
    pendingInteractionCount,
    clearPendingInteractions,
} from "../src/service";

function command(
    name: string,
    scope: string = GLOBAL_SCOPE,
    id: string = name,
    options: SlashCommandOption[] = [],
): SlashCommandDefinition {
    return { id, name, description: `${name} does things`, scope, options };
}

function option(
    name: string,
    overrides: Partial<SlashCommandOption> = {},
): SlashCommandOption {
    return {
        id: `opt-${name}`,
        name,
        description: `${name} parameter`,
        type: "string",
        required: false,
        ...overrides,
    };
}

describe("describeCommandProblem", () => {
    it("accepts Discord's name and description rules", () => {
        expect(describeCommandProblem({ name: "ping", description: "Pong" })).toBeNull();
        expect(
            describeCommandProblem({ name: "a-b_c9", description: "x".repeat(100) }),
        ).toBeNull();
    });

    it("rejects bad names, empty or overlong descriptions", () => {
        expect(describeCommandProblem({ name: "", description: "x" })).toMatch(/required/);
        expect(describeCommandProblem({ name: "/", description: "x" })).toMatch(/required/);
        expect(describeCommandProblem({ name: "a".repeat(33), description: "x" })).toMatch(/32/);
        expect(describeCommandProblem({ name: "no spaces", description: "x" })).not.toBeNull();
        expect(describeCommandProblem({ name: "ping", description: "" })).toMatch(/required/);
        expect(
            describeCommandProblem({ name: "ping", description: "x".repeat(101) }),
        ).toMatch(/100/);
    });
});

describe("describeCommandOptionProblem", () => {
    it("accepts a valid parameter", () => {
        expect(
            describeCommandOptionProblem(
                { name: "target", description: "Who to ping", type: "user", required: true },
                [{ name: "target", required: true }],
                0,
            ),
        ).toBeNull();
    });

    it("rejects bad names, descriptions and types", () => {
        const all = [{ name: "target", required: false }];
        expect(
            describeCommandOptionProblem(
                { name: "", description: "x", type: "string", required: false },
                all,
                0,
            ),
        ).toMatch(/required/);
        expect(
            describeCommandOptionProblem(
                { name: "no spaces", description: "x", type: "string", required: false },
                all,
                0,
            ),
        ).not.toBeNull();
        expect(
            describeCommandOptionProblem(
                { name: "target", description: "", type: "string", required: false },
                all,
                0,
            ),
        ).toMatch(/description/);
        expect(
            describeCommandOptionProblem(
                { name: "target", description: "x", type: "nope", required: false },
                all,
                0,
            ),
        ).toMatch(/type/);
    });

    it("rejects duplicate names and required-after-optional", () => {
        expect(
            describeCommandOptionProblem(
                { name: "dup", description: "x", type: "string", required: false },
                [
                    { name: "dup", required: false },
                    { name: "dup", required: false },
                ],
                0,
            ),
        ).toMatch(/unique/);
        expect(
            describeCommandOptionProblem(
                { name: "late", description: "x", type: "string", required: true },
                [
                    { name: "early", required: false },
                    { name: "late", required: true },
                ],
                1,
            ),
        ).toMatch(/before optional/);
    });
});

describe("normalizeCommandDefinitions", () => {
    it("keeps valid commands and defaults a missing scope", () => {
        const normalized = normalizeCommandDefinitions([
            { id: "1", name: "ping", description: "Pong" },
        ]);
        expect(normalized).toEqual([
            { id: "1", name: "ping", description: "Pong", scope: GLOBAL_SCOPE, options: [] },
        ]);
    });

    it("drops malformed entries instead of trusting stored config", () => {
        const normalized = normalizeCommandDefinitions([
            null,
            "ping",
            { id: "", name: "ping", description: "Pong", scope: GLOBAL_SCOPE },
            { id: "2", name: "Bad Name", description: "Pong", scope: GLOBAL_SCOPE },
            { id: "3", name: "ping", description: "Pong", scope: "not-a-guild-id" },
        ]);
        expect(normalized).toEqual([]);
    });

    it("deduplicates by scope:name and caps each scope", () => {
        const many: unknown[] = [command("ping"), command("ping", GLOBAL_SCOPE, "other-id")];
        for (let n = 0; n <= MAX_COMMANDS_PER_SCOPE; n++) {
            many.push(command(`cmd${n}`));
        }
        const normalized = normalizeCommandDefinitions(many);
        expect(normalized).toHaveLength(MAX_COMMANDS_PER_SCOPE);
        expect(normalized.filter((c) => c.name === "ping")).toHaveLength(1);
    });

    it("ignores a non-list value", () => {
        expect(normalizeCommandDefinitions(undefined)).toEqual([]);
        expect(normalizeCommandDefinitions("[]")).toEqual([]);
    });
});

describe("buildInviteUrl", () => {
    it("requests applications.commands now that the panel ships slash commands", () => {
        const url = buildInviteUrl("12345678901234567", ["SendMessages"]);
        expect(url).toContain("scope=bot%20applications.commands");
        expect(url).toContain("permissions=2048");
    });

    it("fails loud on unknown permissions and a missing application id", () => {
        expect(() => buildInviteUrl("1", ["SendMesages"])).toThrow(/Unknown Discord permission/);
        expect(() => buildInviteUrl("", [])).toThrow(/application ID/);
    });
});

// the UI marks inputs invalid with these exact predicates, so they are the
// code path a user actually sees; the describe* messages build on them
describe("shared validity predicates", () => {
    it("isCommandNameValid accepts exactly Discord's command-name grammar", () => {
        expect(isCommandNameValid("ping")).toBe(true);
        expect(isCommandNameValid("a-b_c9")).toBe(true);
        expect(isCommandNameValid("")).toBe(false);
        expect(isCommandNameValid("no spaces")).toBe(false);
        expect(isCommandNameValid("a".repeat(33))).toBe(false);
        // case is normalized, not rejected: the UI lowercases as you type
        expect(isCommandNameValid("Ping")).toBe(true);
    });

    it("treats a leading slash as optional decoration", () => {
        // the placeholder is /command-name, so /ping must validate and
        // normalize to ping before anything reaches Discord
        expect(isCommandNameValid("/ping")).toBe(true);
        expect(normalizeCommandName("/ping")).toBe("ping");
        expect(normalizeCommandName("  /Ping  ")).toBe("ping");
        expect(normalizeCommandName("ping")).toBe("ping");
        expect(isCommandNameValid("/")).toBe(false);
    });

    it("isCommandDescriptionValid requires 1-100 characters after trimming", () => {
        expect(isCommandDescriptionValid("Pong")).toBe(true);
        expect(isCommandDescriptionValid("  Pong  ")).toBe(true);
        expect(isCommandDescriptionValid("")).toBe(false);
        expect(isCommandDescriptionValid("   ")).toBe(false);
        expect(isCommandDescriptionValid("x".repeat(101))).toBe(false);
    });

    it("hasDuplicateOptionName flags repeated names only", () => {
        const options = [{ name: "who" }, { name: "loud" }];
        expect(hasDuplicateOptionName(options, "who")).toBe(false);
        // names are lowercased at the boundary, so the comparison is exact
        expect(hasDuplicateOptionName(options, "loud")).toBe(false);
        expect(
            hasDuplicateOptionName([...options, { name: "who" }], "who"),
        ).toBe(true);
    });

    it("isOptionOrderValid mirrors Discord's required-before-optional rule", () => {
        expect(
            isOptionOrderValid([{ required: true }, { required: false }], 0),
        ).toBe(true);
        expect(
            isOptionOrderValid([{ required: true }, { required: false }], 1),
        ).toBe(true);
        expect(
            isOptionOrderValid([{ required: false }, { required: true }], 1),
        ).toBe(false);
    });
});

describe("stored command options", () => {
    const stored = (options: unknown[]) => ({
        id: "1",
        name: "ping",
        description: "Pong",
        scope: GLOBAL_SCOPE,
        options,
    });

    it("keeps valid parameters and drops malformed, duplicate and misordered ones", () => {
        const normalized = normalizeCommandDefinitions([
            stored([
                { id: "o1", name: "who", description: "Who to ping", type: "user" },
                { id: "o2", name: "", description: "x", type: "string" },
                { id: "o3", name: "bad", description: "x", type: "not-a-type" },
                { id: "o4", name: "late", description: "x", type: "string", required: true },
            ]),
        ]);
        expect(normalized[0].options.map((o) => o.name)).toEqual(["who"]);
    });

    it("caps stored options at Discord's limit", () => {
        const options = Array.from({ length: MAX_COMMAND_OPTIONS + 3 }, (_, n) => ({
            id: `o${n}`,
            name: `p${n}`,
            description: "x",
            type: "string",
        }));
        const normalized = normalizeCommandDefinitions([stored(options)]);
        expect(normalized[0].options).toHaveLength(MAX_COMMAND_OPTIONS);
    });
});

describe("command payload and per-command triggers", () => {
    it("maps every supported option type and required flag to Discord", () => {
        const payload = commandPayload(
            command("ping", GLOBAL_SCOPE, "c1", [
                option("a", { type: "string" }),
                option("b", { type: "integer" }),
                option("c", { type: "number" }),
                option("d", { type: "boolean" }),
                option("e", { type: "user", required: true }),
                option("f", { type: "channel" }),
                option("g", { type: "role" }),
                option("h", { type: "mentionable" }),
            ]),
        );
        expect(payload.type).toBe(ApplicationCommandType.ChatInput);
        expect(payload.options?.map((o) => o.type)).toEqual([
            ApplicationCommandOptionType.String,
            ApplicationCommandOptionType.Integer,
            ApplicationCommandOptionType.Number,
            ApplicationCommandOptionType.Boolean,
            ApplicationCommandOptionType.User,
            ApplicationCommandOptionType.Channel,
            ApplicationCommandOptionType.Role,
            ApplicationCommandOptionType.Mentionable,
        ]);
        expect(payload.options?.[4].required).toBe(true);
    });

    it("exposes the command's parameters as typed fields", () => {
        const def = commandTriggerDefinition(
            command("ping", GLOBAL_SCOPE, "c1", [
                option("target", { type: "user" }),
                option("times", { type: "integer" }),
            ]),
        );
        expect(def.category).toEqual({
            name: "Commands",
            icon: "terminal",
            order: 6,
        });
        expect(def.outputFields?.interactionId).toEqual({
            type: "discord-interaction",
            label: "Interaction",
            typeName: "Interaction",
        });
        expect(def.outputFields?.userId).toEqual({
            type: "discord-user",
            label: "User",
            typeName: "User",
        });
        expect(def.outputFields?.["values.target"]).toEqual({
            type: "discord-user",
            label: "target",
            typeName: "User",
        });
        expect(def.outputFields?.["values.times"]).toEqual({
            type: "number",
            label: "times",
            typeName: "Integer",
        });
    });

    it("keys triggers by scope and name so recreating keeps flows bound", () => {
        expect(commandTriggerId(command("ping"))).toBe("command:global:ping");
        expect(commandTriggerId({ scope: "12345678901234567", name: "ping" })).toBe(
            "command:12345678901234567:ping",
        );
    });

    it("prefers the guild command over the global one, like Discord", () => {
        const global = command("ping");
        const scoped = command("ping", "12345678901234567", "g1");
        expect(
            findCommandForInteraction([global, scoped], "ping", "12345678901234567"),
        ).toBe(scoped);
        expect(
            findCommandForInteraction([global, scoped], "ping", "99999999999999999"),
        ).toBe(global);
        expect(findCommandForInteraction([global, scoped], "ping", null)).toBe(global);
        expect(findCommandForInteraction([global, scoped], "nope", null)).toBeUndefined();
    });
});

describe("slash command sync", () => {
    const guildId = "12345678901234567";

    function fakeBot() {
        const sets: Record<string, any[]> = {};
        return {
            sets,
            application: {
                commands: {
                    set: async (payload: any[]) => {
                        sets.global = payload;
                    },
                },
            },
            guilds: {
                cache: new Map([
                    [
                        guildId,
                        {
                            name: "Guild One",
                            commands: {
                                set: async (payload: any[]) => {
                                    sets[guildId] = payload;
                                },
                            },
                        },
                    ],
                ]),
            },
        } as unknown as Client & { sets: typeof sets };
    }

    it("sets the global list declaratively", async () => {
        const bot = fakeBot();
        const errors = await syncSlashCommands(bot, [command("ping")]);
        expect(errors).toEqual([]);
        expect(bot.sets.global).toEqual([
            { type: ApplicationCommandType.ChatInput, name: "ping", description: "ping does things", options: [] },
        ]);
    });

    it("registers parameters with the command", async () => {
        const bot = fakeBot();
        await syncSlashCommands(bot, [
            command("ping", GLOBAL_SCOPE, "c1", [
                option("who", { type: "user", required: true }),
            ]),
        ]);
        expect(bot.sets.global[0].options).toEqual([
            {
                type: ApplicationCommandOptionType.User,
                name: "who",
                description: "who parameter",
                required: true,
            },
        ]);
    });

    it("sets per-guild commands and reports a guild the bot is not in", async () => {
        const bot = fakeBot();
        const errors = await syncSlashCommands(bot, [
            command("locals", guildId, "l1"),
            command("foreign", "99999999999999999", "f1"),
        ]);
        expect(bot.sets[guildId]).toHaveLength(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("99999999999999999");
    });

    it("clears a scope explicitly when its last command is gone", async () => {
        const bot = fakeBot();
        const errors = await syncSlashCommands(bot, [], [guildId]);
        expect(errors).toEqual([]);
        expect(bot.sets[guildId]).toEqual([]);
    });

    it("refuses to pretend when the application is missing", async () => {
        const bot = { guilds: { cache: new Map() } } as unknown as Client;
        await expect(syncSlashCommands(bot, [])).rejects.toThrow(/application is not available/);
    });
});

describe("pending interaction store", () => {
    beforeEach(() => {
        clearPendingInteractions();
    });

    const fakeInteraction = (id: string) => ({ id }) as any;

    it("caps the store and evicts the oldest", () => {
        for (let n = 0; n < PENDING_INTERACTION_CAP + 3; n++) {
            rememberInteraction(fakeInteraction(`i${n}`));
        }
        expect(pendingInteractionCount()).toBe(PENDING_INTERACTION_CAP);
        expect(() => takeInteraction("i0")).toThrow(/not pending/);
        expect(takeInteraction(`i${PENDING_INTERACTION_CAP + 2}`).id).toBe(
            `i${PENDING_INTERACTION_CAP + 2}`,
        );
    });

    it("clears every entry on teardown", () => {
        rememberInteraction(fakeInteraction("a"));
        rememberInteraction(fakeInteraction("b"));
        clearPendingInteractions();
        expect(pendingInteractionCount()).toBe(0);
        expect(() => takeInteraction("a")).toThrow(/not pending/);
    });
});

describe("server explorer helpers", () => {
    const guildId = "12345678901234567";

    it("maps Discord channel types to UI kinds", () => {
        expect(describeChannelKind(ChannelType.GuildText)).toBe("text");
        expect(describeChannelKind(ChannelType.GuildVoice)).toBe("voice");
        expect(describeChannelKind(ChannelType.GuildCategory)).toBe("category");
        expect(describeChannelKind(ChannelType.GuildAnnouncement)).toBe("announcement");
        expect(describeChannelKind(ChannelType.GuildStageVoice)).toBe("stage");
        expect(describeChannelKind(ChannelType.GuildForum)).toBe("forum");
        expect(describeChannelKind(ChannelType.GuildMedia)).toBe("media");
        expect(describeChannelKind(9999)).toBe("other");
    });

    it("builds a bounded, sorted guild detail", () => {
        const guild = {
            id: guildId,
            name: "Guild One",
            iconURL: () => "https://cdn/icon.png",
            memberCount: 12,
            ownerId: "owner",
            createdAt: new Date("2020-01-02T00:00:00Z"),
            channels: {
                cache: new Map([
                    ["c2", { id: "c2", name: "voice", type: ChannelType.GuildVoice, parentId: "cat", position: 2 }],
                    ["cat", { id: "cat", name: "Category", type: ChannelType.GuildCategory, parentId: null, position: 0 }],
                    ["c1", { id: "c1", name: "general", type: ChannelType.GuildText, parentId: "cat", position: 1 }],
                ]),
            },
            roles: {
                cache: new Map([
                    ["r1", { id: "r1", name: "Member", color: 0, position: 1, managed: false }],
                    ["r2", { id: "r2", name: "Bot", color: 255, position: 9, managed: true }],
                ]),
            },
        };
        const detail = buildGuildDetail(guild);
        expect(detail.icon).toBe("https://cdn/icon.png");
        expect(detail.createdAt).toBe("2020-01-02T00:00:00.000Z");
        expect(detail.channels.map((c) => c.id)).toEqual(["cat", "c1", "c2"]);
        expect(detail.channels.find((c) => c.id === "c2")!.kind).toBe("voice");
        expect(detail.roles.map((r) => r.id)).toEqual(["r2", "r1"]);
        expect(detail.roles[0].managed).toBe(true);
    });

    it("summarizes members with a hard page cap", () => {
        const members = Array.from({ length: 40 }, (_, n) => ({
            id: `m${n}`,
            user: { username: `user${n}`, bot: n === 0 },
            displayName: `User ${n}`,
            displayAvatarURL: () => `https://cdn/a${n}.png`,
            joinedAt: new Date("2021-03-04T00:00:00Z"),
        }));
        const summaries = buildMemberSummaries(members);
        expect(summaries).toHaveLength(25);
        expect(summaries[0]).toMatchObject({
            id: "m0",
            username: "user0",
            displayName: "User 0",
            bot: true,
        });
        expect(summaries[0].joinedAt).toBe("2021-03-04T00:00:00.000Z");
    });
});

describe("health payload", () => {
    it("is offline and honest without a client", () => {
        const health = buildHealth(null);
        expect(health.connected).toBe(false);
        expect(health.wsPing).toBe(-1);
        expect(health.guildCount).toBe(0);
        expect(health.uptimeMs).toBe(0);
        expect(health.memoryRss).toBeGreaterThan(0);
        expect(health.commandSyncError).toBeNull();
    });

    it("reads the live client's counters and ping", () => {
        const bot = {
            ws: { ping: 42, status: 0 },
            guilds: { cache: new Map([["g1", {}]]) },
            users: { cache: new Map([["u1", {}]]) },
            channels: { cache: new Map() },
        } as unknown as Client;
        const health = buildHealth(bot);
        expect(health.wsPing).toBe(42);
        expect(health.guildCount).toBe(1);
        expect(health.cachedUsers).toBe(1);
        expect(health.cachedChannels).toBe(0);
    });
});

describe("format helpers", () => {
    it("formats durations compactly", () => {
        expect(formatDuration(0)).toBe("0s");
        expect(formatDuration(1000)).toBe("1s");
        expect(formatDuration(61_000)).toBe("1m 1s");
        expect(formatDuration(3_600_000)).toBe("1h 0m");
        expect(formatDuration(90_000_000)).toBe("1d 1h");
    });

    it("formats memory sizes", () => {
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(2048)).toBe("2.0 KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
        expect(formatBytes(-1)).toBe("—");
    });
});
