import { describe, expect, test } from "bun:test";
import {
    describeCommandOptionProblem,
    describeCommandProblem,
    GLOBAL_SCOPE,
    MAX_COMMAND_OPTIONS,
    MAX_COMMANDS_PER_SCOPE,
    normalizeCommandDefinitions,
} from "../src/types";

const GUILD = "123456789012345678";
const option = (name: string, extra: Record<string, unknown> = {}) => ({ id: `o-${name}`, name, description: `The ${name}`, type: "string", required: false, ...extra });
const stored = (name: string, extra: Record<string, unknown> = {}) => ({ id: `c-${name}-${String(extra.scope ?? "g")}`, name, description: `The ${name} command`, scope: GLOBAL_SCOPE, options: [], userInstall: false, ...extra });

const normalize = normalizeCommandDefinitions;

// Stored command config is never trusted.
describe("stored command config is never trusted", () => {
    test("malformed commands are dropped", () => {
        const commands = normalize([
            stored("ok"),
            stored("Bad Name"),
            stored("x".repeat(33)),
            stored("blank", { description: "   " }),
            stored("noid", { id: "" }),
            stored("scoped", { scope: "guild-abc" }),
            "not a command",
            null,
            stored("/Slashed"),
        ]);
        expect(commands.map((c) => c.name)).toEqual(["ok", "slashed"]);
        // the same rules the editor shows
        expect(describeCommandProblem({ name: "Bad Name", description: "x" })).not.toBeNull();
        expect(describeCommandProblem({ name: "x".repeat(33), description: "x" })).not.toBeNull();
        expect(describeCommandProblem({ name: "/Slashed", description: "x" })).toBeNull();
    });

    test("malformed, duplicate and misordered options are dropped by the editor's own rules", () => {
        const raw = [
            option("first", { required: true }),
            option("kind", { type: "colour" }),
            { name: "noid", description: "x", type: "string" },
            option("Bad Name"),
            option("dupe"),
            option("dupe"),
            option("later"),
            option("strict", { required: true }),
        ];
        const commands = normalize([stored("cmd", { options: raw })]);
        // every candidate the editor would flag is gone; the valid ones stay in order
        expect(commands[0].options.map((o) => o.name)).toEqual(["first", "later"]);
        const candidates = raw.filter((o): o is ReturnType<typeof option> => "id" in o && o.type === "string");
        for (const [index, candidate] of candidates.entries()) {
            const kept = commands[0].options.some((o) => o.id === candidate.id);
            expect(describeCommandOptionProblem(candidate, candidates, index) === null).toBe(kept);
        }
    });

    test("options past Discord's limit are dropped", () => {
        const many = Array.from({ length: MAX_COMMAND_OPTIONS + 5 }, (_, i) => option(`o${i}`));
        const commands = normalize([stored("big", { options: many })]);
        expect(commands[0].options.map((o) => o.name)).toEqual(many.slice(0, MAX_COMMAND_OPTIONS).map((o) => o.name));
    });

    test("commands are unique by scope and name, and capped per scope", () => {
        const flood = Array.from({ length: MAX_COMMANDS_PER_SCOPE + 3 }, (_, i) => stored(`c${i}`));
        const commands = normalize([
            stored("same"),
            stored("same", { id: "second-copy" }),
            stored("same", { scope: GUILD }),
            ...flood,
            stored("guildonly", { scope: GUILD }),
        ]);
        expect(commands.filter((c) => c.name === "same").map((c) => [c.id, c.scope])).toEqual([
            ["c-same-g", GLOBAL_SCOPE],
            [`c-same-${GUILD}`, GUILD],
        ]);
        expect(commands.filter((c) => c.scope === GLOBAL_SCOPE)).toHaveLength(MAX_COMMANDS_PER_SCOPE);
        // a full global scope does not cost a guild its commands
        expect(commands.filter((c) => c.scope === GUILD).map((c) => c.name)).toEqual(["same", "guildonly"]);
    });

    test("user install is forced off on server-scoped commands and kept on global ones", () => {
        const commands = normalize([stored("dm", { userInstall: true }), stored("server", { scope: GUILD, userInstall: true }), stored("unscoped", { scope: undefined })]);
        expect(commands.map((c) => [c.name, c.scope, c.userInstall])).toEqual([
            ["dm", GLOBAL_SCOPE, true],
            ["server", GUILD, false],
            ["unscoped", GLOBAL_SCOPE, false],
        ]);
    });

    test("a stored value that isn't a list is no commands", () => {
        expect(normalize({ ping: true })).toEqual([]);
        expect(normalize(undefined)).toEqual([]);
        expect(normalize([stored("opts", { options: "string" })])).toEqual([]);
    });
});
