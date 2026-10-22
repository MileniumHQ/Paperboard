import { describe, expect, it } from "bun:test";
import { electronChildEnv, electronViteArgs } from "../scripts/launchEnv";

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

describe("electron dev launcher arguments", () => {
    it("passes Paperboard's flags to Electron, which electron-vite would reject", () => {
        expect(electronViteArgs(["dev", "--mobile"])).toEqual(["dev", "--", "--mobile"]);
        expect(electronViteArgs(["dev", "--mobile", "--", "--browser", "--browser-port=5871"]))
            .toEqual(["dev", "--", "--mobile", "--browser", "--browser-port=5871"]);
    });

    it("leaves electron-vite's own arguments and an existing split alone", () => {
        expect(electronViteArgs(["dev", "--watch"])).toEqual(["dev", "--watch"]);
        expect(electronViteArgs(["dev", "--", "--mobile"])).toEqual(["dev", "--", "--mobile"]);
    });
});
