// The install-warning sentence picks the side of the running version a
// build's target list sits on, so the copy never recites 20 version ids.
import { describe, expect, test, mock } from "bun:test";

mock.module("../src/lib/server", () => ({
    serverSoftware: () => "paper",
    serverVersion: () => "",
    updatePanelConfig: async () => {},
    serverBridge: {
        call: async () => ({}),
        refreshState: async () => ({}),
        onStateChange: () => {},
    },
}));

mock.module("@paperboard-dev/paperapi", () => ({
    fileApi: {},
    files: {},
    config: { get: async () => ({}), set: async () => true },
    processApi: {},
    system: { getInfo: async () => ({ os: "linux" }) },
    createPanelBridge: () => ({
        onStateChange: () => {},
        refreshState: async () => ({}),
        actions: {},
        call: async () => ({}),
    }),
}));

const { pluginVersionWarning, targetVersionSide } = await import(
    "../src/lib/plugins"
);

describe("targetVersionSide", () => {
    test("older when every target sits below the running version", () => {
        expect(targetVersionSide(["1.20.5", "1.21", "26.2"], "26.3")).toBe(
            "older",
        );
    });

    test("newer when every target sits above the running version", () => {
        expect(targetVersionSide(["1.21", "1.21.1"], "1.20.6")).toBe("newer");
    });

    test("mixed when the targets straddle the running version", () => {
        expect(targetVersionSide(["1.21.3", "1.21.5"], "1.21.4")).toBe("mixed");
    });

    test("snapshots resolve to the release they behave as", () => {
        // 25w02a is the first snapshot of the 1.21.5 cycle
        expect(targetVersionSide(["25w02a"], "1.21.4")).toBe("newer");
        expect(targetVersionSide(["25w02a"], "1.21.6")).toBe("older");
    });

    test("unknown without a server version or targets", () => {
        expect(targetVersionSide(["1.21"], "")).toBe("unknown");
        expect(targetVersionSide([], "1.21")).toBe("unknown");
    });
});

describe("pluginVersionWarning", () => {
    test("reads as one sentence with the side filled in", () => {
        expect(pluginVersionWarning(["1.20.5", "26.2"], "26.3")).toBe(
            "This build targets versions older than this one. Installing it has a chance of crashing the server on startup.",
        );
        expect(pluginVersionWarning(["1.21"], "1.20.6")).toBe(
            "This build targets versions newer than this one. Installing it has a chance of crashing the server on startup.",
        );
    });

    test("mixed and unknown stay honest", () => {
        expect(pluginVersionWarning(["1.21.3", "1.21.5"], "1.21.4")).toContain(
            "older and newer",
        );
        expect(pluginVersionWarning(["1.21"], "")).toContain(
            "versions other than this one",
        );
    });
});
