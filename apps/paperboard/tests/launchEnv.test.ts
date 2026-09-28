import { describe, expect, it } from "bun:test";
import { electronChildEnv } from "../scripts/launchEnv";

describe("electron dev launcher environment", () => {
    it("strips ELECTRON_RUN_AS_NODE so Electron starts as Electron", () => {
        const env = electronChildEnv({ ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin" });
        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(env.PATH).toBe("/usr/bin");
    });

    it("does not mutate the caller's environment", () => {
        const source = { ELECTRON_RUN_AS_NODE: "1" };
        electronChildEnv(source);
        expect(source.ELECTRON_RUN_AS_NODE).toBe("1");
    });

    it("leaves a clean environment alone", () => {
        expect(electronChildEnv({ HOME: "/home/x" })).toEqual({ HOME: "/home/x" });
    });
});
