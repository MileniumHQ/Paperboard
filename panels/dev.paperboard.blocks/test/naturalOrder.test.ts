import { describe, expect, test } from "bun:test";
import { naturalCompare, sortVariableReads } from "../src/lib/naturalOrder";

describe("natural order", () => {
    test("names count the way a person does", () => {
        expect(["variable_10", "variable_2", "variable_1", "Apple", "banana"].sort(naturalCompare)).toEqual(["Apple", "banana", "variable_1", "variable_2", "variable_10"]);
    });

    test("a flyout keeps its set and change blocks on top and lists the reads naturally", () => {
        const names: Record<string, string> = { a: "variable_10", b: "variable_2", c: "variable_1" };
        const read = (id: string) => ({ kind: "block", type: "variables_get", fields: { VAR: { id } } });
        const blocks = [{ kind: "block", type: "variables_set" }, { kind: "block", type: "math_change" }, read("a"), read("b"), read("c")];
        const sorted = sortVariableReads(blocks as never[], (id) => names[id]!);
        expect(sorted.map((b: any) => b.type + (b.fields?.VAR ? `:${names[b.fields.VAR.id]}` : ""))).toEqual(["variables_set", "math_change", "variables_get:variable_1", "variables_get:variable_2", "variables_get:variable_10"]);
    });
});
