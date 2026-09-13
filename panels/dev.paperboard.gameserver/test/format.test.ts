// Identifier humanization (bun test): gamerule and property keys reach the
// UI as snake_case. The title and the search index both go through this one
// function, so a rule can never render one way and be searchable another.
import { describe, test, expect } from "bun:test";
import { humanizeIdentifier } from "../src/core/format";

describe("humanizeIdentifier", () => {
    test("turns snake_case into title case words", () => {
        expect(humanizeIdentifier("command_block_output")).toBe("Command Block Output");
        expect(humanizeIdentifier("log_admin_commands")).toBe("Log Admin Commands");
        expect(humanizeIdentifier("show_death_messages")).toBe("Show Death Messages");
    });

    test("keeps single letters upper and lower-cases the rest", () => {
        expect(humanizeIdentifier("a_b_c")).toBe("A B C");
        expect(humanizeIdentifier("MAX_WORLD_SIZE")).toBe("Max World Size");
    });

    test("handles spaces and empty input", () => {
        expect(humanizeIdentifier("level name")).toBe("Level Name");
        expect(humanizeIdentifier("")).toBe("");
        expect(humanizeIdentifier("   ")).toBe("");
    });
});
