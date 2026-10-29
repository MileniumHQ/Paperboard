// Render and Simulation Distance are slider fields in the Advanced tab. They
// store through the same writeServerProperties path as every other field, and
// the slider's bounds are the field's bounds.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { portApiStub } from "./portApiStub";
import { createSignal } from "solid-js";

const [serverVersion, setServerVersion] = createSignal("1.21.4");
mock.module("../src/lib/server", () => ({ serverVersion, setServerVersion }));

let disk = "";
const writes: string[] = [];
mock.module("@mileniumhq/paperapi", () => ({
    portApi: portApiStub(),
    fileApi: {
        read: async () => disk,
        write: async (_path: string, content: string) => {
            disk = content;
            writes.push(content);
        },
    },
}));

const { DISTANCE_PROPERTY_FIELDS, defaultValueFor, isValidFieldValue, writeServerProperties } =
    await import("../src/lib/properties");
const { supports } = await import("../src/lib/capabilities");
const { parseProperties } = await import("../src/core/properties");

const field = (key: string) => {
    const found = DISTANCE_PROPERTY_FIELDS.find((f) => f.key === key);
    if (!found) throw new Error(`no ${key} field`);
    return found;
};
const shown = () => DISTANCE_PROPERTY_FIELDS.filter((f) => !f.capability || supports(f.capability));

beforeEach(() => {
    disk = "";
    writes.length = 0;
    setServerVersion("1.21.4");
});

describe("distance slider fields", () => {
    test("render and simulation distance are 2-32 chunk sliders defaulting to vanilla's 10", () => {
        for (const key of ["view-distance", "simulation-distance"]) {
            expect(field(key)).toMatchObject({ control: "slider", min: 2, max: 32, unit: "chunks" });
            expect(defaultValueFor(field(key))).toBe("10");
        }
    });

    test("simulation distance is gated to 1.18+, render distance is not", () => {
        expect(field("view-distance").capability).toBeUndefined();
        expect(field("simulation-distance").capability).toBe("simulationDistance");

        setServerVersion("1.17.1");
        expect(shown().map((f) => f.key)).toEqual(["view-distance"]);
        setServerVersion("1.18");
        expect(shown().map((f) => f.key)).toEqual(["view-distance", "simulation-distance"]);
    });

    test("a slider accepts whole numbers inside its bounds only", () => {
        const distance = field("view-distance");
        for (const ok of ["2", "10", "32"]) expect(isValidFieldValue(distance, ok)).toBe(true);
        for (const bad of ["1", "0", "-4", "33", "10.5", "", "  ", "abc", "NaN", "Infinity"]) {
            expect(isValidFieldValue(distance, bad)).toBe(false);
        }
    });

    test("number fields keep fractions and bounds; text and toggles take anything", () => {
        const number = { key: "n", title: "N", control: "number" as const, defaultValue: "1", min: 0, max: 4 };
        expect(isValidFieldValue(number, "2.5")).toBe(true);
        expect(isValidFieldValue(number, "5")).toBe(false);
        expect(isValidFieldValue({ ...number, control: "text" }, "anything")).toBe(true);
    });

    test("a slider value is stored beside the keys already in the file", async () => {
        disk = "motd=hi\nview-distance=10\n";
        await writeServerProperties({ "view-distance": "24", "simulation-distance": "6" });
        expect(parseProperties(writes[0])).toEqual({
            motd: "hi",
            "view-distance": "24",
            "simulation-distance": "6",
        });
    });
});
