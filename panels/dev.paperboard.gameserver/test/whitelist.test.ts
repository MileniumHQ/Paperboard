// Minecraft 26.3 writes white-list=true into a new server.properties (26.2
// wrote false; both checked against the servers' generated files). An
// empty whitelist then admits only operators, so the panel must show the
// right default and say why players are turned away.
import { describe, expect, mock, test } from "bun:test";
import { createSignal } from "solid-js";

// the real version signal, without the panel bridge it lives beside
const [serverVersion, setServerVersion] = createSignal("");
mock.module("../src/lib/server", () => ({ serverVersion, setServerVersion }));
mock.module("@mileniumhq/paperapi", () => ({ fileApi: {} }));

const { countJsonEntries, joinRestriction } = await import("../src/core/whitelist");
const { defaultValueFor, whitelistDefault } = await import("../src/lib/properties");

describe("whitelist default follows the version", () => {
    test("26.3 on, 26.2 off", () => {
        setServerVersion("26.2");
        expect(whitelistDefault()).toBe("false");
        setServerVersion("26.3");
        expect(whitelistDefault()).toBe("true");
        // the Advanced and Options tabs take their fallback from here
        expect(
            defaultValueFor({ key: "white-list", title: "Whitelist", control: "toggle", defaultValue: "false" }),
        ).toBe("true");
    });
});

describe("who can join", () => {
    test("an empty whitelist admits operators only, or nobody", () => {
        expect(joinRestriction(true, 0, 1)).toBe("operators-only");
        expect(joinRestriction(true, 0, 0)).toBe("nobody");
        expect(joinRestriction(true, 2, 0)).toBeNull();
        expect(joinRestriction(false, 0, 0)).toBeNull();
    });

    test("files the server has not written yet are empty; unreadable ones make no claim", () => {
        expect(countJsonEntries(null)).toBe(0);
        expect(countJsonEntries("[]")).toBe(0);
        expect(countJsonEntries('[{"uuid":"x","name":"Steve"}]')).toBe(1);
        expect(countJsonEntries("{not json")).toBeNull();
        expect(joinRestriction(true, countJsonEntries("{not json"), 0)).toBeNull();
    });
});
