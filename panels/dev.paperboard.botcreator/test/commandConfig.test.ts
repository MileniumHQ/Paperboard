import { describe, expect, test } from "bun:test";
import { readBotsConfig } from "../src/bots";
import { GLOBAL_SCOPE, MAX_COMMAND_OPTIONS, MAX_COMMANDS_PER_SCOPE, readStoredCommands } from "../src/types";

const GUILD = "123456789012345678";
const option = (name: string, extra: Record<string, unknown> = {}) => ({ id: `o-${name}`, name, description: `The ${name}`, type: "string", required: false, ...extra });
const stored = (name: string, extra: Record<string, unknown> = {}) => ({ id: `c-${name}-${String(extra.scope ?? "g")}`, name, description: `The ${name} command`, scope: GLOBAL_SCOPE, options: [], userInstall: false, ...extra });

// A saved command is never trusted, and never dropped: dropping a damaged one
// would write the list back without it at the next save, losing it for good.
describe("saved commands are never trusted, and never quietly dropped", () => {
    test("a damaged command refuses the list, saying which and why", () => {
        const damaged: [unknown, string][] = [
            [stored("Bad Name"), "saved command 2 (/Bad Name) is damaged: Names are 1–32 lowercase"],
            [stored("x".repeat(33)), "is damaged: Names are 1–32 lowercase"],
            [stored("blank", { description: "   " }), "(/blank) is damaged: A description is required."],
            [stored("noid", { id: "" }), "(/noid) is damaged: it has no id"],
            [stored("scoped", { scope: "guild-abc" }), '(/scoped) is damaged: "guild-abc" is not a server'],
            ["not a command", "saved command 2 is damaged: it has no id"],
            [stored("server", { scope: GUILD, userInstall: true }), "only global commands can be installed by users"],
            [stored("opts", { options: "string" }), "(/opts) is damaged: its options are not a list"],
            [stored("kind", { options: [option("colour", { type: "colour" })] }), 'option 1 has the unknown type "colour"'],
            [stored("order", { options: [option("later"), option("strict", { required: true })] }), "option 2 (strict)"],
            [stored("twice", { options: [option("dupe"), option("dupe")] }), "(dupe): Parameter names must be unique"],
            [stored("big", { options: Array.from({ length: MAX_COMMAND_OPTIONS + 1 }, (_, i) => option(`o${i}`)) }), `more than Discord's ${MAX_COMMAND_OPTIONS} options`],
        ];
        for (const [bad, why] of damaged) expect(() => readStoredCommands([stored("ok"), bad])).toThrow(why);
        expect(() => readStoredCommands({ ping: true })).toThrow("its commands are not a list");
    });

    test("commands are unique by scope and name, and capped per scope", () => {
        expect(() => readStoredCommands([stored("same"), stored("same", { id: "second-copy" })])).toThrow("/same is saved twice");
        const full = Array.from({ length: MAX_COMMANDS_PER_SCOPE }, (_, i) => stored(`c${i}`));
        // the same name in a server and globally are two commands; a full global scope leaves a server its own
        expect(readStoredCommands([...full, stored("same", { scope: GUILD })])).toHaveLength(MAX_COMMANDS_PER_SCOPE + 1);
        expect(() => readStoredCommands([...full, stored("one-more")])).toThrow(`past Discord's ${MAX_COMMANDS_PER_SCOPE}-command limit`);
    });

    test("valid commands come back as saved, names in Discord's form", () => {
        const commands = readStoredCommands([stored("/Slashed"), stored("dm", { userInstall: true }), stored("unscoped", { scope: undefined })]);
        expect(commands.map((c) => [c.name, c.scope, c.userInstall])).toEqual([
            ["slashed", GLOBAL_SCOPE, false],
            ["dm", GLOBAL_SCOPE, true],
            ["unscoped", GLOBAL_SCOPE, false],
        ]);
        expect(readStoredCommands(undefined)).toEqual([]);
    });

    test("a bot whose saved commands are damaged refuses the saved bots, naming the bot", () => {
        const bot = { id: "b-one", name: "One", commands: [stored("ok"), stored("Bad Name")] };
        expect(() => readBotsConfig({ version: 2, bots: [bot] })).toThrow("bot 1 in the saved list: saved command 2 (/Bad Name) is damaged");
    });
});
